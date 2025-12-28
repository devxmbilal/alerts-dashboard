import Redis from "ioredis";
import WebSocket from "ws";
import dotenv from "dotenv";
import logger from "../utils/logger.js";
dotenv.config();
// Redis configuration
const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryDelayOnClusterDown: 300,
  maxRetriesPerRequest: 3,
});

// Handle Redis connection errors
redis.on("error", (err) => {
  console.error("❌ Redis worker error:", err);
});

redis.on("connect", () => {
  console.log("✅ Redis worker connected");
});

redis.on("close", () => {
  console.log("🔌 Redis worker disconnected");
});

// Binance WebSocket endpoints
const BINANCE_WS_BASE = "wss://stream.binance.com:9443/ws";
const BINANCE_REST_API = "https://api.binance.com/api/v3";

// Fallback API endpoints for better reliability (ordered by reliability)
const BINANCE_API_ENDPOINTS = [
  "https://api.binance.com/api/v3",
  "https://api1.binance.com/api/v3",
  "https://api3.binance.com/api/v3",
  "https://api2.binance.com/api/v3", // This one has DNS issues, put last
];

// Network configuration for better connectivity
const FETCH_CONFIG = {
  timeout: 15000, // 15 second timeout
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.9",
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
  },
};

// Rate limiting
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // 2 seconds between requests

// IP ban tracking (global for robustFetch)
let ipBannedUntil = 0;

// Track active connections
const activeConnections = new Map();
const subscribedPairs = new Set();

// Dynamic USDT pairs - will be fetched from Binance
let USDT_PAIRS = [];

