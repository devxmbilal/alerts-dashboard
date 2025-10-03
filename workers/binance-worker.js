const Redis = require("ioredis");
const WebSocket = require("ws");

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

// Track active connections
const activeConnections = new Map();
const subscribedPairs = new Set();

// Dynamic USDT pairs - will be fetched from Binance
let USDT_PAIRS = [];

class BinanceWorker {
  constructor() {
    this.ws = null;
    this.reconnectInterval = 5000;
    this.isConnected = false;
    this.heartbeatInterval = null;
  }

  async start() {
    console.log("🚀 Starting Binance Worker...");
    await this.connectToRedis();
    await this.connectToBinance();
    this.startHeartbeat();
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
      const response = await fetch(`${BINANCE_REST_API}/exchangeInfo`);
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
      const response = await fetch(`${BINANCE_REST_API}/ticker/24hr`);
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
      // Create stream names for all pairs (limit to 200 streams max per connection)
      const maxStreams = 200;
      const pairsToStream = USDT_PAIRS.slice(0, maxStreams);
      const streams = pairsToStream.map((pair) => `${pair}@ticker`).join("/");
      const wsUrl = `${BINANCE_WS_BASE}/${streams}`;

      console.log(
        `🔌 Connecting to Binance WebSocket for ${pairsToStream.length} pairs...`
      );
      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => {
        console.log("✅ Binance WebSocket connected");
        this.isConnected = true;
        this.reconnectInterval = 5000; // Reset reconnect interval
      });

      this.ws.on("message", async (data) => {
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

      this.ws.on("close", () => {
        console.log("🔌 Binance WebSocket disconnected");
        this.isConnected = false;
        this.reconnect();
      });

      this.ws.on("error", (error) => {
        console.error("❌ Binance WebSocket error:", error);
        this.isConnected = false;
        this.reconnect();
      });
    } catch (error) {
      console.error("❌ WebSocket connection failed:", error);
      this.reconnect();
    }
  }

  processTickerData(ticker) {
    return {
      symbol: ticker.s,
      price: parseFloat(ticker.c),
      change: parseFloat(ticker.P),
      changeAmount: parseFloat(ticker.p),
      volume: parseFloat(ticker.v),
      high24h: parseFloat(ticker.h),
      low24h: parseFloat(ticker.l),
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

      // Publish to Redis pub/sub
      await redis.publish(
        "market:updates",
        JSON.stringify({
          type: "ticker_update",
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

module.exports = BinanceWorker;
