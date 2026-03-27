import Redis from "ioredis";
import WebSocket from "ws";
import dotenv from "dotenv";
import axios from "axios";
import logger from "../utils/logger.js";
import candleCache from "../utils/candleCache.js"; // 🔥 NEW: Cache candles for chart generation
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
    // 🔥 NEW: Track live candles per symbol+timeframe for proper OHLCV construction
    this.liveCandles = new Map(); // key: "BTCUSDT_5m" -> { open, high, low, close, volume, timestamp }
    this.candleCacheSeeded = false; // Track if initial kline seed has been done
  }

  // Helper: Convert timeframe string to milliseconds
  getTimeframeMs(timeframe) {
    const tf = timeframe.toLowerCase();
    const value = parseInt(tf) || 1;

    if (tf.endsWith('w')) return value * 7 * 24 * 60 * 60 * 1000;
    if (tf.endsWith('d')) return value * 24 * 60 * 60 * 1000;
    if (tf.endsWith('h')) return value * 60 * 60 * 1000;
    if (tf.endsWith('m')) return value * 60 * 1000;

    return 5 * 60 * 1000; // Default 5 minutes
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

      // 🔥 NEW: Seed candle cache with real kline data (one-time, rate-limited)
      if (!this.candleCacheSeeded) {
        this.seedCandleCache().catch((err) => {
          console.warn("⚠️ Candle cache seeding failed, charts may use API fallback:", err.message);
        });
      }

      // ALWAYS connect to WebSocket (even if REST failed)
      // WebSocket has no rate limit issues
      this.connectWebSocket();
    } catch (error) {
      console.error("❌ Binance connection failed:", error);
      setTimeout(() => this.connectToBinance(), this.reconnectInterval);
    }
  }

  /**
   * 🔥 NEW: Seed candle cache with REAL kline data from Binance API
   * Called once at startup. Fetches 100 candles per symbol for the user's preferred timeframe.
   * Rate-limited: 1 request per 2 seconds to avoid IP bans.
   */
  async seedCandleCache() {
    if (this.candleCacheSeeded) return;
    this.candleCacheSeeded = true; // Prevent duplicate seeding

    console.log("🌱 Starting candle cache seeding with real kline data...");

    // Get symbols that need seeding — use favorited symbols from Redis, or top symbols
    let symbolsToSeed = [];
    try {
      // Get all user favorites from Redis
      const keys = await redis.keys("user:*:favorites");
      const favoriteSets = new Set();
      for (const key of keys) {
        const favs = await redis.smembers(key);
        favs.forEach(f => favoriteSets.add(f));
      }
      symbolsToSeed = Array.from(favoriteSets);
    } catch (e) {
      console.warn("⚠️ Could not fetch user favorites for seeding:", e.message);
    }

    // Fallback: use top popular symbols if no favorites found
    if (symbolsToSeed.length === 0) {
      symbolsToSeed = [
        "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
        "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
        "MATICUSDT", "NEARUSDT", "ATOMUSDT", "UNIUSDT", "LTCUSDT",
      ];
    }

    // Limit to prevent excessive API calls
    const maxSymbols = Math.min(symbolsToSeed.length, 50);
    const symbols = symbolsToSeed.slice(0, maxSymbols);
    const timeframes = ["5m", "15m", "1h"]; // Most commonly used timeframes

    console.log(`🌱 Seeding ${symbols.length} symbols × ${timeframes.length} timeframes = ${symbols.length * timeframes.length} API calls (rate-limited)`);

    let seeded = 0;
    let failed = 0;

    for (const symbol of symbols) {
      for (const tf of timeframes) {
        // Skip if already seeded (e.g., from a previous partial run)
        if (candleCache.isCacheSeeded(symbol, tf)) {
          continue;
        }

        try {
          // Check IP ban
          if (Date.now() < ipBannedUntil) {
            console.warn("🚫 IP banned, stopping candle seeding");
            return;
          }

          // Rate limit: wait 2 seconds between API calls
          await new Promise(resolve => setTimeout(resolve, 2000));

          const normalizedSymbol = symbol.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
          const url = `https://api.binance.com/api/v3/klines?symbol=${normalizedSymbol}&interval=${tf}&limit=100`;

          const res = await axios.get(url, {
            timeout: 10000,
            headers: { "User-Agent": "Mozilla/5.0" },
          });

          if (res.data && res.data.length > 0) {
            const candles = res.data.map(c => ({
              timestamp: c[0],
              open: parseFloat(c[1]),
              high: parseFloat(c[2]),
              low: parseFloat(c[3]),
              close: parseFloat(c[4]),
              volume: parseFloat(c[5]),
            }));

            await candleCache.storeCandles(symbol, tf, candles);
            seeded++;
            console.log(`✅ Seeded ${candles.length} candles for ${symbol}/${tf}`);

            // Also initialize liveCandles tracker with the last candle boundary
            const lastCandle = candles[candles.length - 1];
            const liveKey = `${symbol}_${tf}`;
            this.liveCandles.set(liveKey, {
              timestamp: lastCandle.timestamp,
              open: lastCandle.open,
              high: lastCandle.high,
              low: lastCandle.low,
              close: lastCandle.close,
              volume: lastCandle.volume,
            });
          }
        } catch (error) {
          failed++;
          if (error.response?.status === 418) {
            ipBannedUntil = Date.now() + 600000;
            console.error("🚫 HTTP 418 during seeding: IP banned! Stopping.");
            return;
          }
          // Don't log every error to reduce noise
          if (failed <= 5) {
            console.warn(`⚠️ Seed failed for ${symbol}/${tf}: ${error.message}`);
          }
        }
      }
    }

    console.log(`🌱 Candle cache seeding complete: ${seeded} seeded, ${failed} failed`);
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

      // 🔥 FIX: Build PROPER candles from tick data (not 24h OHLCV!)
      // Track open price per boundary, update high/low/close from ticks
      const timeframes = ["5m", "15m", "1h", "4h", "1d"];

      for (const tf of timeframes) {
        const tfMs = this.getTimeframeMs(tf);
        const candleTimestamp = Math.floor(data.timestamp / tfMs) * tfMs;
        const liveKey = `${data.symbol}_${tf}`;
        const existing = this.liveCandles.get(liveKey);

        if (existing && existing.timestamp === candleTimestamp) {
          // SAME candle boundary — update high/low/close only
          existing.high = Math.max(existing.high, data.price);
          existing.low = Math.min(existing.low, data.price);
          existing.close = data.price;
          // Don't overwrite volume with 24h volume — keep existing
        } else {
          // NEW candle boundary — save old candle to cache, start new one
          if (existing && existing.timestamp !== candleTimestamp) {
            // Flush the completed candle to cache
            candleCache.storeCandle(data.symbol, tf, { ...existing }).catch(() => {});
          }

          // Start a fresh candle with tick price as OHLC
          this.liveCandles.set(liveKey, {
            timestamp: candleTimestamp,
            open: data.price,
            high: data.price,
            low: data.price,
            close: data.price,
            volume: 0, // Will accumulate from ticks
          });
        }

        // Store current state to cache (updates the "in-progress" candle)
        const currentCandle = this.liveCandles.get(liveKey);
        candleCache.storeCandle(data.symbol, tf, { ...currentCandle }).catch(() => {});
      }

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
        console.log("🔄 Starting 2-hour scheduled refresh (pairs list only)...");

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

        console.log("✅ Hourly refresh complete (WebSocket handles price updates)");

      } catch (error) {
        console.error("❌ Error during scheduled refresh:", error);
      }
    }, 7200000); // 🔥 Every 2 hour (faster detection of new pairs like OMNI)
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
