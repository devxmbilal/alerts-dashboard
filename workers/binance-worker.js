import Redis from "ioredis";
import WebSocket from "ws";

// Redis configuration
const redis = new Redis({
  host: "localhost",
  port: 6379,
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
  timeout: 10000, // 10 second timeout
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "application/json",
    Connection: "keep-alive",
  },
};

// Track active connections
const activeConnections = new Map();
const subscribedPairs = new Set();

// Dynamic USDT pairs - will be fetched from Binance
let USDT_PAIRS = [];

// Robust fetch function with retry logic
async function robustFetch(url, options = {}) {
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

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.log(`✅ Successfully connected to ${url}`);
      return response;
    } catch (error) {
      lastError = error;
      console.log(`❌ Attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
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
    this.publishThrottle = 500; // Throttle to max 2 publishes per second
  }

  async start() {
    console.log("🚀 Starting Binance Worker...");
    await this.connectToRedis();
    await this.connectToBinance();
    this.startHeartbeat();
    this.startPairCleanup(); // Start periodic pair cleanup
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
      // First, fetch all available USDT spot pairs
      await this.fetchAllUSDTSPairs();

      // Get 24hr ticker data for all pairs
      await this.fetchInitialData();

      // Connect to WebSocket for real-time updates
      this.connectWebSocket();
    } catch (error) {
      console.error("❌ Binance connection failed:", error);
      setTimeout(() => this.connectToBinance(), this.reconnectInterval);
    }
  }

  async fetchAllUSDTSPairs() {
    try {
      console.log("📊 Fetching all USDT spot pairs from Binance...");

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
            !symbol.symbol.includes("UP") && // Exclude leveraged tokens
            !symbol.symbol.includes("DOWN") && // Exclude leveraged tokens
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

      // Cache the pairs list in Redis
      await redis.setex("crypto:usdt_pairs", 3600, JSON.stringify(USDT_PAIRS)); // 1 hour cache
    } catch (error) {
      console.error("❌ Failed to fetch USDT pairs:", error);
      // Fallback to default pairs if API fails
      USDT_PAIRS = [
        "btcusdt",
        "ethusdt",
        "adausdt",
        "solusdt",
        "dotusdt",
        "linkusdt",
        "uniusdt",
        "avaxusdt",
        "maticusdt",
        "atomusdt",
      ];
    }
  }

  async fetchInitialData() {
    try {
      console.log("📊 Fetching initial market data...");

      // Fetch 24hr ticker data for all pairs
      const response = await fetchWithFallback("/ticker/24hr");
      const tickers = await response.json();

      // Process and cache data
      for (const ticker of tickers) {
        if (USDT_PAIRS.includes(ticker.symbol.toLowerCase())) {
          const processedData = this.processTickerData(ticker);
          await this.cacheAndPublish(processedData);
        }
      }

      console.log(`✅ Initial data loaded for ${tickers.length} pairs`);
    } catch (error) {
      console.error("❌ Failed to fetch initial data:", error);
    }
  }

  connectWebSocket() {
    try {
      // Create multiple WebSocket connections to cover all pairs
      const maxStreams = 200;
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
          `🔌 Connection ${i + 1}: Streaming pairs ${start + 1}-${end} (${
            pairsToStream.length
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
      volume: parseFloat(ticker.v),
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
      // Cache in Redis
      const cacheKey = `crypto:${data.symbol}`;
      await redis.setex(cacheKey, 300, JSON.stringify(data)); // 5 min cache

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

  startPairCleanup() {
    // Clean up delisted pairs every 5 minutes
    setInterval(async () => {
      try {
        console.log("🧹 Starting pair cleanup...");

        // Get current valid pairs from Binance with fallback
        const response = await fetchWithFallback("/exchangeInfo");
        const exchangeInfo = await response.json();

        const validSymbols = exchangeInfo.symbols
          .filter(
            (symbol) =>
              symbol.status === "TRADING" &&
              symbol.symbol.endsWith("USDT") &&
              symbol.isSpotTradingAllowed === true
          )
          .map((symbol) => symbol.symbol.toLowerCase());

        // Get all cached pairs from Redis
        const allKeys = await redis.keys("crypto:*");
        const cryptoKeys = allKeys.filter(
          (key) => key !== "crypto:usdt_pairs" && !key.includes("undefined")
        );

        let removedCount = 0;
        for (const key of cryptoKeys) {
          const symbol = key.replace("crypto:", "").toUpperCase();
          if (!validSymbols.includes(symbol.toLowerCase())) {
            await redis.del(key);
            removedCount++;
            console.log(`🗑️ Removed delisted pair: ${symbol}`);
          }
        }

        if (removedCount > 0) {
          console.log(
            `🧹 Cleanup complete: Removed ${removedCount} delisted pairs`
          );
        }

        // Update USDT_PAIRS with current valid pairs
        const newUSDT_PAIRS = exchangeInfo.symbols
          .filter((symbol) => {
            return (
              symbol.status === "TRADING" &&
              symbol.symbol.endsWith("USDT") &&
              symbol.isSpotTradingAllowed === true &&
              !symbol.symbol.includes("_") &&
              !symbol.symbol.includes("BULL") &&
              !symbol.symbol.includes("BEAR") &&
              !symbol.symbol.includes("UP") &&
              !symbol.symbol.includes("DOWN") &&
              !symbol.symbol.includes("3L") &&
              !symbol.symbol.includes("3S") &&
              !symbol.symbol.includes("5L") &&
              !symbol.symbol.includes("5S") &&
              symbol.baseAsset !== "BUSD" &&
              symbol.quoteAsset === "USDT"
            );
          })
          .map((symbol) => symbol.symbol.toLowerCase())
          .sort();

        if (newUSDT_PAIRS.length !== USDT_PAIRS.length) {
          USDT_PAIRS = newUSDT_PAIRS;
          await redis.setex(
            "crypto:usdt_pairs",
            3600,
            JSON.stringify(USDT_PAIRS)
          );
          console.log(`📊 Updated USDT pairs: ${USDT_PAIRS.length} pairs`);
        }
      } catch (error) {
        console.error("❌ Error during pair cleanup:", error);
        console.log("⚠️ Pair cleanup failed, will retry in next cycle");
        // Don't throw error to prevent interval from stopping
      }
    }, 300000); // Every 5 minutes
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