// Robust fetch function with retry logic and rate limiting
async function robustFetch(url, options = {}) {
  // Check if IP is still banned (10-minute cooldown)
  if (Date.now() < ipBannedUntil) {
    const waitMs = ipBannedUntil - Date.now();
    console.log(`🚫 IP still banned. Wait ${Math.ceil(waitMs / 60000)} more minutes...`);
    throw new Error("BINANCE_IP_BANNED");
  }

  // Rate limiting - wait if needed
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`⏳ Rate limiting: waiting ${waitTime}ms...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
  lastRequestTime = Date.now();

  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/${maxRetries}: ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        FETCH_CONFIG.timeout
      );

      const response = await fetch(url, {
        ...FETCH_CONFIG,
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 418 - HARD STOP for 10 minutes
      if (response.status === 418) {
        const cooldownMs = 600000; // 10 minutes
        ipBannedUntil = Date.now() + cooldownMs;
        console.error(`🚫 HTTP 418: IP BANNED! Stopping REST calls for 10 minutes`);
        console.error(`🚫 Resume at: ${new Date(ipBannedUntil).toLocaleTimeString()}`);
        throw new Error("BINANCE_IP_BANNED");
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.log(`✅ Successfully connected to ${url}`);
      return response;
    } catch (error) {
      lastError = error;
      console.log(`❌ Attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxRetries) {
        // Exponential backoff with longer delays
        const delay = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// Try multiple Binance endpoints
async function fetchWithFallback(endpoint) {
  for (const baseUrl of BINANCE_API_ENDPOINTS) {
    try {
      const url = `${baseUrl}${endpoint}`;
      console.log(`🔄 Trying endpoint: ${url}`);
      const response = await robustFetch(url);
      return response;
    } catch (error) {
      console.log(
        `❌ Failed to connect to ${baseUrl}${endpoint}: ${error.message}`
      );
    }
  }

  throw new Error("All Binance endpoints failed");
}

class BinanceWorker {
  constructor() {
    this.ws = null;
    this.wsConnections = [];
    this.reconnectInterval = 5000;
    this.isConnected = false;
    this.heartbeatInterval = null;
    this.lastPublishTime = 0;
    this.publishThrottle = 100; // 🔥 FIX: Reduced from 500ms to catch rapid price spikes
    this.initialDataLoaded = false; // FIX: Prevent duplicate REST calls
  }

  async start() {
    console.log("🚀 Starting Binance Worker...");
    await this.connectToRedis();
    await this.connectToBinance();
    this.startHeartbeat();
    this.startScheduledRefresh(); // Start 24-hour scheduled refresh
  }

  async connectToRedis() {
    try {
      await redis.ping();
      console.log("✅ Connected to Redis");
    } catch (error) {
      console.error("❌ Redis connection failed:", error);
      process.exit(1);
    }
  }

  async connectToBinance() {
    try {
      // Try to fetch USDT pairs - but don't block if it fails
      try {
        await this.fetchAllUSDTSPairs();
      } catch (error) {
        console.warn("⚠️ REST call failed (possibly IP banned), using cached/fallback pairs");
      }

      // FIX: Only fetch initial data on COLD START (not on reconnect)
      if (!this.initialDataLoaded) {
        try {
          await this.fetchInitialData();
        } catch (error) {
          console.warn("⚠️ Initial data fetch failed, WebSocket will handle updates");
          this.initialDataLoaded = true; // Don't retry if banned
        }
      } else {
        console.log("⚠️ Skipping REST call on reconnect - WebSocket will handle updates");
      }

      // ALWAYS connect to WebSocket (even if REST failed)
      // WebSocket has no rate limit issues
      this.connectWebSocket();
    } catch (error) {
      console.error("❌ Binance connection failed:", error);
      setTimeout(() => this.connectToBinance(), this.reconnectInterval);
    }
  }

  async fetchAllUSDTSPairs() {
    try {
      console.log("📊 Fetching all USDT spot pairs from Binance...");

      // Try to get cached pairs first
      const cachedPairs = await redis.get("crypto:usdt_pairs");
      if (cachedPairs) {
        USDT_PAIRS = JSON.parse(cachedPairs);
        console.log(`💾 Using cached pairs: ${USDT_PAIRS.length} pairs`);
        // Refresh TTL
        await redis.expire("crypto:usdt_pairs", 86400);
        return;
      }

      // Get exchange info to get all trading pairs
      const response = await fetchWithFallback("/exchangeInfo");
      const exchangeInfo = await response.json();

      // Filter for USDT spot pairs (not futures, not delisted, not premium)
      const usdtPairs = exchangeInfo.symbols
        .filter((symbol) => {
          return (
            symbol.status === "TRADING" && // Only active trading pairs
            symbol.symbol.endsWith("USDT") && // Only USDT pairs
            symbol.isSpotTradingAllowed === true && // Only spot trading allowed
            !symbol.symbol.includes("_") && // Exclude premium pairs (usually have _)
            !symbol.symbol.includes("BULL") && // Exclude leveraged tokens
            !symbol.symbol.includes("BEAR") && // Exclude leveraged tokens
            // Note: Removed UP/DOWN filters - Binance delisted all leveraged tokens, and these were incorrectly filtering SYRUP, JUP etc.
            !symbol.symbol.includes("3L") && // Exclude leveraged tokens
            !symbol.symbol.includes("3S") && // Exclude leveraged tokens
            !symbol.symbol.includes("5L") && // Exclude leveraged tokens
            !symbol.symbol.includes("5S") && // Exclude leveraged tokens
            symbol.baseAsset !== "BUSD" && // Exclude BUSD pairs
            symbol.quoteAsset === "USDT" // Only USDT as quote asset
          );
        })
        .map((symbol) => symbol.symbol.toLowerCase())
        .sort(); // Sort alphabetically

      USDT_PAIRS = usdtPairs;
      console.log(`✅ Found ${USDT_PAIRS.length} USDT spot pairs`);

      // Cache the pairs list in Redis for longer - 24 hours
      await redis.setex("crypto:usdt_pairs", 86400, JSON.stringify(USDT_PAIRS));
    } catch (error) {
      console.error("❌ Failed to fetch USDT pairs:", error);
      console.log("⚠️ Using fallback pairs list...");
      // Fallback to default pairs if API fails
      USDT_PAIRS = [
        "btcusdt",
        "ethusdt",
        "bnbusdt",
        "adausdt",
        "solusdt",
        "xrpusdt",
        "dotusdt",
        "linkusdt",
        "uniusdt",
        "avaxusdt",
        "maticusdt",
        "atomusdt",
        "ltcusdt",
        "nearusdt",
        "algousdt",
      ];
    }
  }

  async fetchInitialData() {
    // FIX: Guard against duplicate REST calls
    if (this.initialDataLoaded) {
      console.log("⚠️ Initial data already loaded, skipping REST call...");
      return;
    }

    try {
      console.log("📊 Fetching initial market data (ONE TIME ONLY)...");
      const startTime = Date.now();
      this.initialDataLoaded = true; // Mark as loaded immediately

      // Fetch 24hr ticker data for all pairs
      const response = await fetchWithFallback("/ticker/24hr");
      const tickers = await response.json();

      console.log(`⚡ Processing ${tickers.length} tickers, caching to Redis...`);

      const pipeline = redis.pipeline();
      let count = 0;

      // Process and cache data using pipeline for speed
      // NOTE: Do NOT publish individual updates during initial load!
      // This would cause counting effect on frontend.
      // Frontend will fetch all data at once from Redis via SSE initial_data
      for (const ticker of tickers) {
        if (USDT_PAIRS.includes(ticker.symbol.toLowerCase())) {
          const processedData = this.processTickerData(ticker);
          const cacheKey = `crypto:${processedData.symbol}`;

          // Cache with 24h TTL (86400s) - NO PUBLISHING during initial load!
          pipeline.setex(cacheKey, 86400, JSON.stringify(processedData));
          count++;
        }
      }

      // Execute all commands at once
      await pipeline.exec();

      console.log(`✅ Cached ${count} pairs to Redis in ${Date.now() - startTime}ms (NO counting effect!)`);
    } catch (error) {
      console.error("❌ Failed to fetch initial data:", error);
    }
  }

  connectWebSocket() {
    try {
      // Create multiple WebSocket connections to cover all pairs
      const maxStreams = 100; // FIX: Binance recommended safe limit (was 200)
      const totalPairs = USDT_PAIRS.length;
      const numConnections = Math.ceil(totalPairs / maxStreams);

      console.log(
        `🔌 Creating ${numConnections} WebSocket connections for ${totalPairs} pairs...`
      );

      this.wsConnections = [];

      for (let i = 0; i < numConnections; i++) {
        const start = i * maxStreams;
        const end = Math.min(start + maxStreams, totalPairs);
        const pairsToStream = USDT_PAIRS.slice(start, end);
        const streams = pairsToStream.map((pair) => `${pair}@ticker`).join("/");
        const wsUrl = `${BINANCE_WS_BASE}/${streams}`;

        console.log(
          `🔌 Connection ${i + 1}: Streaming pairs ${start + 1}-${end} (${pairsToStream.length
          } pairs)`
        );

        const ws = new WebSocket(wsUrl);
        this.wsConnections.push(ws);

        // Set up event handlers for this connection
        ws.on("open", () => {
          console.log(`✅ WebSocket connection ${i + 1} connected`);
          if (i === 0) {
            // Set isConnected on first connection
            this.isConnected = true;
            this.reconnectInterval = 5000;
          }
        });

        ws.on("message", async (data) => {
          try {
            const message = JSON.parse(data);
            if (message.e === "24hrTicker") {
              const processedData = this.processTickerData(message);
              await this.cacheAndPublish(processedData);
            }
          } catch (error) {
            console.error("❌ Error processing WebSocket message:", error);
          }
        });

        ws.on("close", () => {
          console.log(`🔌 WebSocket connection ${i + 1} disconnected`);
          this.reconnect();
        });

        ws.on("error", (error) => {
          console.error(`❌ WebSocket connection ${i + 1} error:`, error);
          this.reconnect();
        });
      }
    } catch (error) {
      console.error("❌ WebSocket connection failed:", error);
      this.reconnect();
    }
  }

  processTickerData(ticker) {
    return {
      symbol: ticker.s,
      price: parseFloat(ticker.c),
      priceChange: parseFloat(ticker.p),
      priceChangePercent: parseFloat(ticker.P),
      change: parseFloat(ticker.P),
      changeAmount: parseFloat(ticker.p),
      volume24h: parseFloat(ticker.q), // 24-hour quote volume (in USDT) from Binance ticker - ticker.q is quote volume, ticker.v is base volume
      high: parseFloat(ticker.h),
      low: parseFloat(ticker.l),
      high24h: parseFloat(ticker.h),
      low24h: parseFloat(ticker.l),
      open: parseFloat(ticker.o),
      close: parseFloat(ticker.c),
      openPrice: parseFloat(ticker.o),
      closePrice: parseFloat(ticker.c),
      timestamp: Date.now(),
      isFavorite: false,
    };
  }

  async cacheAndPublish(data) {
    try {
      // Cache in Redis (24 hours TTL)
      const cacheKey = `crypto:${data.symbol}`;
      await redis.setex(cacheKey, 86400, JSON.stringify(data));

      // Throttle publishing to prevent overwhelming Redis
      const now = Date.now();
      if (now - this.lastPublishTime < this.publishThrottle) {
        return; // Skip this publish to throttle
      }
      this.lastPublishTime = now;

      // Publish to Redis pub/sub
      await redis.publish(
        "market:updates",
        JSON.stringify({
          type: "market_update",
          symbol: data.symbol,
          data: data,
        })
      );

      // Publish specific symbol update
      await redis.publish(
        `market:${data.symbol}`,
        JSON.stringify({
          type: "symbol_update",
          data: data,
        })
      );
    } catch (error) {
      console.error("❌ Error caching/publishing data:", error);
    }
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      if (this.isConnected) {
        // Publish heartbeat
        await redis.publish(
          "market:heartbeat",
          JSON.stringify({
            type: "heartbeat",
            timestamp: Date.now(),
          })
        );
      }
    }, 30000); // Every 30 seconds
  }

  startScheduledRefresh() {
    // Refresh pairs list every 8 hours (NOT ticker data - WebSocket handles that)
    setInterval(async () => {
      try {
        console.log("🔄 Starting 8-hour scheduled refresh (pairs list only)...");

        const oldPairsCount = USDT_PAIRS.length;

        // FIX: Only refresh pairs list, NOT /ticker/24hr
        // WebSocket already handles real-time price updates
        await this.fetchAllUSDTSPairs();

        // Reconnect WebSockets if pairs changed
        if (USDT_PAIRS.length !== oldPairsCount) {
          console.log(`🔄 Pairs count changed (${oldPairsCount} → ${USDT_PAIRS.length}), reconnecting WebSockets...`);
          this.wsConnections.forEach(ws => ws && ws.close());
          this.connectWebSocket();
        }

        console.log("✅ 8-hour refresh complete (WebSocket handles price updates)");

      } catch (error) {
        console.error("❌ Error during scheduled refresh:", error);
      }
    }, 28800000); // Every 8 hours (faster detection of new/removed pairs)
  }

  reconnect() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }

    console.log(
      `🔄 Reconnecting in ${this.reconnectInterval / 1000} seconds...`
    );
    setTimeout(() => {
      this.reconnectInterval = Math.min(this.reconnectInterval * 1.5, 60000); // Max 1 minute
      this.connectToBinance();
    }, this.reconnectInterval);
  }

  async stop() {
    console.log("🛑 Stopping Binance Worker...");

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all WebSocket connections
    if (this.wsConnections && this.wsConnections.length > 0) {
      this.wsConnections.forEach((ws, index) => {
        if (ws) {
          console.log(`🔌 Closing WebSocket connection ${index + 1}`);
          ws.close();
        }
      });
    }

    // Also close the old single connection if it exists
    if (this.ws) {
      this.ws.close();
    }

    await redis.quit();
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("🛑 Received SIGINT, shutting down gracefully...");
  await worker.stop();
});

process.on("SIGTERM", async () => {
  console.log("🛑 Received SIGTERM, shutting down gracefully...");
  await worker.stop();
});

// Start the worker
const worker = new BinanceWorker();
worker.start().catch(console.error);

export default BinanceWorker;
