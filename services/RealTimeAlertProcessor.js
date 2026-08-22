import { AlertsCache, FavoritesCache } from "../utils/redis.js";
import { isAlertLocked, updateAlertLock } from "../utils/alertLock.js";
import AlertHistoryService from "./AlertHistoryService.js";
import Alert from "../models/Alert.js";
import AlertHistory from "../models/AlertHistory.js";
import User from "../models/User.js";
import AlertRedisService from "./AlertRedisService.js";
import SafeAlertProcessor from "../utils/alertProcessor.js";
import MicroBatchExecutionEngine from "../utils/MicroBatchEngine.js";
import ChartScreenshotService from "../utils/chartScreenshot.js"; // 🔥 NEW: Pre-capture chart at trigger time
import pLimit from "p-limit";
import dotenv from "dotenv";
import WebSocket from "ws";
dotenv.config();
// Routine per-symbol, per-tick diagnostics are gated behind this. With ~280
// symbols x 7 timeframes evaluated continuously they were producing 10-16MB
// of log every 1-2 minutes (~1GB retained), which is real disk I/O pressure
// on the box for lines nobody reads unless actively debugging. Errors,
// warnings about genuine problems, alert triggers and shield decisions are
// deliberately NOT gated -- only the routine chatter is.
const ALERT_VERBOSE_LOGS = process.env.ALERT_VERBOSE_LOGS === "1";

class RealTimeAlertProcessor {
  constructor() {
    this.activeAlerts = new Map(); // symbol -> alert data
    this.processedAlerts = new Set(); // Track processed alerts to avoid duplicates
    this.isProcessing = false;
    this.alertIds = new Set(); // Track which alert IDs are currently active
    this.alertBaselines = new Map(); // Track baseline prices for change calculations
    this.redisSubscribed = false; // Track Redis subscription status
    // Returned by acquireAlertLock when Redis itself is unavailable, so the
    // caller can tell infrastructure trouble apart from real lock contention.
    this.NO_REDIS_LOCK = "__no_redis_lock__";
    this.candleData = new Map(); // Track candle data for timeframe-based changes
    // Concurrency limit for parallel alert processing - INCREASED for 95% accuracy
    this.processLimit = pLimit(200); // 🔥 SPEED: 200 concurrent (was 100)
    // Initialize SafeAlertProcessor for race condition protection
    this.safeProcessor = new SafeAlertProcessor();
    // Initialize Micro-Batch Execution Engine - OPTIMIZED for 95% accuracy
    this.microBatchEngine = new MicroBatchExecutionEngine({
      batchSize: 50,       // Smaller batches = faster processing
      batchInterval: 20,   // 20ms window (was 50ms)
      maxConcurrentBatches: 30,
      targetThroughput: 100000, // 100k alerts per minute
    });
    this.rsiData = new Map(); // Track RSI values for each symbol+timeframe: key = "symbol_timeframe_period", value = { current: number, previous: number }
    this.openInterestData = new Map(); // Track Open Interest for each symbol+timeframe: key = "symbol_timeframe", value = { current: number, baseline: number, timestamp: number }
    this.redisPublisher = null; // Cached Redis publisher connection
    // WebSocket real-time processing
    this.binanceWebSocket = null; // Binance WebSocket connection
    this.livePrices = {}; // Live prices cache: symbol -> { price, volume, etc. }
    this.isWebSocketRunning = false; // Track WebSocket status

    // Kline WebSocket feed (feature-flagged: ENABLE_KLINE_WS=1). Writes into
    // the same this.candleCache the REST candleQueue path already uses, so
    // it's an additive data source, not a replacement -- see
    // startBinanceKlineWebSocket() for the full rationale.
    this.klineWebSockets = []; // Binance kline WebSocket connections (one per chunk)
    this.isKlineWebSocketRunning = false; // Track kline WebSocket status
    this.redisClient = null; // Redis client for cache operations (get/set)
    this.redisSubscriber = null; // Redis client for pub/sub operations (separate connection)
    this.dbQueueClient = null; // Redis client for database queue operations
    this.dbQueueStreamName = "db:operations:queue"; // Redis Stream name for DB operations
    this.heartbeatInterval = null; // Heartbeat interval for health monitoring

    // 🛡️ API RATE LIMITER - Fix for 418 Error
    this.rsiQueue = []; // Queue for RSI calculation requests
    this.isProcessingRsiQueue = false; // Queue processing state
    this.apiBanUntil = 0; // API ban timestamp
    this.rsiHistory = new Map(); // RSI history cache for local calculation

    // 🛡️ CANDLE FETCH QUEUE - Fix for Candle 418 Error
    this.candleQueue = []; // Queue for candle fetch requests
    this.isProcessingCandleQueue = false; // Candle queue processing state
    this.pendingCandleRequests = new Set(); // Prevent duplicate requests
    this.candleCache = new Map(); // Cache for fetched candles
    this.candleApiBanUntil = 0; // Candle API ban timestamp
    this.volumeCompareCache = new Map(); // 🔥 Cache for per-timeframe volume comparison

    // 🛡️ CIRCUIT BREAKER - Prevent infinite retry loops
    this.rsiFailures = new Map(); // Track RSI calculation failures

    // 🔥 OI CHANGE - Open Interest polling infrastructure
    this.oiQueue = []; // Queue for OI fetch requests
    this.isProcessingOiQueue = false; // OI queue processing state
    this.oiApiBanUntil = 0; // OI API ban timestamp
    this.oiCache = new Map(); // Cache: "SYMBOL" -> { openInterest: number, timestamp: number }
    this.oiBaselines = new Map(); // Baseline: "SYMBOL_TIMEFRAME" -> { oi: number, candleStart: number }
    this.oiUnsupportedSymbols = new Set(); // Symbols with no Binance Futures market
    this.oiPollingInterval = null; // Interval handle for OI polling loop
    this.OI_POLL_INTERVAL_MS = 30000; // Poll OI every 30 seconds
    this.OI_CACHE_TTL_MS = 25000; // Cache OI for 25 seconds (slightly less than poll interval)
    this.pendingOiRequests = new Set(); // Prevent duplicate OI requests
  }

  // Get or create Redis publisher connection (reused for performance)
  async getRedisPublisher() {
    // Return existing connection if ready
    if (this.redisPublisher && this.redisPublisher.status === "ready") {
      return this.redisPublisher;
    }

    // Reconnect if connection exists but not ready
    if (this.redisPublisher && this.redisPublisher.status !== "ready") {
      try {
        await this.redisPublisher.connect();
        if (this.redisPublisher.status === "ready") {
          return this.redisPublisher;
        }
      } catch (err) {
        console.warn(
          "⚠️ Failed to reconnect Redis publisher, creating new:",
          err.message
        );
        this.redisPublisher = null;
      }
    }

    // Create new connection
    const Redis = (await import("ioredis")).default;
    this.redisPublisher = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
      lazyConnect: false, // Connect immediately for better performance
      retryDelayOnClusterDown: 300,
      maxRetriesPerRequest: 5, // More retries for reliability
      enableReadyCheck: false,
      keepAlive: 30000, // Keep connection alive (30s)
      connectTimeout: 10000, // 10s connection timeout
    });

    // Handle connection errors - reset on error to allow reconnection
    this.redisPublisher.on("error", (err) => {
      console.error("❌ Redis publisher error:", err.message);
      // Don't reset immediately - let it try to reconnect
      // Only reset if connection is completely dead
      if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
        this.redisPublisher = null;
      }
    });

    // Handle connection close
    this.redisPublisher.on("close", () => {
      console.warn("⚠️ Redis publisher connection closed");
      this.redisPublisher = null;
    });

    // Wait for connection to be ready (lazyConnect: false means it connects automatically)
    // But we wait to ensure it's ready before returning
    return new Promise((resolve, reject) => {
      if (this.redisPublisher.status === "ready") {
        resolve(this.redisPublisher);
        return;
      }

      this.redisPublisher.once("ready", () => {
        console.log("✅ Redis publisher connection established");
        resolve(this.redisPublisher);
      });

      this.redisPublisher.once("error", (err) => {
        console.error("❌ Failed to connect Redis publisher:", err.message);
        this.redisPublisher = null;
        reject(err);
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.redisPublisher && this.redisPublisher.status !== "ready") {
          console.error("❌ Redis publisher connection timeout");
          this.redisPublisher = null;
          reject(new Error("Redis connection timeout"));
        }
      }, 10000);
    });
  }

  async loadAlertsFromRedis(userId) {
    try {
      const alerts = await AlertsCache.getUserAlerts(userId);
      if (alerts && alerts.length > 0) {
        return alerts;
      }
      return [];
    } catch (error) {
      console.error("❌ Error loading alerts from Redis:", error);
      return [];
    }
  }

  // Initialize Redis client for cache operations
  async initRedisClient() {
    try {
      if (this.redisClient) {
        return this.redisClient;
      }

      const Redis = (await import("ioredis")).default;
      this.redisClient = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT || 6379,
        lazyConnect: false,
        retryDelayOnClusterDown: 300,
        maxRetriesPerRequest: 5,
        enableReadyCheck: false,
        keepAlive: 30000,
        connectTimeout: 10000,
      });

      this.redisClient.on("error", (err) => {
        console.error("❌ Redis cache client error:", err.message);
      });

      this.redisClient.on("close", () => {
        // Deliberately keep the client: ioredis reconnects it on its own.
        // Nulling it here made the next call construct a second client while
        // the first kept retrying forever — one orphan per blip.
        console.warn("⚠️ Redis cache client connection closed (auto-reconnecting)");
      });

      console.log("✅ Redis cache client initialized");
      return this.redisClient;
    } catch (error) {
      console.error("❌ Error initializing Redis cache client:", error);
      return null;
    }
  }

  // Initialize Redis client for database queue operations
  async initDbQueueClient() {
    try {
      if (this.dbQueueClient) {
        return this.dbQueueClient;
      }

      const Redis = (await import("ioredis")).default;
      this.dbQueueClient = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT || 6379,
        lazyConnect: false,
        retryDelayOnClusterDown: 300,
        maxRetriesPerRequest: 5,
        enableReadyCheck: false,
        keepAlive: 30000,
        connectTimeout: 10000,
      });

      this.dbQueueClient.on("error", (err) => {
        console.error("❌ Redis DB queue client error:", err.message);
      });

      this.dbQueueClient.on("close", () => {
        // Same reasoning as the cache client — let ioredis reconnect this one.
        console.warn("⚠️ Redis DB queue client connection closed (auto-reconnecting)");
      });

      console.log("✅ Redis DB queue client initialized");
      return this.dbQueueClient;
    } catch (error) {
      console.error("❌ Error initializing Redis DB queue client:", error);
      return null;
    }
  }

  // Acquire Redis lock for alert processing (prevents duplicate processing)
  async acquireAlertLock(alertId, ttl = 2000) {
    try {
      const redis = await this.initRedisClient();
      if (!redis) {
        // Redis is down, not busy. Returning null here would read as "someone
        // else holds the lock" and drop the alert, so hand back a sentinel that
        // lets processing continue unlocked.
        return this.NO_REDIS_LOCK;
      }

      const lockKey = `lock:alert:${alertId}`;
      const token = String(Math.random() + Date.now());

      // Try to acquire lock (NX = only set if not exists, PX = expire in milliseconds)
      const ok = await redis.set(lockKey, token, "NX", "PX", ttl);

      if (ok === "OK" || ok === true) {
        return token;
      }

      return null; // Lock already exists, another worker is processing
    } catch (error) {
      console.error(
        `❌ Error acquiring lock for alert ${alertId}:`,
        error.message
      );
      // A command error means the lock state is unknown, which is an
      // infrastructure problem rather than contention — fail open, as the
      // duplicate-suppression below (lastFiredDivergence / alertCount) still holds.
      return this.NO_REDIS_LOCK;
    }
  }

  // Release Redis lock for alert processing
  async releaseAlertLock(alertId, token) {
    try {
      if (token === this.NO_REDIS_LOCK) return false; // nothing was ever taken
      const redis = await this.initRedisClient();
      if (!redis) {
        return false;
      }

      const lockKey = `lock:alert:${alertId}`;

      // Use Lua script for atomic check-and-delete (prevents deleting wrong lock)
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;

      await redis.eval(luaScript, 1, lockKey, token);
      return true;
    } catch (error) {
      console.error(
        `❌ Error releasing lock for alert ${alertId}:`,
        error.message
      );
      return false;
    }
  }

  // Enqueue database operation to Redis Queue (Streams or Lists)
  async enqueueDbOperation(operation) {
    try {
      const redis = await this.initDbQueueClient();
      if (!redis) {
        console.error("❌ Redis DB queue client not available");
        return false;
      }

      const operationData = {
        type: operation.type, // 'update_alert', 'update_baseline', etc.
        alertId: operation.alertId,
        data: operation.data,
        timestamp: Date.now(),
        priority: operation.priority || "normal", // 'high', 'normal', 'low'
      };

      try {
        // Try Redis Streams first (Redis 5.0+)
        await redis.xadd(
          this.dbQueueStreamName,
          "*", // Auto-generate ID
          "operation",
          JSON.stringify(operationData)
        );
        return true;
      } catch (streamError) {
        // Fallback to Redis Lists (works on all Redis versions)
        if (
          streamError.message.includes("unknown command") ||
          streamError.message.includes("xadd")
        ) {
          await redis.lpush(
            this.dbQueueStreamName,
            JSON.stringify(operationData)
          );
          return true;
        }
        throw streamError;
      }
    } catch (error) {
      console.error("❌ Error enqueueing DB operation:", error.message);
      return false;
    }
  }

  // Load all active alerts from DB and cache in Redis (organized by symbol for fast lookup)
  async loadAlertsToRedisCache() {
    try {
      const redis = await this.initRedisClient();
      if (!redis) {
        console.error("❌ Redis client not available for caching alerts");
        return false;
      }

      // Get all active alerts from MongoDB
      const alerts = await Alert.find({
        status: "active",
      }).lean();

      if (alerts.length === 0) {
        console.log("⚠️ No active alerts to cache");
        // Clear existing cache
        await redis.del("alerts:cache:all");
        return true;
      }

      // Group alerts by symbol for fast lookup
      const alertsBySymbol = {};
      const allAlertIds = [];

      for (const alert of alerts) {
        const symbol = alert.symbol;
        if (!alertsBySymbol[symbol]) {
          alertsBySymbol[symbol] = [];
        }
        alertsBySymbol[symbol].push(alert);
        allAlertIds.push(alert._id.toString());
      }

      // Cache alerts by symbol (for fast lookup when price updates)
      // No TTL - cache is updated automatically on alert create/update/delete events
      for (const [symbol, symbolAlerts] of Object.entries(alertsBySymbol)) {
        const cacheKey = `alerts:cache:${symbol}`;
        await redis.set(cacheKey, JSON.stringify(symbolAlerts));
      }

      // Also cache all alerts for full reload
      await redis.set("alerts:cache:all", JSON.stringify(alerts));

      // Update in-memory activeAlerts map
      this.activeAlerts.clear();
      for (const [symbol, symbolAlerts] of Object.entries(alertsBySymbol)) {
        this.activeAlerts.set(symbol, symbolAlerts);
      }

      console.log(
        `✅ Cached ${alerts.length} alerts for ${Object.keys(alertsBySymbol).length
        } symbols in Redis`
      );

      await this.rehydrateDivergenceDedup(alerts);

      return true;
    } catch (error) {
      console.error("❌ Error loading alerts to Redis cache:", error);
      return false;
    }
  }

  // Divergence dedup only lives in memory, so a restart forgets which pivot it
  // already alerted on — a divergence on a slow timeframe (12HR, D, W) can still
  // be "the same one" hours later, and the fresh process would fire it again as
  // if new. Rehydrate from each alert's last saved divergence trigger so a
  // restart doesn't repeat an alert already sent. This runs on every full alert
  // load, which is exactly when the in-memory dedup map is empty and needs it.
  async rehydrateDivergenceDedup(alerts) {
    try {
      const divergenceAlertIds = alerts
        .filter((a) => a.conditions?.rsiDivergence?.timeframes?.length)
        .map((a) => a._id);

      if (!divergenceAlertIds.length) return;

      const recentDivergences = await AlertHistory.aggregate([
        {
          $match: {
            alertId: { $in: divergenceAlertIds },
            "divergence.pivot2.time": { $exists: true },
          },
        },
        { $sort: { triggeredAt: -1 } },
        { $group: { _id: "$alertId", divergence: { $first: "$divergence" } } },
      ]);

      if (!this.lastFiredDivergence) this.lastFiredDivergence = new Map();
      for (const r of recentDivergences) {
        const signature = `${r.divergence.timeframe}:${r.divergence.type}:${r.divergence.pivot2?.time}`;
        this.lastFiredDivergence.set(r._id.toString(), signature);
      }
      console.log(
        `🔁 Rehydrated divergence dedup memory for ${recentDivergences.length} alerts`
      );
    } catch (err) {
      console.error("❌ Error rehydrating divergence dedup memory:", err.message);
    }
  }

  // Get alerts for a symbol from Redis cache
  async getAlertsFromCache(symbol) {
    try {
      const redis = await this.initRedisClient();
      if (!redis) {
        return [];
      }

      const cacheKey = `alerts:cache:${symbol}`;
      const cached = await redis.get(cacheKey);

      if (cached) {
        return JSON.parse(cached);
      }
      return [];
    } catch (error) {
      console.error(`❌ Error getting alerts from cache for ${symbol}:`, error);
      return [];
    }
  }

  // Update alert in Redis cache after trigger
  async updateAlertInCache(alert) {
    try {
      const redis = await this.initRedisClient();
      if (!redis) {
        return false;
      }

      const symbol = alert.symbol;
      const cacheKey = `alerts:cache:${symbol}`;
      const alertIdStr = alert._id.toString();

      // Get existing alerts for this symbol
      const existingAlerts = await this.getAlertsFromCache(symbol);

      // 🔥 OPTIMIZATION: Use Map for O(1) lookup instead of O(A) findIndex
      const alertMap = new Map(existingAlerts.map((a, idx) => [a._id.toString(), idx]));
      const alertIndex = alertMap.get(alertIdStr);

      if (alertIndex !== undefined) {
        existingAlerts[alertIndex] = alert;
      } else {
        existingAlerts.push(alert);
      }

      // Update cache (no TTL - cache is updated automatically on alert events)
      await redis.set(cacheKey, JSON.stringify(existingAlerts));

      // Also update in-memory map using same O(1) approach
      if (this.activeAlerts.has(symbol)) {
        const inMemoryAlerts = this.activeAlerts.get(symbol);
        const memMap = new Map(inMemoryAlerts.map((a, idx) => [a._id.toString(), idx]));
        const inMemoryIndex = memMap.get(alertIdStr);
        if (inMemoryIndex !== undefined) {
          inMemoryAlerts[inMemoryIndex] = alert;
        }
      }

      return true;
    } catch (error) {
      console.error(`❌ Error updating alert in cache:`, error);
      return false;
    }
  }

  async loadAllActiveAlerts() {
    try {
      console.log("🔄 Loading all active alerts from database...");

      // Get all active alerts from MongoDB (including previously triggered ones)
      const alerts = await Alert.find({
        status: "active",
        // Don't filter by triggered: false - we want retriggerable alerts
      }).lean();

      console.log(`📊 Found ${alerts.length} active alerts in database`);

      // Filter alerts to only include those for pairs still in user's favorites
      const validAlerts = [];
      const userFavoritesMap = new Map(); // Cache user favorites
      let inactiveCount = 0;

      for (const alert of alerts) {
        // Get user's current favorites (with caching)
        let userFavorites = userFavoritesMap.get(alert.userId);
        if (!userFavorites) {
          userFavorites = await this.getUserFavorites(alert.userId);
          userFavoritesMap.set(alert.userId, userFavorites);
        }

        // Only include alert if the symbol is still in user's favorites
        if (userFavorites && userFavorites.includes(alert.symbol)) {
          validAlerts.push(alert);
        } else {
          // Mark alert as inactive since pair is no longer favorited
          await Alert.findByIdAndUpdate(alert._id, { status: "inactive" });
          inactiveCount++;
          console.log(`⚠️ Alert ${alert._id} for ${alert.symbol} marked inactive (not in favorites)`);
        }
      }

      console.log(`✅ Valid alerts: ${validAlerts.length}, Marked inactive: ${inactiveCount}`);

      // Group valid alerts by symbol for fast lookup
      this.activeAlerts.clear();
      validAlerts.forEach((alert) => {
        if (!this.activeAlerts.has(alert.symbol)) {
          this.activeAlerts.set(alert.symbol, []);
        }
        this.activeAlerts.get(alert.symbol).push(alert);
      });

      console.log(`📊 Active symbols: ${this.activeAlerts.size}`);

      await this.rehydrateDivergenceDedup(validAlerts);

      // 🔥 CRITICAL FIX: Update MicroBatchEngine's activeSymbolsSet
      // This ensures the engine only processes symbols with valid alerts
      await this.updateMicroBatchActiveSymbols();
      console.log(`✅ MicroBatchEngine activeSymbols updated after loading alerts`);

      return validAlerts;
    } catch (error) {
      console.error("❌ Error loading active alerts:", error);
      return [];
    }
  }

  // ============================================
  // NEW: WebSocket-based Real-Time Processing
  // ============================================

  // Start WebSocket connection to Binance for real-time price updates
  // 🔥 FIX: Uses data-stream.binance.vision with per-symbol streams
  // because !ticker@arr broadcast is blocked on this AWS Singapore IP
  startWebSocketPriceFeed() {
    if (this.isWebSocketRunning) {
      console.log("⚠️ WebSocket already running");
      return;
    }

    console.log("🚀 Starting Binance WebSocket price feed...");

    try {
      // Build streams list from active symbols
      const activeSymbols = Array.from(this.microBatchEngine.activeSymbolsSet);
      if (activeSymbols.length === 0) {
        console.log("⚠️ No active symbols, retrying in 5 seconds...");
        setTimeout(() => this.startWebSocketPriceFeed(), 5000);
        return;
      }

      // Binance limits combined streams to ~200 per connection
      // Split into chunks and connect to each
      const CHUNK_SIZE = 200;
      const symbolChunks = [];
      for (let i = 0; i < activeSymbols.length; i += CHUNK_SIZE) {
        symbolChunks.push(activeSymbols.slice(i, i + CHUNK_SIZE));
      }

      console.log(`📊 Subscribing to ${activeSymbols.length} symbols in ${symbolChunks.length} WebSocket connection(s)`);

      // Store all connections for cleanup
      this.binanceWebSockets = this.binanceWebSockets || [];

      // Close any existing connections
      for (const ws of this.binanceWebSockets) {
        try { ws.close(); } catch (e) { /* ignore */ }
      }
      this.binanceWebSockets = [];

      // A generation tag for this subscription round. Each chunk reconnects
      // itself below, which would otherwise keep resurrecting a chunk that a
      // later full resubscribe (active-symbol-set changed) already replaced.
      // Only a chunk stamped with the still-current generation may reconnect.
      this._wsGeneration = (this._wsGeneration || 0) + 1;
      const generation = this._wsGeneration;

      // Updated on every ticker message. The watchdog below force-reconnects
      // the whole feed if this goes stale — catches a connection that silently
      // stops delivering data without ever firing "close" or "error" (a network
      // black hole rather than a clean disconnect), which per-chunk reconnect
      // can't detect since neither event tells it anything is wrong.
      this.lastWsMessageAt = Date.now();

      let connectedCount = 0;
      let initialConnectDone = false;
      let msgCount = 0;

      const connectChunk = (chunk, chunkIdx) => {
        const streams = chunk.map(s => `${s.toLowerCase()}@ticker`).join('/');
        const wsUrl = `wss://data-stream.binance.vision/stream?streams=${streams}`;

        const ws = new WebSocket(wsUrl);
        this.binanceWebSockets.push(ws);

        ws.on("open", () => {
          console.log(`✅ WebSocket ${chunkIdx + 1}/${symbolChunks.length} connected (${chunk.length} symbols)`);
          if (!initialConnectDone) {
            connectedCount++;
            if (connectedCount === symbolChunks.length) {
              initialConnectDone = true;
              this.isWebSocketRunning = true;
              console.log(`🚀 All ${symbolChunks.length} WebSocket connections established - LIVE`);
            }
          } else {
            // A chunk came back after a micro-disconnect — the feed as a whole
            // was already live, this just restores the piece that dropped.
            this.isWebSocketRunning = true;
          }
        });

        ws.on("message", (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            // Combined streams format: { stream: "btcusdt@ticker", data: { ... } }
            const ticker = parsed.data || parsed;

            if (!ticker || !ticker.s) return;

            msgCount++;
            this.lastWsMessageAt = Date.now();

            // Build array format compatible with existing micro-batch engine
            const tickerArray = [ticker];

            // Direct processing - all incoming symbols are relevant (pre-filtered by subscription)
            const priceData = {
              symbol: ticker.s,
              price: parseFloat(ticker.c),
              change: parseFloat(ticker.P),
              priceChangePercent: parseFloat(ticker.P),
              priceChange: parseFloat(ticker.p),
              volume: parseFloat(ticker.q),
              volume24h: parseFloat(ticker.q),
              high: parseFloat(ticker.h),
              low: parseFloat(ticker.l),
              open: parseFloat(ticker.o),
              close: parseFloat(ticker.c),
              timestamp: Date.now(),
              rawTicker: ticker,
            };

            // Update in-memory price cache directly
            this.livePrices[ticker.s] = priceData;

            // Update Redis cache via pipeline (batched every 5 seconds)
            this._pendingRedisUpdates = this._pendingRedisUpdates || new Map();
            this._pendingRedisUpdates.set(ticker.s, priceData);
            this._scheduleRedisFlush();

            // Add directly to micro-batch queue
            const relevantUpdates = new Map();
            relevantUpdates.set(ticker.s, priceData);
            this.microBatchEngine.addToBatch(relevantUpdates);

            // Log stats every 60 seconds (not every message)
            if (msgCount % 5000 === 0) {
              console.log(`📊 WS: ${msgCount} messages processed`);
            }
          } catch (error) {
            console.error("❌ Error parsing WebSocket message:", error.message);
          }
        });

        ws.on("error", (error) => {
          console.error(`❌ WebSocket ${chunkIdx + 1} error:`, error.message);
        });

        ws.on("close", () => {
          const idx = this.binanceWebSockets.indexOf(ws);
          if (idx > -1) this.binanceWebSockets.splice(idx, 1);

          // A newer full resubscribe already replaced this chunk — let it go
          // quietly instead of resurrecting a connection nobody tracks anymore.
          if (generation !== this._wsGeneration) return;

          console.log(`⚠️ WebSocket ${chunkIdx + 1} closed, reconnecting just this chunk in 3 seconds...`);
          // A micro-disconnect on one chunk used to require every other chunk
          // to also drop before anything reconnected — that chunk's ~200
          // symbols went dark until the rest of the market happened to fail
          // too. Reconnect only the chunk that actually dropped.
          this.isWebSocketRunning = false;
          setTimeout(() => {
            if (generation !== this._wsGeneration) return;
            connectChunk(chunk, chunkIdx);
          }, 3000);
        });
      };

      for (let chunkIdx = 0; chunkIdx < symbolChunks.length; chunkIdx++) {
        connectChunk(symbolChunks[chunkIdx], chunkIdx);
      }

      // Keep reference for backward compatibility
      this.binanceWebSocket = this.binanceWebSockets[0] || null;

      // Watchdog: force a full resubscribe if the entire feed goes quiet. A
      // clean disconnect is already handled per-chunk above; this exists for
      // the case where a connection stops delivering data without closing.
      if (this._wsWatchdogInterval) clearInterval(this._wsWatchdogInterval);
      this._wsWatchdogInterval = setInterval(() => {
        const silentMs = Date.now() - (this.lastWsMessageAt || 0);
        if (silentMs > 45000) {
          console.warn(`⚠️ WebSocket feed silent for ${Math.round(silentMs / 1000)}s — forcing full resubscribe`);
          this._wsGeneration = (this._wsGeneration || 0) + 1; // orphan any pending per-chunk reconnects
          for (const ws of this.binanceWebSockets) {
            try { ws.close(); } catch (e) { /* ignore */ }
          }
          this.binanceWebSockets = [];
          this.isWebSocketRunning = false;
          this.startWebSocketPriceFeed();
        }
      }, 20000);
    } catch (error) {
      console.error("❌ Error starting WebSocket:", error);
      this.isWebSocketRunning = false;
      setTimeout(() => this.startWebSocketPriceFeed(), 3000);
    }
  }

  // ============================================
  // NEW: WebSocket-based Kline (Candle) Feed
  // ============================================
  //
  // Feature-flagged (ENABLE_KLINE_WS=1, default off) replacement data path
  // for the REST-polling candleQueue/fetchAndStoreCandleData flow, which is
  // the root of the 429 rate-limit pressure documented above
  // addCandleToQueue's dedup fix. Mirrors startWebSocketPriceFeed() exactly
  // -- same chunking, generation-tagged reconnect, staleness watchdog -- but
  // subscribes to <symbol>@kline_<interval> streams instead of @ticker, and
  // writes into the SAME this.candleCache map, in the SAME shape
  // fetchAndStoreCandleData already produces ({open, high, low, close,
  // volume, quoteVolume, startTime, endTime, isComplete}), keyed identically
  // (`${symbol}_${timeframe}`). Every existing reader -- getCandleDataOrQueue,
  // the CANDLE_ABOVE_OPEN check, the HAMMER check -- needs zero changes:
  // they just start getting fresher cache hits and stop needing to queue.
  //
  // Monthly (1M) intentionally stays on the REST/queue path -- no stream is
  // subscribed for it here, so it keeps working exactly as it does today,
  // untouched by this migration. If the kline feed is down, stale, or a
  // symbol's chunk is mid-reconnect, getCandleDataOrQueue's existing
  // cache-miss fallback queues a REST fetch exactly as it always has --
  // this is a strictly additive data source, never a hard dependency.
  startBinanceKlineWebSocket() {
    if (this.isKlineWebSocketRunning) {
      console.log("⚠️ Kline WebSocket already running");
      return;
    }

    console.log("🚀 Starting Binance kline WebSocket feed...");

    try {
      const activeSymbols = Array.from(this.microBatchEngine.activeSymbolsSet);
      if (activeSymbols.length === 0) {
        console.log("⚠️ No active symbols for kline WS, retrying in 5 seconds...");
        setTimeout(() => this.startBinanceKlineWebSocket(), 5000);
        return;
      }

      // The 7 timeframes CANDLE_ABOVE_OPEN/HAMMER actually evaluate today
      // (see the "Checking 7 timeframes" log line). Monthly excluded, see
      // comment above.
      const KLINE_WS_TIMEFRAMES = ["5MIN", "15MIN", "1HR", "4HR", "12HR", "D", "W"];
      const KLINE_INTERVAL_TO_TF = {};
      for (const tf of KLINE_WS_TIMEFRAMES) {
        KLINE_INTERVAL_TO_TF[this.getBinanceInterval(tf)] = tf;
      }

      // One stream per (symbol, timeframe) pair -- flatten before chunking so
      // a single connection's combined-stream count stays bounded the same
      // way the ticker feed's is, regardless of how many timeframes exist.
      const pairs = [];
      for (const symbol of activeSymbols) {
        for (const timeframe of KLINE_WS_TIMEFRAMES) {
          pairs.push({ symbol, interval: this.getBinanceInterval(timeframe) });
        }
      }

      const CHUNK_SIZE = 200;
      const pairChunks = [];
      for (let i = 0; i < pairs.length; i += CHUNK_SIZE) {
        pairChunks.push(pairs.slice(i, i + CHUNK_SIZE));
      }

      console.log(`📊 Kline WS: subscribing to ${pairs.length} symbol/timeframe streams (${activeSymbols.length} symbols x ${KLINE_WS_TIMEFRAMES.length} timeframes) in ${pairChunks.length} connection(s)`);

      this.klineWebSockets = this.klineWebSockets || [];
      for (const ws of this.klineWebSockets) {
        try { ws.close(); } catch (e) { /* ignore */ }
      }
      this.klineWebSockets = [];

      // Same generation-tag pattern as the ticker feed -- see its comment.
      this._klineWsGeneration = (this._klineWsGeneration || 0) + 1;
      const generation = this._klineWsGeneration;

      this.lastKlineWsMessageAt = Date.now();

      let connectedCount = 0;
      let initialConnectDone = false;
      let msgCount = 0;

      const connectChunk = (chunk, chunkIdx) => {
        const streams = chunk.map(p => `${p.symbol.toLowerCase()}@kline_${p.interval}`).join('/');
        const wsUrl = `wss://data-stream.binance.vision/stream?streams=${streams}`;

        const ws = new WebSocket(wsUrl);
        this.klineWebSockets.push(ws);

        ws.on("open", () => {
          console.log(`✅ Kline WS ${chunkIdx + 1}/${pairChunks.length} connected (${chunk.length} streams)`);
          if (!initialConnectDone) {
            connectedCount++;
            if (connectedCount === pairChunks.length) {
              initialConnectDone = true;
              this.isKlineWebSocketRunning = true;
              console.log(`🚀 All ${pairChunks.length} kline WebSocket connections established - LIVE`);
            }
          } else {
            this.isKlineWebSocketRunning = true;
          }
        });

        ws.on("message", (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            const payload = parsed.data || parsed;
            if (!payload || payload.e !== "kline" || !payload.k || !payload.s) return;

            const k = payload.k;
            const timeframe = KLINE_INTERVAL_TO_TF[k.i];
            if (!timeframe) return; // defensive: stream we didn't subscribe to

            msgCount++;
            this.lastKlineWsMessageAt = Date.now();

            const candle = {
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v),
              quoteVolume: parseFloat(k.q),
              startTime: k.t,
              endTime: k.T,
              isComplete: !!k.x,
            };

            const key = `${payload.s}_${timeframe}`;
            this.candleCache.set(key, candle);

            if (msgCount % 5000 === 0) {
              console.log(`📊 Kline WS: ${msgCount} messages processed`);
            }
          } catch (error) {
            console.error("❌ Error parsing kline WS message:", error.message);
          }
        });

        ws.on("error", (error) => {
          console.error(`❌ Kline WS ${chunkIdx + 1} error:`, error.message);
        });

        ws.on("close", () => {
          const idx = this.klineWebSockets.indexOf(ws);
          if (idx > -1) this.klineWebSockets.splice(idx, 1);

          if (generation !== this._klineWsGeneration) return;

          console.log(`⚠️ Kline WS ${chunkIdx + 1} closed, reconnecting just this chunk in 3 seconds...`);
          this.isKlineWebSocketRunning = false;
          setTimeout(() => {
            if (generation !== this._klineWsGeneration) return;
            connectChunk(chunk, chunkIdx);
          }, 3000);
        });
      };

      for (let chunkIdx = 0; chunkIdx < pairChunks.length; chunkIdx++) {
        connectChunk(pairChunks[chunkIdx], chunkIdx);
      }

      // Same silent-feed watchdog pattern as the ticker feed.
      if (this._klineWsWatchdogInterval) clearInterval(this._klineWsWatchdogInterval);
      this._klineWsWatchdogInterval = setInterval(() => {
        const silentMs = Date.now() - (this.lastKlineWsMessageAt || 0);
        if (silentMs > 45000) {
          console.warn(`⚠️ Kline WS feed silent for ${Math.round(silentMs / 1000)}s — forcing full resubscribe`);
          this._klineWsGeneration = (this._klineWsGeneration || 0) + 1;
          for (const ws of this.klineWebSockets) {
            try { ws.close(); } catch (e) { /* ignore */ }
          }
          this.klineWebSockets = [];
          this.isKlineWebSocketRunning = false;
          this.startBinanceKlineWebSocket();
        }
      }, 20000);
    } catch (error) {
      console.error("❌ Error starting kline WebSocket:", error);
      this.isKlineWebSocketRunning = false;
      setTimeout(() => this.startBinanceKlineWebSocket(), 3000);
    }
  }

  // Stop the kline WebSocket feed. Purely additive to the REST candle path,
  // so stopping it just means every read falls back to getCandleDataOrQueue's
  // existing cache-miss-queues-a-fetch behavior -- nothing else changes.
  async stopBinanceKlineWebSocket() {
    console.log("🛑 Stopping Binance kline WebSocket(s)...");
    if (this._klineWsWatchdogInterval) {
      clearInterval(this._klineWsWatchdogInterval);
      this._klineWsWatchdogInterval = null;
    }
    if (this.klineWebSockets && this.klineWebSockets.length > 0) {
      for (const ws of this.klineWebSockets) {
        try { ws.close(); } catch (e) { /* ignore */ }
      }
      this.klineWebSockets = [];
    }
    this.isKlineWebSocketRunning = false;
  }

  // Batch Redis updates (flush every 5 seconds instead of per-message)
  _scheduleRedisFlush() {
    if (this._redisFlushTimer) return;
    this._redisFlushTimer = setTimeout(() => {
      this._redisFlushTimer = null;
      this._flushRedisUpdates();
    }, 5000);
  }

  async _flushRedisUpdates() {
    if (!this._pendingRedisUpdates || this._pendingRedisUpdates.size === 0) return;
    if (!this.redisClient) return;

    const updates = this._pendingRedisUpdates;
    this._pendingRedisUpdates = new Map();

    try {
      const pipeline = this.redisClient.pipeline();
      for (const [symbol, priceData] of updates) {
        pipeline.setex(`crypto:${symbol}`, 300, JSON.stringify(priceData));
      }
      await pipeline.exec();
    } catch (err) {
      console.error("❌ Redis flush error:", err.message);
    }
  }

  // Process price update in real-time (from WebSocket)
  async processPriceUpdateRealTime(symbol, liveData) {
    try {
      // OPTIMIZATION: Use in-memory cache FIRST (0.1ms vs 5-20ms Redis)
      let alerts = this.activeAlerts.get(symbol) || [];

      // Only fallback to Redis if in-memory cache is empty
      if (alerts.length === 0) {
        await this.getAlertsFromCache(symbol); // Just update cache, don't assign result yet
        alerts = this.activeAlerts.get(symbol) || [];

        // If still empty, reload all from DB (safest fallback)
        if (alerts.length === 0) {
          await this.loadAllActiveAlerts();
          alerts = this.activeAlerts.get(symbol) || [];
        }
      }

      if (alerts.length === 0) {
        return; // No alerts for this symbol
      }

      // Process all alerts for this symbol using SafeAlertProcessor (prevents race conditions)
      // 🔥 OPTIMIZATION: Create Map for O(1) lookup instead of O(A) findIndex
      const alertMap = new Map(alerts.map((a, idx) => [a._id.toString(), idx]));

      const alertPromises = alerts.map((alert) =>
        this.processLimit(async () => {
          try {
            // Use SafeAlertProcessor to prevent race conditions and duplicate processing
            const result = await this.safeProcessor.processAlertSafely(
              alert,
              liveData,
              this.processAlertWithLiveData.bind(this)
            );

            // OPTIMIZATION: Update cache without blocking (fire-and-forget)
            if (result.success && result.result && result.result.triggered) {
              // 🔥 O(1) Map lookup instead of O(A) findIndex
              const alertIndex = alertMap.get(alert._id.toString());
              if (alertIndex !== undefined) {
                // Update baseline in memory
                alerts[alertIndex].baselinePrice = liveData.price;
                alerts[alertIndex].baselineVolume =
                  liveData.volume || liveData.volume24h;
                alerts[alertIndex].baselineTimestamp = new Date();
                alerts[alertIndex].lastTriggeredAt = new Date();
                alerts[alertIndex].lastTriggeredPrice = liveData.price;
              }

              // Update Redis cache in background (non-blocking)
              Alert.findById(alert._id)
                .lean()
                .then((updatedAlert) => {
                  if (updatedAlert) {
                    this.updateAlertInCache(updatedAlert).catch(() => { });
                  }
                })
                .catch(() => { }); // Silent fail - non-critical
            }

            return result.result || { triggered: false, reason: result.reason };
          } catch (error) {
            console.error(
              `❌ Error processing alert ${alert._id} for ${symbol}:`,
              error.message
            );
            return { triggered: false, reason: "error", error: error.message };
          }
        })
      );

      // Wait for all alerts to be processed (non-blocking)
      Promise.all(alertPromises).catch((error) => {
        console.error(`❌ Error processing alerts for ${symbol}:`, error);
      });
    } catch (error) {
      console.error(`❌ Error processing price update for ${symbol}:`, error);
    }
  }

  // Start WebSocket-based real-time processing
  async startWebSocketProcessing() {
    // Step 1: Initialize Redis clients
    await this.initRedisClient();
    await this.initDbQueueClient();

    // Step 2: Load all alerts from DB and cache in Redis
    await this.loadAlertsToRedisCache();

    // Step 3: Setup micro-batch processing BEFORE WebSocket
    this.setupMicroBatchEngine();

    // Step 4: Load active symbols (needed for WebSocket subscription)
    await this.updateMicroBatchActiveSymbols();

    // Step 5: Start WebSocket connection (uses active symbols list)
    this.startWebSocketPriceFeed();

    // Step 5.1: Start kline WebSocket feed, only if explicitly enabled.
    // Default off -- deploys inert until flipped on after side-by-side
    // verification against the REST candle path. See
    // startBinanceKlineWebSocket()'s comment for what this does and does not
    // change.
    if (process.env.ENABLE_KLINE_WS === "1") {
      this.startBinanceKlineWebSocket();
    }

    // Step 5.5: Start OI polling for symbols with OI conditions
    this.startOIPolling();

    // Step 6: Subscribe to alert management events
    await this.subscribeToAlertManagement();

    // Step 7: Start heartbeat for health monitoring
    this.startHeartbeat();

    // Step 8: Subscribe to system control messages
    await this.subscribeToSystemControl();
  }

  // Stop WebSocket connections
  async stopWebSocketPriceFeed() {
    console.log("🛑 Stopping Binance WebSocket(s)...");

    // Close all WebSocket connections
    if (this.binanceWebSockets && this.binanceWebSockets.length > 0) {
      for (const ws of this.binanceWebSockets) {
        try { ws.close(); } catch (e) { /* ignore */ }
      }
      this.binanceWebSockets = [];
    }
    if (this.binanceWebSocket) {
      try { this.binanceWebSocket.close(); } catch (e) { /* ignore */ }
      this.binanceWebSocket = null;
    }
    this.isWebSocketRunning = false;

    // Stop heartbeat
    this.stopHeartbeat();

    // Close safe processor
    if (this.safeProcessor) {
      this.safeProcessor.close();
    }

    // Unsubscribe from system control
    await this.unsubscribeFromSystemControl();

    // Shutdown micro-batch engine
    if (this.microBatchEngine) {
      this.microBatchEngine.shutdown();
    }

    // Stop OI polling
    this.stopOIPolling();
  }

  // ============================================
  // Micro-Batch Engine Integration Methods
  // ============================================

  // Setup micro-batch processing engine
  setupMicroBatchEngine() {
    // Override the processSingleSymbol method for our alert processing
    this.microBatchEngine.processSingleSymbol = async (
      symbol,
      priceData,
      batchId
    ) => {
      try {
        await this.processPriceUpdateRealTime(symbol, priceData);
        return { success: true, symbol };
      } catch (error) {
        console.error(
          `❌ Batch ${batchId} - Error processing ${symbol}:`,
          error.message
        );
        throw error;
      }
    };

    console.log("🚀 Micro-Batch Engine configured for alert processing");
  }

  // Update active symbols cache for micro-batch filtering
  async updateMicroBatchActiveSymbols() {
    // Creating alerts in bulk calls this once per alert, so hundreds of these
    // run against a collection that is still being written to. Each one replaces
    // the engine's whole symbol set, so a query that started early but resolved
    // late would overwrite the complete set with its own partial snapshot —
    // monitoring silently dropped to a fraction of the symbols and stayed there
    // until the worker was restarted. Collapse the burst into one refresh, and
    // never let an older result land after a newer one.
    this.symbolsRefreshSeq = (this.symbolsRefreshSeq || 0) + 1;
    const seq = this.symbolsRefreshSeq;

    await new Promise((resolve) => setTimeout(resolve, 300));
    if (seq !== this.symbolsRefreshSeq) return; // a newer refresh superseded this one

    try {
      // Get all active alerts to determine which symbols we need to monitor
      const alerts = await Alert.find({ status: "active" }).lean();
      if (seq !== this.symbolsRefreshSeq) return; // newer refresh already applied

      // Update micro-batch engine's active symbols
      this.microBatchEngine.updateActiveSymbols(alerts);

      console.log(
        `📊 Updated micro-batch active symbols: ${alerts.length} alerts`
      );

      // The live WebSocket subscribes to an explicit stream list built once
      // from activeSymbolsSet at connect time — updating the set here never
      // touched the socket, so a symbol added after startup sat in
      // activeSymbolsSet, correctly passed every filter, and still never
      // received a single price tick to evaluate. Only resubscribe once the
      // feed is already running: at startup this fires before
      // startWebSocketPriceFeed's own first connect, which already opens
      // against the current set, so re-triggering here would just be a
      // redundant reconnect on every boot.
      if (this.isWebSocketRunning) {
        this.isWebSocketRunning = false;
        this.startWebSocketPriceFeed();
      }

      // Same reasoning as the ticker feed above, applied to the kline feed:
      // only resubscribe if it's already running (flag on, past startup).
      if (this.isKlineWebSocketRunning) {
        this.isKlineWebSocketRunning = false;
        this.startBinanceKlineWebSocket();
      }
    } catch (error) {
      console.error("❌ Error updating micro-batch active symbols:", error);
    }
  }

  // Update live prices cache for all symbols (background task)
  updateLivePricesCache(tickers) {
    // This is a fire-and-forget background task - don't block micro-batch processing
    setImmediate(async () => {
      try {
        const pipeline = this.redisClient ? this.redisClient.pipeline() : null;
        let pipelineCount = 0;

        for (const ticker of tickers) {
          const symbol = ticker.s;
          const priceData = {
            price: parseFloat(ticker.c),
            change: parseFloat(ticker.P),
            // ✅ FIX: Use ONLY ticker.q (quote volume in USDT)
            // ticker.v = base volume (BTC) - WRONG!
            // ticker.q = quote volume (USDT) - CORRECT!
            volume: parseFloat(ticker.q),      // Now using quote volume (USDT)
            volume24h: parseFloat(ticker.q),   // Quote volume in USDT
            high: parseFloat(ticker.h),
            low: parseFloat(ticker.l),
            open: parseFloat(ticker.o),
            close: parseFloat(ticker.c),
            timestamp: Date.now(),
          };

          // Update in-memory cache
          this.livePrices[symbol] = priceData;

          // Add to Redis pipeline instead of firing individual requests
          if (pipeline) {
            pipeline.setex(`crypto:${symbol}`, 300, JSON.stringify(priceData));
            pipelineCount++;
          }
        }

        // Execute pipeline (one TCP request instead of 3000)
        if (pipeline && pipelineCount > 0) {
          pipeline.exec().catch((err) => {
            console.error("❌ Error executing Redis pipeline:", err.message);
          });
        }
      } catch (error) {
        console.error("❌ Error updating live prices cache:", error);
      }
    });
  }

  // Get micro-batch performance statistics
  getMicroBatchStats() {
    if (!this.microBatchEngine) {
      return { error: "Micro-batch engine not initialized" };
    }

    return this.microBatchEngine.getPerformanceStats();
  }

  // Task 2: Process alert with live data - check baseline price comparison
  async processAlertWithLiveData(alert, liveData) {
    try {
      // ═══ LIVE-PRICE INTEGRITY REPAIR ═══
      // liveData.price is a snapshot from whenever this alert's item was
      // queued into the micro-batch, not whenever it is actually processed --
      // if that queue item sat in a backlog, this can be several minutes
      // stale (confirmed on ROBOUSDT: a real 21:01 price used as "now" at
      // 21:05, four minutes later, while the real price had since round-
      // tripped and come back down). this.livePrices is the ticker WS cache,
      // updated continuously regardless of any single alert's processing
      // delay, so it is always at least as fresh, usually much fresher.
      //
      // Corrected once, by mutating liveData.price directly -- liveData is a
      // fresh per-item object handed to this one call, not a shared cache, so
      // this cannot affect any other alert's processing. Every downstream
      // read (the change% check, every other condition, and
      // triggerAlertWithLiveData's recorded triggerData.price) sees the same
      // corrected value afterward -- there is no second copy to disagree
      // with, which is the property that made the decision-vs-recording
      // split in 909e0ed (reverted) unsafe.
      // Preferred source: the close of the SAME kline the candle open comes
      // from, for the timeframe changePercent is measured on. Pairing open and
      // close from one kline message makes the computed change identical to the
      // candle the chart draws, and the 5ad4a9f gate already refuses to fire
      // unless this entry exists for the current boundary -- so wherever an
      // alert can fire at all, this source is present and boundary-verified.
      //
      // The ticker cache is NOT always fresh: METUSDT (2026-08-22T08:05:23Z)
      // had a correct baseline but a ticker price of 0.2405, a level that
      // candle never reached (high 0.2382) and last real 3-4 minutes earlier.
      let sameKlineClose = null;
      const cpTf = alert.conditions?.changePercent?.timeframe;
      if (cpTf) {
        const cpMs = this.getTimeframeMs(cpTf);
        const cpBoundaryNow = Math.floor(Date.now() / cpMs) * cpMs;
        const cached = this.candleCache.get(`${alert.symbol}_${cpTf}`);
        if (
          cached &&
          cached.close !== null &&
          isFinite(cached.close) &&
          cached.close > 0 &&
          cached.startTime === cpBoundaryNow
        ) {
          sameKlineClose = cached.close;
        }
      }

      const tickerPrice = parseFloat(this.livePrices[alert.symbol]?.price);
      if (sameKlineClose !== null) {
        liveData.price = sameKlineClose;
      } else if (isFinite(tickerPrice) && tickerPrice > 0) {
        liveData.price = tickerPrice;
      }

      // 🔥 CRITICAL FIX: Save ORIGINAL baseline BEFORE any updates
      // This prevents race condition where baseline resets before condition check
      // (let, not const: the baseline-integrity repair below may correct this
      // to the real Binance candle open before any condition reads it.)
      let originalBaselinePrice = parseFloat(alert.baselinePrice) || 0;
      const originalBaselineVolume = parseFloat(alert.baselineVolume) || 0;

      // 🛡️ SAFETY CHECK: If baseline is 0 or missing, set it to current price and skip this check
      if (originalBaselinePrice <= 0) {
        console.log(`⚠️ Alert ${alert._id} has no baseline price, setting to current: ${liveData.price}`);
        alert.baselinePrice = liveData.price;
        alert.baselineTimestamp = new Date();
        // Skip this cycle - alert needs a baseline first
        return { triggered: false, reason: "baseline_initialized" };
      }

      // Baseline logged only on significant events now

      // Declared here so it's accessible for the change% check below (set inside candle boundary block)
      let effectiveBaseline;

      // CRITICAL: Check if baseline needs to be updated based on timeframe
      // 🔥 FIX: Update baseline at CANDLE CLOSE boundaries, not time since last update
      // Example: For 5MIN, update at 10:00, 10:05, 10:10, etc.
      if (alert.conditions?.changePercent?.timeframe) {
        const timeframe = alert.conditions.changePercent.timeframe;
        const timeframeMs = this.getTimeframeMs(timeframe);
        const currentTime = Date.now();

        // Calculate current candle start time (aligned to timeframe boundaries)
        const currentCandleStart = Math.floor(currentTime / timeframeMs) * timeframeMs;

        // Get the candle when baseline was last set
        const baselineTimestamp = alert.baselineTimestamp
          ? new Date(alert.baselineTimestamp).getTime()
          : 0;
        const baselineCandleStart = Math.floor(baselineTimestamp / timeframeMs) * timeframeMs;

        // 🔥 CRITICAL: Update baseline only when we've moved to a NEW CANDLE
        // This ensures baseline updates at candle close, not just after X minutes
        if (currentCandleStart > baselineCandleStart) {
          console.log(
            `🕯️ New candle started for ${alert.symbol} (${timeframe}), updating baseline from ${alert.baselinePrice} to ${liveData.price}`
          );
          console.log(
            `   Baseline candle: ${new Date(baselineCandleStart).toISOString()}`
          );
          console.log(
            `   Current candle:  ${new Date(currentCandleStart).toISOString()}`
          );

          // Prefer the REAL Binance candle open for this exact boundary over
          // the live ticker snapshot -- the ticker price can be several
          // minutes stale if this alert's evaluation tick was delayed, but
          // candleCache is fetched independently via REST/kline-WS and is
          // never stale in that way. Falls back to the ticker price when the
          // cache doesn't have this exact candle yet, so the reset is never
          // blocked or delayed by this.
          const candleCacheKey = `${alert.symbol}_${timeframe}`;
          const cachedCandleAtReset = this.candleCache.get(candleCacheKey);
          const realCandleOpenAtReset =
            cachedCandleAtReset &&
            cachedCandleAtReset.open !== null &&
            isFinite(cachedCandleAtReset.open) &&
            cachedCandleAtReset.startTime === currentCandleStart
              ? cachedCandleAtReset.open
              : null;
          // liveData.price can itself be stale -- it's a snapshot from
          // whenever this alert's item was queued, not whenever it actually
          // got processed. this.livePrices is updated continuously by the
          // ticker WS regardless of any single alert's own processing delay,
          // so it's always at least as fresh, usually fresher, than a
          // liveData snapshot that sat in a processing backlog.
          const currentTickerPrice = parseFloat(this.livePrices[alert.symbol]?.price);
          const mostCurrentLivePrice = isFinite(currentTickerPrice) ? currentTickerPrice : liveData.price;
          const freshBaselinePrice = realCandleOpenAtReset !== null ? realCandleOpenAtReset : mostCurrentLivePrice;

          // Update baseline to the fresh (real-candle-open-preferred) price
          alert.baselinePrice = freshBaselinePrice;
          alert.baselineTimestamp = new Date(currentCandleStart); // Set to candle start for accurate tracking

          // 🔥 CRITICAL FIX: Update originalBaselinePrice so we don't trigger
          // based on the previous candle's performance at the junction.
          // This ensures the 2% check is FRESH for the new candle.
          const freshBaseline = parseFloat(freshBaselinePrice) || originalBaselinePrice;

          // Set effectiveBaseline so the change% check below uses the NEW (reset) baseline
          // This ensures the very first tick of a new candle starts at 0% change.
          effectiveBaseline = freshBaseline;

          // Update baseline volume based on smallest volume timeframe (if volume condition exists)
          let updatedVolume = liveData.volume || liveData.volume24h;
          if (alert.conditions?.volume?.timeframes?.length > 0) {
            const volumeTimeframes = alert.conditions.volume.timeframes;
            const smallestTimeframe = volumeTimeframes.reduce((min, tf) => {
              const minMs = this.getTimeframeMs(min);
              const tfMs = this.getTimeframeMs(tf);
              return tfMs < minMs ? tf : min;
            });
            const smallestTimeframeMs = this.getTimeframeMs(smallestTimeframe);
            const smallestCandleStart = Math.floor(currentTime / smallestTimeframeMs) * smallestTimeframeMs;
            const baselineSmallestCandle = Math.floor(baselineTimestamp / smallestTimeframeMs) * smallestTimeframeMs;

            if (smallestCandleStart > baselineSmallestCandle) {
              alert.baselineVolume = updatedVolume;
              console.log(`📊 Volume baseline updated at ${smallestTimeframe} candle close: ${alert.baselineVolume}`);
            }
          } else {
            alert.baselineVolume = updatedVolume;
          }

          // Update in database (non-blocking)
          Alert.findByIdAndUpdate(alert._id, {
            baselinePrice: freshBaselinePrice,
            baselineVolume: alert.baselineVolume,
            baselineTimestamp: new Date(currentCandleStart),
          }).catch((error) => {
            console.error(
              `❌ Error updating baseline for ${alert.symbol}:`,
              error.message
            );
          });

          // CRITICAL FIX: Update in-memory cache with baseline AND preserve lock
          const alertsForSymbol = this.activeAlerts.get(alert.symbol);
          if (alertsForSymbol) {
            // 🔥 OPTIMIZATION: Use Map for O(1) lookup
            const alertMap = new Map(alertsForSymbol.map((a, idx) => [a._id.toString(), idx]));
            const alertIndex = alertMap.get(alert._id.toString());
            if (alertIndex !== undefined) {
              // Update with new baseline AND preserve conditions (lock)
              alertsForSymbol[alertIndex] = {
                ...alertsForSymbol[alertIndex],
                baselinePrice: freshBaselinePrice,
                baselineVolume: liveData.volume || liveData.volume24h,
                baselineTimestamp: new Date(currentCandleStart),
                conditions: alert.conditions, // Preserve lock
              };
            }
          }

          // OPTIMIZATION: Update Redis cache (non-blocking)
          this.updateAlertInCache({
            ...alert,
            baselinePrice: freshBaselinePrice,
            baselineVolume: liveData.volume || liveData.volume24h,
            baselineTimestamp: new Date(currentCandleStart),
          }).catch((error) => {
            console.error(
              `❌ Error updating alert in Redis cache for ${alert.symbol}:`,
              error.message
            );
          });

          console.log(
            `✅ Baseline updated at candle close for ${alert.symbol}`
          );
        }
      }

      // ✅ INDEPENDENT VOLUME BASELINE UPDATE
      // 🔥 FIX: Volume baseline updates at CANDLE CLOSE of smallest volume timeframe
      // This runs SEPARATELY from price baseline update
      if (alert.conditions?.volume?.timeframes?.length > 0) {
        const volumeTimeframes = alert.conditions.volume.timeframes;
        const smallestVolumeTimeframe = volumeTimeframes.reduce((min, tf) => {
          const minMs = this.getTimeframeMs(min);
          const tfMs = this.getTimeframeMs(tf);
          return tfMs < minMs ? tf : min;
        });
        const smallestVolumeTimeframeMs = this.getTimeframeMs(smallestVolumeTimeframe);
        const currentTime = Date.now();

        // Calculate current volume candle start (aligned to smallest timeframe)
        const currentVolumeCandleStart = Math.floor(currentTime / smallestVolumeTimeframeMs) * smallestVolumeTimeframeMs;

        // Get volume baseline timestamp (separate from price baseline)
        const volumeBaselineTimestamp = alert.volumeBaselineTimestamp
          ? new Date(alert.volumeBaselineTimestamp).getTime()
          : (alert.baselineTimestamp ? new Date(alert.baselineTimestamp).getTime() : 0);

        // Get the candle when volume baseline was last set
        const volumeBaselineCandleStart = Math.floor(volumeBaselineTimestamp / smallestVolumeTimeframeMs) * smallestVolumeTimeframeMs;

        // 🔥 CRITICAL: Update volume baseline only when we've moved to a NEW CANDLE
        if (currentVolumeCandleStart > volumeBaselineCandleStart) {
          const newVolumeBaseline = liveData.quoteVolume || liveData.volume24h || liveData.volume;

          console.log(`🕯️📊 Volume candle closed (${smallestVolumeTimeframe}): ${alert.baselineVolume?.toLocaleString()} → ${newVolumeBaseline?.toLocaleString()} USDT`);
          console.log(`   Volume baseline candle: ${new Date(volumeBaselineCandleStart).toISOString()}`);
          console.log(`   Current volume candle:  ${new Date(currentVolumeCandleStart).toISOString()}`);

          // Update in-memory
          alert.baselineVolume = newVolumeBaseline;
          alert.volumeBaselineTimestamp = new Date(currentVolumeCandleStart);

          // Update in-memory cache using Map for O(1) lookup
          const alertsForSymbol = this.activeAlerts.get(alert.symbol);
          if (alertsForSymbol) {
            const alertMap = new Map(alertsForSymbol.map((a, idx) => [a._id.toString(), idx]));
            const alertIndex = alertMap.get(alert._id.toString());
            if (alertIndex !== undefined) {
              alertsForSymbol[alertIndex].baselineVolume = newVolumeBaseline;
              alertsForSymbol[alertIndex].volumeBaselineTimestamp = new Date(currentVolumeCandleStart);
            }
          }

          // Update in database (non-blocking)
          Alert.findByIdAndUpdate(alert._id, {
            baselineVolume: newVolumeBaseline,
            volumeBaselineTimestamp: new Date(currentVolumeCandleStart),
          }).catch((error) => {
            console.error(`❌ Error updating volume baseline for ${alert.symbol}:`, error.message);
          });

          console.log(`✅ Volume baseline updated at candle close for ${alert.symbol}`);
        }
      }

      // CRITICAL: Check if alert is locked FIRST (prevent duplicate triggers)
      if (isAlertLocked(alert)) {
        const lockUntil = new Date(alert.conditions.alertCount.lockUntil);
        const now = new Date();
        const timeRemaining = Math.max(0, lockUntil.getTime() - now.getTime());
        const minutesRemaining = Math.ceil(timeRemaining / (1000 * 60));

        return { triggered: false, reason: "alert_locked" };
      }

      // Alert not locked - proceed (silent)

      // ═══ BASELINE INTEGRITY REPAIR ═══
      // The baseline is set at a candle boundary from whatever price snapshot
      // is available at that instant, which can be stale (thin symbol whose
      // ticker hasn't ticked, or a WS chunk mid-reconnect). Once the real
      // Binance candle open for that same boundary is in candleCache, adopt it
      // -- it is by definition the correct reference for "change over this
      // candle", and it is exactly the number the chart shows.
      //
      // Repaired ONCE per (alert, boundary): after that this is skipped, so the
      // baseline stays fixed for the rest of the candle rather than being
      // re-derived on every tick. And it rewrites alert.baselinePrice /
      // originalBaselinePrice / effectiveBaseline together -- the single set of
      // values every downstream consumer reads -- so the condition check and the
      // recorded alert history can never disagree about what the baseline was.
      if (alert.conditions?.changePercent?.timeframe && alert.baselineTimestamp) {
        const cpTimeframe = alert.conditions.changePercent.timeframe;
        const cpTimeframeMs = this.getTimeframeMs(cpTimeframe);
        // Boundary from the clock, matching the gate's basis exactly so the two
        // can never disagree about which candle is in progress.
        const repairBoundaryNow =
          Math.floor(Date.now() / cpTimeframeMs) * cpTimeframeMs;
        const baselineBoundary = repairBoundaryNow;
        const alertKey = alert._id.toString();

        // No once-per-boundary marker: a candle's open is fixed for that
        // candle's lifetime, so re-applying is idempotent and converges. The
        // previous marker locked in whatever was cached at the first matching
        // tick and never revisited it, which is why so few repairs ran.
        {
          const cachedForBoundary = this.candleCache.get(`${alert.symbol}_${cpTimeframe}`);
          if (
            cachedForBoundary &&
            cachedForBoundary.open !== null &&
            isFinite(cachedForBoundary.open) &&
            cachedForBoundary.open > 0 &&
            cachedForBoundary.startTime === baselineBoundary
          ) {
            const trueOpen = cachedForBoundary.open;
            const currentBaseline = parseFloat(alert.baselinePrice) || 0;

            // Only rewrite on a meaningful difference -- an exact-match repair
            // would be a no-op, and float noise should not trigger a DB write.
            if (currentBaseline > 0 && Math.abs(trueOpen - currentBaseline) / currentBaseline > 0.0001) {
              this._baselineRepairLogged = this._baselineRepairLogged || new Map();
              const repairLogKey = `${alert.symbol}_${cpTimeframe}`;
              if (this._baselineRepairLogged.get(repairLogKey) !== baselineBoundary) {
                this._baselineRepairLogged.set(repairLogKey, baselineBoundary);
                console.log(
                  `🔧 Baseline corrected for ${alert.symbol} (${cpTimeframe}): ${currentBaseline} → ${trueOpen} (real candle open @ ${new Date(baselineBoundary).toISOString()})`
                );
              }

              alert.baselinePrice = trueOpen;
              originalBaselinePrice = trueOpen;
              if (typeof effectiveBaseline !== "undefined") effectiveBaseline = trueOpen;

              const alertsForSymbolRepair = this.activeAlerts.get(alert.symbol);
              if (alertsForSymbolRepair) {
                const repairIdx = alertsForSymbolRepair.findIndex(
                  (a) => a._id.toString() === alertKey
                );
                if (repairIdx !== -1) {
                  alertsForSymbolRepair[repairIdx].baselinePrice = trueOpen;
                }
              }

              Alert.findByIdAndUpdate(alert._id, { baselinePrice: trueOpen }).catch((error) => {
                console.error(
                  `❌ Error persisting corrected baseline for ${alert.symbol}:`,
                  error.message
                );
              });
            }

            // (no marker: repair is idempotent and re-checked every tick)
          }
        }
      }

      // 🔥 CRITICAL FIX: Use ORIGINAL baseline for direction check
      // This ensures we compare against the baseline BEFORE it was updated
      const direction =
        alert.conditions?.changePercent?.direction || "increase";

      // 🛡️ Calculate actual change percentage FIRST
      // 🔥 CRITICAL FIX: Use the potentially updated baseline from junction logic
      // If the baseline was reset (EffectiveBaseline is current price), the change is 0.
      const livePrice = parseFloat(liveData.price) || 0;
      const calcBaseline = (typeof effectiveBaseline !== 'undefined') ? effectiveBaseline : originalBaselinePrice;

      const actualChangePercent = calcBaseline > 0
        ? ((livePrice - calcBaseline) / calcBaseline) * 100
        : 0;

      // An Independent Divergence Trigger fires on the divergence alone and must not be
      // gated on price direction — a bullish divergence forms while price is still FALLING,
      // so the default "increase" direction would otherwise swallow every bullish signal.
      // Any divergence mode fires on the divergence alone, so none of them may be
      // gated on price direction.
      const divergenceCfg = alert.conditions?.rsiDivergence;
      const isIndependentDivergence = divergenceCfg?.timeframes?.length > 0;

      if (!isIndependentDivergence) {
        // 🛡️ MINIMUM CHANGE THRESHOLD - Prevent 0% change alerts
        const MIN_CHANGE_THRESHOLD = 0.001; // 0.001% minimum change required
        const hasMinimumChange = Math.abs(actualChangePercent) >= MIN_CHANGE_THRESHOLD;

        if (!hasMinimumChange) {
          return { triggered: false, reason: "change_below_threshold" };
        }

        const priceChanged = livePrice !== originalBaselinePrice;

        if (direction === "increase" && livePrice <= originalBaselinePrice) {
          return { triggered: false, reason: "price_not_increased" };
        }

        if (direction === "decrease" && livePrice >= originalBaselinePrice) {
          return { triggered: false, reason: "price_not_decreased" };
        }

        if (!priceChanged) {
          return { triggered: false, reason: "price_unchanged" };
        }
      }

      // Collects details from the conditions that matched (e.g. which divergence fired)
      // so the alert message can explain WHY it triggered.
      const triggerContext = {};

      // Check alert conditions - pass correct baseline for Change Percent calculation
      const conditionsMet = await this.checkAlertConditionsWithLiveData(
        alert,
        liveData,
        calcBaseline, // 🔥 CRITICAL: Use the same baseline we used for our pre-check
        triggerContext
      );

      if (conditionsMet) {
        // Trigger the alert (this will apply the lock)
        // 🔥 FIX: Pass original baseline so correct % is saved in history
        await this.triggerAlertWithLiveData(alert, liveData, originalBaselinePrice, triggerContext);

        return { triggered: true, reason: "conditions_met" };
      } else {
        return { triggered: false, reason: "conditions_not_met" };
      }
    } catch (error) {
      console.error(`❌ Error processing alert ${alert._id}:`, error);
      return { triggered: false, reason: "error", error: error.message };
    }
  }

  // OPTIMIZED: Check conditions with live data - hierarchical and only check set conditions
  async checkAlertConditionsWithLiveData(alert, liveData, originalBaselinePrice = null, triggerContext = {}) {
    try {
      const conditions = alert.conditions;

      // 🔥 CRITICAL: Use original baseline if provided, otherwise use alert's baseline
      const baselinePriceForCheck = originalBaselinePrice || alert.baselinePrice;

      // console.log(`📋 Checking conditions for ${alert.symbol}:`);

      // OPTIMIZATION 1: Create array of only SET conditions for hierarchical checking
      const activeConditions = this.getActiveConditions(
        conditions,
        liveData,
        alert,
        baselinePriceForCheck, // 🔥 Pass original baseline for % change calculation
        triggerContext
      );

      if (activeConditions.length === 0) {
        return false;
      }

      // OPTIMIZATION 2: Parallel condition checking (faster than sequential)
      // Check all conditions in parallel, but fail fast if any fails
      const conditionResults = await Promise.all(
        activeConditions.map(async (conditionCheck) => {
          try {
            return await conditionCheck.check();
          } catch (error) {
            console.error(`❌ Error checking ${conditionCheck.name}:`, error);
            return { passed: false, reason: `Error: ${error.message}` };
          }
        })
      );

      // AND pipeline with one deliberate exception. Every active condition — Min
      // Daily, Divergence, OI Change, RSI Range, Candle, Volume, MACD, Volume EMA,
      // CVD — normally has to pass on its own. The exception is Independent-
      // Trigger divergence, which the client specified as a supreme override:
      // once it confirms, it fires the alert and every other selected filter is
      // skipped — with two named exceptions the client called out explicitly,
      // Min Daily Volume and Alert Count, which the override still has to respect.
      // A veto still wins over the override, so the Conditional safety shield
      // cannot be bypassed by it either.
      const vetoed = conditionResults.find((r) => !r.passed && r.blocking);
      if (vetoed) {
        return false;
      }

      const override = conditionResults.find((r) => r.passed && r.bypassOthers);
      if (override) {
        const alwaysRespected = ["Min Daily Volume", "Alert Count"];
        const unmet = conditionResults.find((r, i) => {
          const conditionCheck = activeConditions[i];
          return !r.passed && alwaysRespected.includes(conditionCheck.name);
        });
        if (unmet) {
          console.log(
            `⏭️ ${alert.symbol}: Independent override blocked — ${unmet.reason}`
          );
          return false; // Override bypasses everything except these two
        }

        console.log(
          `⚡ ${alert.symbol}: ${override.reason} — remaining ${activeConditions.length - 1} filter(s) skipped (Min Daily/Alert Count still respected)`
        );
        return true;
      }

      // Check if all conditions passed
      for (let i = 0; i < conditionResults.length; i++) {
        const result = conditionResults[i];
        const conditionCheck = activeConditions[i];

        if (!result.passed) {
          // The individual check()s already build a reason string with the
          // real numbers (e.g. Change Percent's "2.804% < 1.5%"); it was being
          // discarded here on every failure with no symbol attached anywhere,
          // which is why a missed-alert investigation had to be reconstructed
          // from raw market data after the fact instead of read straight off
          // the log. This does not change what passes or fails — same result,
          // same early exit — it only prints the reason that was already computed.
          console.log(
            `⏭️ ${alert.symbol}: ${conditionCheck.name} FAILED — ${result.reason}`
          );
          return false; // Early exit (silent - hot path)
        }
        console.log(`✅ ${conditionCheck.name} PASSED: ${result.reason}`);
      }

      console.log(
        `🎉 All ${activeConditions.length} conditions PASSED for ${alert.symbol}`
      );
      return true;
    } catch (error) {
      console.error(`❌ Error checking conditions for ${alert.symbol}:`, error);
      return false;
    }
  }

  // True when the alert has a trigger condition other than RSI divergence.
  // Min Daily is excluded — it only filters which symbols qualify, it never fires an alert.
  hasNonDivergenceTrigger(conditions = {}) {
    return !!(
      conditions.changePercent?.percentage ||
      conditions.volume?.timeframes?.length > 0 ||
      conditions.rsiRange?.timeframes?.length > 0 ||
      conditions.candle?.timeframes?.length > 0 ||
      conditions.macd?.timeframes?.length > 0 ||
      conditions.openInterest?.timeframes?.length > 0 ||
      conditions.oiChange?.timeframes?.length > 0
    );
  }

  // ============================================
  // 🔥 OI CHANGE: Polling & Evaluation Logic
  // ============================================

  startOIPolling() {
    if (this.oiPollingInterval) {
      clearInterval(this.oiPollingInterval);
    }
    console.log("🚀 Starting OI Polling for active symbols...");
    this.pollOIForActiveSymbols(); // Initial poll
    this.oiPollingInterval = setInterval(() => {
      this.pollOIForActiveSymbols();
    }, this.OI_POLL_INTERVAL_MS);
  }

  stopOIPolling() {
    if (this.oiPollingInterval) {
      clearInterval(this.oiPollingInterval);
      this.oiPollingInterval = null;
      console.log("🛑 Stopped OI Polling");
    }
  }

  async pollOIForActiveSymbols() {
    if (this.isProcessingOiQueue) return;
    this.isProcessingOiQueue = true;

    try {
      if (Date.now() < this.oiApiBanUntil) {
        return;
      }

      const activeSymbols = Array.from(this.microBatchEngine.activeSymbolsSet);
      if (activeSymbols.length === 0) return;

      // Group symbols into batches to avoid rate limits
      const BATCH_SIZE = 10;
      for (let i = 0; i < activeSymbols.length; i += BATCH_SIZE) {
        const batch = activeSymbols.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (symbol) => {
          try {
            // No Futures market for this symbol — asking again every cycle just
            // burns rate limit on a request that cannot succeed.
            if (this.oiUnsupportedSymbols.has(symbol)) return;

            const cached = this.oiCache.get(symbol);
            if (cached && (Date.now() - cached.timestamp < this.OI_CACHE_TTL_MS)) {
              return; // Use cache
            }

            const futuresSymbol = symbol.toUpperCase();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${futuresSymbol}`, {
              signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.status === 418 || response.status === 429) {
              const retryAfter = response.headers.get("Retry-After") || 60;
              this.oiApiBanUntil = Date.now() + (parseInt(retryAfter) * 1000);
              console.warn(`⚠️ OI API Rate Limited. Banned until ${new Date(this.oiApiBanUntil).toLocaleTimeString()}`);
              return;
            }

            if (response.status === 400) {
              // -1121 is Binance's "Invalid symbol" — the pair has no Futures
              // market, so this is permanent rather than a transient failure.
              const body = await response.json().catch(() => null);
              if (body && body.code === -1121) {
                this.oiUnsupportedSymbols.add(symbol);
                console.log(`ℹ️ ${symbol} has no Binance Futures market — OI Change will be skipped for it`);
              }
              return;
            }

            if (response.ok) {
              const data = await response.json();
              if (data.openInterest) {
                this.oiCache.set(symbol, {
                  openInterest: parseFloat(data.openInterest),
                  timestamp: Date.now()
                });
              }
            }
          } catch (err) {
            // Silently fail on network errors for individual symbols to avoid log spam
          }
        }));

        // Small delay between batches
        if (i + BATCH_SIZE < activeSymbols.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } finally {
      this.isProcessingOiQueue = false;
    }
  }

  async evaluateOIChangeConditions(condition, alert, liveData) {
    const symbol = alert.symbol;
    const timeframes = condition.timeframes;
    if (!timeframes || timeframes.length === 0) return false;

    // No Futures market — the filter cannot be evaluated for this symbol at all.
    // null means "not applicable", which the caller treats as a skip, not a fail.
    if (this.oiUnsupportedSymbols.has(symbol)) return null;

    // Get current OI from cache
    const currentOiData = this.oiCache.get(symbol);
    if (!currentOiData) return false; // Supported, just not polled yet — wait
    
    const currentOI = currentOiData.openInterest;
    let anyTimeframePassed = false;

    for (const timeframe of timeframes) {
      const timeframeMs = this.getTimeframeMs(timeframe);
      const currentTime = Date.now();
      const currentCandleStart = Math.floor(currentTime / timeframeMs) * timeframeMs;
      
      const baselineKey = `${symbol}_${timeframe}`;
      let baselineData = this.oiBaselines.get(baselineKey);

      // Initialize baseline if missing or we crossed into a new candle
      if (!baselineData || currentCandleStart > baselineData.candleStart) {
        baselineData = {
          oi: currentOI,
          candleStart: currentCandleStart
        };
        this.oiBaselines.set(baselineKey, baselineData);
        // During init, change is 0%
        continue; 
      }

      const baselineOI = baselineData.oi;
      if (baselineOI <= 0) continue;

      let calculatedChange = 0;
      if (condition.type === "PERCENTAGE") {
        calculatedChange = ((currentOI - baselineOI) / baselineOI) * 100;
      } else {
        calculatedChange = currentOI - baselineOI;
      }

      const threshold = parseFloat(condition.value);
      if (isNaN(threshold)) continue;

      let passed = false;
      if (condition.direction === "increase") {
        passed = calculatedChange >= threshold;
      } else if (condition.direction === "decrease") {
        passed = calculatedChange <= -threshold;
      } else if (condition.direction === "both") {
        passed = Math.abs(calculatedChange) >= threshold;
      }

      if (passed) {
        anyTimeframePassed = true;
        break; // One timeframe passing is enough
      }
    }

    return anyTimeframePassed;
  }

  // OPTIMIZATION HELPER: Get only active/set conditions in priority order
  getActiveConditions(conditions, liveData, alert, baselinePriceForCheck = null, triggerContext = {}) {
    const activeConditions = [];

    // 🔥 CRITICAL: Use passed baseline for calculations
    const effectiveBaseline = baselinePriceForCheck || alert.baselinePrice;

    // Priority 1: Min Daily (fastest check, most likely to fail)
    // ✅ CRITICAL: Use ONLY volume24h (ticker.q = quote volume in USDT)
    // ticker.v = base volume (e.g., BTC) - WRONG for USDT comparison!
    // ticker.q = quote volume (USDT) - CORRECT for minDaily comparison!
    if (
      this.isConditionSet(conditions.minDaily) &&
      liveData.volume24h  // Only check if quote volume exists
    ) {
      activeConditions.push({
        name: "Min Daily Volume",
        priority: 1,
        check: async () => {
          const minVolume = parseFloat(conditions.minDaily);

          // ✅ FIX: Use ONLY volume24h (quote volume in USDT)
          // NOT liveData.volume which is base volume!
          const actualVolume = parseFloat(liveData.volume24h || 0);

          // ✅ Explicit validation
          if (isNaN(minVolume) || minVolume <= 0) {
            console.warn(`⚠️ Invalid minDaily value: ${conditions.minDaily}`);
            return {
              passed: false,
              reason: `Invalid minDaily: ${conditions.minDaily}`
            };
          }

          if (isNaN(actualVolume) || actualVolume <= 0) {
            console.warn(`⚠️ No USDT volume data for ${liveData.symbol || 'UNKNOWN'}`);
            return {
              passed: false,
              reason: `No USDT volume data available`
            };
          }

          // Log for debugging
          console.log(
            `📊 Min Daily Check - ${liveData.symbol || 'UNKNOWN'}: ` +
            `Required=${minVolume.toLocaleString()} USDT, ` +
            `Actual=${actualVolume.toLocaleString()} USDT (quote volume)`
          );

          if (actualVolume < minVolume) {
            return {
              passed: false,
              reason: `Volume ${actualVolume.toLocaleString()} < ${minVolume.toLocaleString()} USDT`
            };
          }

          return {
            passed: true,
            reason: `Volume ${actualVolume.toLocaleString()} >= ${minVolume.toLocaleString()} USDT`
          };
        },
      });
    }

    // Priority 2: Change Percent (core condition, medium cost)
    if (this.isConditionSet(conditions.changePercent?.percentage)) {
      activeConditions.push({
        name: "Change Percent",
        priority: 2,
        check: async () => {
          const requiredChange = parseFloat(
            conditions.changePercent.percentage
          );
          const direction = conditions.changePercent.direction || "increase";

          // The comparison is only meaningful against the REAL Binance open of
          // the candle we are currently inside. The baseline is set at the
          // boundary from whatever price is on hand and repaired to the true
          // open once the kline for that boundary arrives -- but an alert can
          // fire in the seconds before it arrives, which is how REUSDT reported
          // 1.758% on a real 0.354% move (baseline 0.5575 vs real open 0.5653).
          //
          // So: refuse to evaluate unless the true open for THIS boundary is
          // known and the baseline already equals it. Not a second correction
          // site -- it only declines, so the decision and the recorded history
          // keep coming from the single repaired baseline.
          const cpTimeframe = conditions.changePercent.timeframe;
          const cpTimeframeMs = this.getTimeframeMs(cpTimeframe);
          const cpBoundary = Math.floor(Date.now() / cpTimeframeMs) * cpTimeframeMs;
          const cpCached = this.candleCache.get(`${alert.symbol}_${cpTimeframe}`);
          const cpTrueOpen =
            cpCached &&
            cpCached.open !== null &&
            isFinite(cpCached.open) &&
            cpCached.open > 0 &&
            cpCached.startTime === cpBoundary
              ? cpCached.open
              : null;

          if (cpTrueOpen === null) {
            return {
              passed: false,
              reason: `${cpTimeframe} candle open not confirmed yet`,
            };
          }

          if (
            !(effectiveBaseline > 0) ||
            Math.abs(cpTrueOpen - effectiveBaseline) / cpTrueOpen > 0.0001
          ) {
            return {
              passed: false,
              reason: `baseline ${effectiveBaseline} does not match real ${cpTimeframe} candle open ${cpTrueOpen} — not firing on an unverified baseline`,
            };
          }

          const changeFromBaseline =
            ((liveData.price - effectiveBaseline) / effectiveBaseline) *
            100;

          // 🛡️ NaN Protection
          if (Number.isNaN(changeFromBaseline)) {
            return { passed: false, reason: "Calculation error (NaN)" };
          }

          const absoluteChange = Math.abs(changeFromBaseline);

          // Check direction first (fastest)
          if (direction === "increase" && changeFromBaseline < 0) {
            return {
              passed: false,
              reason: `Price decreased but increase required`,
            };
          }
          if (direction === "decrease" && changeFromBaseline > 0) {
            return {
              passed: false,
              reason: `Price increased but decrease required`,
            };
          }

          // Check percentage
          if (absoluteChange < requiredChange) {
            return {
              passed: false,
              reason: `${absoluteChange.toFixed(3)}% < ${requiredChange}%`,
            };
          }

          return {
            passed: true,
            reason: `${absoluteChange.toFixed(
              3
            )}% >= ${requiredChange}% (${direction})`,
          };
        },
      });
    }

    // Priority 3: Alert Count (check if alert is locked/in cooldown)
    if (this.isConditionSet(conditions.alertCount?.timeframe)) {
      activeConditions.push({
        name: "Alert Count",
        priority: 3,
        check: async () => {
          // Check if alert is locked (prevent duplicate triggers)
          if (isAlertLocked(alert)) {
            const lockUntil = new Date(alert.conditions.alertCount.lockUntil);
            const now = new Date();
            const timeRemaining = Math.max(
              0,
              lockUntil.getTime() - now.getTime()
            );
            const minutesRemaining = Math.ceil(timeRemaining / (1000 * 60));

            return {
              passed: false,
              reason: `Alert locked for ${minutesRemaining} minutes`,
            };
          }

          return { passed: true, reason: "Alert count condition met" };
        },
      });
    }

    // Priority 4: Candle (higher cost due to data updates)
    if (this.isConditionSet(conditions.candle?.timeframes)) {
      activeConditions.push({
        name: "Candle Pattern",
        priority: 4,
        check: async () => {
          // Only check if timeframes are actually set
          if (
            !conditions.candle.timeframes ||
            conditions.candle.timeframes.length === 0
          ) {
            return {
              passed: false,
              reason: "No timeframes configured for candle condition",
            };
          }

          // Update candle data for required timeframes
          for (const timeframe of conditions.candle.timeframes) {
            await this.updateCandleData(alert.symbol, timeframe, liveData);
          }

          const candleMatch = await this.evaluateCandleConditions(
            conditions.candle,
            liveData,
            alert.symbol
          );
          // evaluateCandleConditions returns a plain boolean (ALL listed
          // timeframes must be above their own open) -- it can't say which
          // one failed here, but naming the condition/timeframes is still a
          // large improvement over the previous "not met" with zero context;
          // the per-timeframe CANDLE_ABOVE_OPEN FAILED log lines it prints
          // internally now need to be read alongside this line's symbol.
          const candleDesc = `${conditions.candle.condition || "CANDLE_ABOVE_OPEN"} on ${conditions.candle.timeframes.join(",")}`;
          return {
            passed: candleMatch,
            reason: candleMatch
              ? `Candle ${candleDesc}`
              : `Candle not met (${candleDesc})`,
          };
        },
      });
    }

    // Priority 5: RSI Range (highest cost due to calculations)
    if (this.isConditionSet(conditions.rsiRange?.timeframes)) {
      activeConditions.push({
        name: "RSI Range",
        priority: 5,
        check: async () => {
          // Only check if timeframes are actually set
          if (
            !conditions.rsiRange.timeframes ||
            conditions.rsiRange.timeframes.length === 0
          ) {
            return {
              passed: false,
              reason: "No timeframes configured for RSI condition",
            };
          }

          const rsiMatch = await this.evaluateRSIConditions(
            conditions.rsiRange,
            liveData,
            alert.symbol
          );
          // null = data still loading, skip this condition (don't fail alert)
          if (rsiMatch === null) {
            return { passed: true, reason: "RSI data loading — skipped this tick" };
          }
          // evaluateRSIConditions returns a plain boolean (ALL listed timeframes
          // must pass), so this can't say which one failed -- but naming the
          // condition itself beats the previous "not met" with zero context.
          const rsiDesc = `${conditions.rsiRange.condition || "ABOVE"} ${conditions.rsiRange.level || 50} on ${conditions.rsiRange.timeframes.join(",")}`;
          return {
            passed: rsiMatch,
            reason: rsiMatch ? `RSI ${rsiDesc}` : `RSI not met (${rsiDesc})`,
          };
        },
      });
    }

    // Priority 5.5: RSI Divergence
    if (this.isConditionSet(conditions.rsiDivergence?.timeframes)) {
      activeConditions.push({
        name: "RSI Divergence",
        priority: 5.5,
        check: async () => {
          if (
            !conditions.rsiDivergence.timeframes ||
            conditions.rsiDivergence.timeframes.length === 0
          ) {
            return {
              passed: false,
              reason: "No timeframes configured for RSI Divergence",
            };
          }

          const triggerMode = this.resolveDivergenceTriggerMode(
            conditions.rsiDivergence.condition
          );

          // Conditional is a safety shield, not a trigger. It looks for a
          // confirmed divergence of a selected type whose starting pivot is
          // still unmitigated, and if price is testing that pivot right now it
          // vetoes the alert no matter what every other filter says. Finding
          // nothing is a pass, so the remaining conditions decide on their own
          // — which also means Conditional on its own can never fire an alert,
          // it only ever takes one away.
          if (triggerMode === "conditional") {
            const shieldMatch = await this.checkDivergenceShield(
              conditions.rsiDivergence,
              alert.symbol
            );

            if (shieldMatch?.found) {
              console.log(
                `🛡️ ${alert.symbol} BLOCKED by Conditional shield — ${shieldMatch.label} on ${shieldMatch.timeframe}, unmitigated pivot line ${shieldMatch.pivotLine}`
              );
              return {
                passed: false,
                // A veto, not an ordinary failure: no override may skip past it.
                blocking: true,
                reason: `Blocked: unmitigated ${shieldMatch.label} on ${shieldMatch.timeframe} (pivot ${shieldMatch.pivotLine})`,
              };
            }

            return {
              passed: true,
              reason: "Safety shield clear — no unmitigated divergence pivot in the way",
            };
          }

          const divMatch = await this.evaluateRSIDivergence(
            conditions.rsiDivergence,
            alert.symbol,
            14, // rsiPeriod
            triggerMode
          );

          if (divMatch === null || (typeof divMatch === "object" && divMatch.found === undefined)) {
            return { passed: true, reason: "RSI data loading — skipped this tick" };
          }

          // Record what fired so the alert message can show the divergence detail
          if (divMatch.found) {
            triggerContext.divergence = {
              type: divMatch.type,
              label: divMatch.label,
              timeframe: divMatch.timeframe,
              rsiPeriod: divMatch.rsiPeriod,
              isBearish: divMatch.isBearish,
              barsBetween: divMatch.barsBetween,
              pivot1: divMatch.pivot1,
              pivot2: divMatch.pivot2,
              trigger: triggerMode,
              // Keyed on the anchor only. The measured end is the current candle and
              // moves forward every bar, so including it would re-alert on the same
              // divergence for as long as it holds.
              signature: `${divMatch.timeframe}:${divMatch.type}:${divMatch.pivot2?.time}`,
              // Divergence is the ONLY trigger → notifications show a divergence-only template
              divergenceOnly: !this.hasNonDivergenceTrigger(conditions),
            };
          }

          if (!divMatch.found) {
            return {
              passed: false,
              reason: `No divergence found (${triggerMode} trigger)`,
            };
          }

          // The same confirmed pivot stays valid for a couple of bars — alert on it once
          const alertKey = alert._id?.toString();
          if (
            this.lastFiredDivergence?.get(alertKey) ===
            triggerContext.divergence.signature
          ) {
            return {
              passed: false,
              reason: `Divergence (${divMatch.type}) already alerted for this pivot`,
            };
          }

          // Independent is a supreme override: once the confirmation candle closes
          // in the right colour, the divergence alone fires the alert and every
          // other selected filter is skipped — except Min Daily Volume and Alert
          // Count, which the aggregation loop still enforces even under this
          // override. Previous still falls through to the normal
          // all-conditions-must-pass check.
          if (triggerMode === "independent") {
            console.log(
              `⚡ ${alert.symbol} Independent Divergence override — ${divMatch.label} on ${divMatch.timeframe}, bypassing all other filters except Min Daily/Alert Count`
            );
            return {
              passed: true,
              bypassOthers: true,
              reason: `RSI Divergence (${divMatch.type}) — Independent trigger, other filters bypassed`,
            };
          }

          return {
            passed: true,
            reason: `RSI Divergence (${divMatch.type}) — ${triggerMode} trigger`,
          };
        },
      });
    }

    // Priority 6: Volume (medium-high cost)
    // DISABLED PER CLIENT REQUEST -- "volume ni chaiye" (Increasing/Decreasing
    // Volume condition, not Daily min Volume, which is Priority 1 above and
    // stays active). Gated to never match rather than deleted, so any stored
    // alert that already has conditions.volume populated is silently ignored
    // instead of erroring. evaluateVolumeConditions is untouched, just
    // unreachable from here.
    if (false && this.isConditionSet(conditions.volume?.timeframes)) {
      activeConditions.push({
        name: "Volume",
        priority: 6,
        check: async () => {
          // Only check if timeframes are actually set
          if (
            !conditions.volume.timeframes ||
            conditions.volume.timeframes.length === 0
          ) {
            return {
              passed: false,
              reason: "No timeframes configured for volume condition",
            };
          }

          const volumeMatch = await this.evaluateVolumeConditions(
            conditions.volume,
            liveData,
            alert.symbol,
            alert
          );
          // null = data unavailable, skip this condition (don't fail alert)
          if (volumeMatch === null) {
            return { passed: true, reason: "Volume data unavailable — skipped this tick" };
          }
          return {
            passed: volumeMatch,
            reason: volumeMatch
              ? "Volume condition met"
              : "Volume condition not met",
          };
        },
      });
    }

    // Priority 7: MACD (Fast EMA vs Slow EMA)
    if (this.isConditionSet(conditions.macd?.timeframes)) {
      activeConditions.push({
        name: "MACD",
        priority: 7,
        check: async () => {
          if (
            !conditions.macd.timeframes ||
            conditions.macd.timeframes.length === 0
          ) {
            return {
              passed: false,
              reason: "No timeframes configured for MACD condition",
            };
          }

          const macdMatch = await this.evaluateMACDConditions(
            conditions.macd,
            liveData,
            alert.symbol
          );
          if (macdMatch === null) {
            return { passed: false, reason: "MACD data loading — blocked until ready" };
          }
          return {
            passed: macdMatch,
            reason: macdMatch ? "MACD condition met" : "MACD condition not met",
          };
        },
      });
    }

    // Priority 8: Open Interest (highest cost)
    if (this.isConditionSet(conditions.openInterest?.timeframes)) {
      activeConditions.push({
        name: "Open Interest",
        priority: 8,
        check: async () => {
          // Only check if timeframes are actually set
          if (
            !conditions.openInterest.timeframes ||
            conditions.openInterest.timeframes.length === 0
          ) {
            return {
              passed: false,
              reason: "No timeframes configured for open interest condition",
            };
          }

          const openInterestMatch = await this.evaluateOpenInterestConditions(
            conditions.openInterest,
            alert,
            liveData
          );
          return {
            passed: openInterestMatch,
            reason: openInterestMatch
              ? "Open Interest condition met"
              : "Open Interest condition not met",
          };
        },
      });
    }

    // Priority 8.5: OI Change (replaces old openInterest)
    if (this.isConditionSet(conditions.oiChange?.timeframes)) {
      activeConditions.push({
        name: "OI Change",
        priority: 8.5,
        check: async () => {
          if (
            !conditions.oiChange.timeframes ||
            conditions.oiChange.timeframes.length === 0
          ) {
            return {
              passed: false,
              reason: "No timeframes configured for OI Change condition",
            };
          }

          const oiChangeMatch = await this.evaluateOIChangeConditions(
            conditions.oiChange,
            alert,
            liveData
          );
          
          if (oiChangeMatch === null) {
            // Symbol has no Futures market, so there is no OI to test against.
            // Failing here would silently kill every alert on those symbols.
            return {
              passed: true,
              reason: "No Futures market for this symbol — OI Change check skipped",
            };
          }
          
          return {
            passed: oiChangeMatch,
            reason: oiChangeMatch
              ? "OI Change condition met"
              : "OI Change condition not met",
          };
        },
      });
    }

    // Priority 8.7: CVD (Cumulative Volume Delta)
    if (this.isConditionSet(conditions.cvd?.timeframes)) {
      activeConditions.push({
        name: "CVD",
        priority: 8.7,
        check: async () => {
          if (!conditions.cvd.timeframes || conditions.cvd.timeframes.length === 0) {
            return { passed: false, reason: "No timeframes configured for CVD" };
          }

          const cvdMatch = await this.evaluateCVDConditions(
            conditions.cvd,
            alert.symbol
          );

          if (!cvdMatch || cvdMatch.found === undefined) {
            return { passed: true, reason: "CVD data loading — skipped this tick" };
          }

          if (!cvdMatch.found) {
            return { passed: false, reason: `No CVD signal (${conditions.cvd.mode || "surge"} mode)` };
          }

          // Fire once per setup. Surge/Absorption are keyed on the candle, so
          // they cannot repeat within one bar; Divergence is keyed on its anchor
          // so a setup that stays valid does not re-alert every bar.
          const alertKey = alert._id?.toString();
          if (!this.lastFiredCvd) this.lastFiredCvd = new Map();
          if (cvdMatch.signature && this.lastFiredCvd.get(alertKey) === cvdMatch.signature) {
            return {
              passed: false,
              reason: `CVD (${cvdMatch.type}) already alerted for this candle/pivot`,
            };
          }

          triggerContext.cvd = {
            mode: cvdMatch.mode,
            type: cvdMatch.type,
            label: cvdMatch.label,
            timeframe: cvdMatch.timeframe,
            delta: cvdMatch.delta,
            deltaPct: cvdMatch.deltaPct,
            barsBetween: cvdMatch.barsBetween,
            pivot1: cvdMatch.pivot1,
            pivot2: cvdMatch.pivot2,
            signature: cvdMatch.signature,
          };

          return {
            passed: true,
            reason: `CVD ${cvdMatch.label} (${cvdMatch.timeframe})`,
          };
        },
      });
    }

    // Priority 9: Volume EMA Crossing (checks if volume bar crosses above EMA line)
    if (this.isConditionSet(conditions.volumeEma?.timeframes)) {
      activeConditions.push({
        name: "Volume EMA",
        priority: 9,
        check: async () => {
          if (
            !conditions.volumeEma.timeframes ||
            conditions.volumeEma.timeframes.length === 0
          ) {
            return {
              passed: false,
              reason: "No timeframes configured for Volume EMA condition",
            };
          }

          const volumeEmaMatch = await this.evaluateVolumeEmaCrossing(
            conditions.volumeEma,
            liveData,
            alert.symbol
          );
          if (volumeEmaMatch === null) {
            return { passed: false, reason: "Volume EMA data loading — blocked until ready" };
          }
          return {
            passed: volumeEmaMatch,
            reason: volumeEmaMatch
              ? "Volume EMA crossing up condition met"
              : "Volume EMA crossing up condition not met",
          };
        },
      });
    }

    // Sort by priority (lowest number = highest priority)
    return activeConditions.sort((a, b) => a.priority - b.priority);
  }

  // OPTIMIZATION HELPER: Check if a condition is actually set/configured
  isConditionSet(condition) {
    if (!condition) return false;

    // For arrays (timeframes)
    if (Array.isArray(condition)) {
      return condition.length > 0;
    }

    // For strings/numbers (minDaily, percentage, etc.)
    if (typeof condition === "string") {
      const trimmed = condition.trim();
      if (trimmed === "") return false;

      // ✅ FIX: Parse as number and check if > 0
      // This prevents "0" or "0.0" from being considered valid
      const numValue = parseFloat(trimmed);
      return !isNaN(numValue) && numValue > 0;
    }

    if (typeof condition === "number") {
      return !isNaN(condition) && condition > 0;
    }

    // For objects
    if (typeof condition === "object") {
      return Object.keys(condition).length > 0;
    }

    return false;
  }

  // Trigger alert with live data and update baseline
  // 🔥 FIX: Added originalBaselinePrice parameter to preserve correct change %
  async triggerAlertWithLiveData(alert, liveData, originalBaselinePrice = null, triggerContext = {}) {
    // CRITICAL: Check if alert is ALREADY locked (Alert Count condition)
    if (isAlertLocked(alert)) {
      const lockUntil = new Date(alert.conditions.alertCount.lockUntil);
      const timeRemaining = Math.max(0, lockUntil.getTime() - Date.now());
      console.log(`🔒 Alert ${alert._id} LOCKED by Alert Count until ${lockUntil.toISOString()} (${Math.ceil(timeRemaining / 60000)}min remaining)`);
      return false;
    }

    // CRITICAL: Acquire Redis lock to prevent duplicate processing
    // Especially important when alertCount condition is set
    const hasAlertCount = alert.conditions?.alertCount?.timeframe;
    const lockToken = hasAlertCount
      ? await this.acquireAlertLock(alert._id.toString(), 3000) // Longer lock for alertCount (3s)
      : await this.acquireAlertLock(alert._id.toString(), 2000); // Standard lock (2s)

    if (!lockToken) {
      // Another worker is already processing this alert
      return false;
    }

    try {
      // 🔥 FIX: Use originalBaselinePrice if passed, else use current baseline
      // This preserves the correct change % before baseline was reset
      const baselinePrice = originalBaselinePrice || parseFloat(alert.baselinePrice) || 0;
      const baselineVolume = parseFloat(alert.baselineVolume) || 0;
      const baselineTimestamp = alert.baselineTimestamp || new Date();
      const livePrice = parseFloat(liveData.price) || 0;

      // Calculate change from baseline with proper NaN handling
      let changeFromBaseline = 0;
      let changeFromBaselinePercent = 0;

      if (baselinePrice > 0 && livePrice > 0) {
        changeFromBaseline = livePrice - baselinePrice;
        changeFromBaselinePercent = (changeFromBaseline / baselinePrice) * 100;

        // Handle NaN or Infinity cases
        if (!isFinite(changeFromBaseline)) changeFromBaseline = 0;
        if (!isFinite(changeFromBaselinePercent)) changeFromBaselinePercent = 0;
      }

      // Debug: Log live data and alert data

      // Determine direction based on price change
      const direction =
        changeFromBaselinePercent > 0
          ? "increase"
          : changeFromBaselinePercent < 0
            ? "decrease"
            : "both";

      // Create alert history entry with all required fields
      const alertHistory = {
        alertId: alert._id,
        userId: alert.userId,
        symbol: alert.symbol,
        alertConditions: {
          ...alert.conditions,
          changePercent: {
            ...alert.conditions.changePercent,
            direction: direction,
          },
        },
        triggerData: {
          price: parseFloat(liveData.price) || 0,
          priceChange: parseFloat(liveData.priceChange) || 0,
          priceChangePercent: parseFloat(liveData.priceChangePercent) || 0,
          volume24h: parseFloat(liveData.volume || liveData.volume24h) || 0,
          high: parseFloat(liveData.high || liveData.price) || 0,
          low: parseFloat(liveData.low || liveData.price) || 0,
          open: parseFloat(liveData.open || liveData.price) || 0,
          close: parseFloat(liveData.close || liveData.price) || 0,
          timestamp: liveData.timestamp || Date.now(),
        },
        baselineData: {
          baselinePrice: baselinePrice,
          baselineVolume: baselineVolume,
          baselineTimestamp: baselineTimestamp,
          changeFromBaseline: changeFromBaseline,
          changeFromBaselinePercent: changeFromBaselinePercent,
        },
        // Present only when an RSI divergence took part in this trigger
        divergence: triggerContext.divergence || undefined,
        triggeredAt: new Date(),
        conditions: this.getAlertConditionsText(alert.conditions),
      };

      // CRITICAL: Save AlertHistory FIRST (blocking) - needed for notifications
      // This is fast (10-50ms) and required for Email/Telegram to work
      const savedAlertHistory = await AlertHistoryService.createAlertHistory(
        alertHistory
      );

      // CRITICAL: Use saved alert history with _id for notification
      if (!savedAlertHistory || !savedAlertHistory._id) {
        console.error(
          `❌ Failed to save alert history for ${alert.symbol}, notification may fail`
        );
        return {
          passed: false,
          reason: "Failed to save alert history",
        };
      }

      console.log(
        `✅ Alert history saved: ${savedAlertHistory._id} for ${alert.symbol}`
      );

      // Remember which divergence pivot we just alerted on, so the same confirmed
      // pivot does not re-fire on every tick while it stays valid.
      if (triggerContext.divergence?.signature) {
        if (!this.lastFiredDivergence) this.lastFiredDivergence = new Map();
        this.lastFiredDivergence.set(
          alert._id?.toString(),
          triggerContext.divergence.signature
        );
      }

      // Same idea for CVD, kept in its own map so the two never interfere.
      if (triggerContext.cvd?.signature) {
        if (!this.lastFiredCvd) this.lastFiredCvd = new Map();
        this.lastFiredCvd.set(alert._id?.toString(), triggerContext.cvd.signature);
      }

      // Update alert with latest price and new baseline
      const updateData = {
        lastTriggeredAt: new Date(),
        lastTriggeredPrice: liveData.price,
        lastTriggeredVolume: liveData.volume || liveData.volume24h,
        // Update baseline to current live price for next round
        baselinePrice: liveData.price,
        baselineVolume: liveData.volume || liveData.volume24h,
        baselineTimestamp: new Date(),
      };

      // Update alert lock if alert count is set
      if (
        alert.conditions.alertCount &&
        alert.conditions.alertCount.timeframe
      ) {
        const updatedConditions = updateAlertLock(alert);
        updateData.conditions = updatedConditions;

        console.log(
          `🔒 Alert ${alert._id} LOCKED for ${alert.conditions.alertCount.timeframe} until ${updatedConditions.alertCount.lockUntil}`
        );

        // CRITICAL FIX: Update in-memory alert IMMEDIATELY with lock
        alert.conditions = updatedConditions;
      }

      // CRITICAL: Immediate database update for baseline price (blocking)
      // This prevents duplicate alerts by ensuring baseline is updated immediately
      try {
        await Alert.findByIdAndUpdate(alert._id, updateData);
        console.log(
          `✅ Alert ${alert._id} baseline immediately updated in DB: ${liveData.price}`
        );
      } catch (dbError) {
        console.error(
          `❌ CRITICAL: Failed to update baseline in DB immediately:`,
          dbError.message
        );
        // Still queue as fallback
        this.enqueueDbOperation({
          type: "update_alert",
          alertId: alert._id.toString(),
          data: updateData,
          priority: "critical", // Critical priority for failed immediate updates
        }).catch(() => { });
      }

      console.log(
        `✅ Alert ${alert._id} updated with new baseline price: ${liveData.price}`
      );

      // CRITICAL FIX: Update in-memory cache IMMEDIATELY with lock
      const alertsForSymbol = this.activeAlerts.get(alert.symbol);
      if (alertsForSymbol) {
        const alertIndex = alertsForSymbol.findIndex(
          (a) => a._id.toString() === alert._id.toString()
        );
        if (alertIndex !== -1) {
          // Update in memory immediately with NEW CONDITIONS (including lock)
          alertsForSymbol[alertIndex] = {
            ...alertsForSymbol[alertIndex],
            ...updateData,
            conditions: updateData.conditions || alertsForSymbol[alertIndex].conditions,
            baselinePrice: liveData.price,
            baselineVolume: liveData.volume || liveData.volume24h,
            baselineTimestamp: new Date(),
          };
          console.log(`✅ In-memory alert updated with lock: ${alert._id}`);
        }
      }

      // Update Redis cache in background (non-blocking, no DB query)
      this.updateAlertInCache({
        ...alert,
        ...updateData,
        baselinePrice: liveData.price,
        baselineVolume: liveData.volume || liveData.volume24h,
        baselineTimestamp: new Date(),
      }).catch(() => { }); // Silent fail - non-critical

      // Update live price in cache for this symbol
      // No TTL - WebSocket provides real-time updates continuously
      if (this.redisClient) {
        const priceCacheKey = `crypto:${alert.symbol}`;
        const priceData = {
          price: liveData.price,
          volume: liveData.volume || liveData.volume24h,
          volume24h: liveData.volume24h || liveData.volume,
          priceChange: liveData.priceChange || 0,
          priceChangePercent: liveData.priceChangePercent || 0,
          high: liveData.high || liveData.price,
          low: liveData.low || liveData.price,
          open: liveData.open || liveData.price,
          close: liveData.close || liveData.price,
          timestamp: Date.now(),
        };
        this.redisClient
          .set(priceCacheKey, JSON.stringify(priceData))
          .catch((error) => {
            console.error(
              `❌ Error updating price cache (non-blocking):`,
              error.message
            );
          });
      }

      // Log savedAlertHistory before sending notification
      console.log(
        `📤 About to send notification for ${alert.symbol}, savedAlertHistory:`
      );

      // 🔥 NEW: Pre-capture chart at EXACT trigger moment (no delay!)
      // This ensures chart shows the correct candle, not a new one started after processing
      try {
        // 🔥 FIX: Fetch user's preferred timeframe from User model (dashboard setting)
        let timeframe = "5m"; // default
        try {
          const User = (await import("../models/User.js")).default;
          const user = await User.findById(alert.userId).select("preferredTimeframe").lean();
          if (user?.preferredTimeframe) {
            timeframe = user.preferredTimeframe;
            console.log(`📊 Using user's preferred timeframe: ${timeframe}`);
          }
        } catch (userError) {
          console.warn(`⚠️ Could not fetch user preference: ${userError.message}, using default 5m`);
        }

        const chartOptions = {
          alertData: {
            triggerPrice: liveData.price,
            baselinePrice: baselinePrice,
            changePercent: changeFromBaselinePercent
          },
          // 🔥 NEW: Pass liveData so chart can inject current candle
          liveData: liveData
        };

        console.log(`📸 Pre-capturing chart for ${alert.symbol} at trigger moment...`);
        const chartBuffer = await ChartScreenshotService.captureChart(
          alert.symbol,
          timeframe,
          chartOptions
        );

        if (chartBuffer && this.redisClient) {
          // Store chart in Redis with 5 minute TTL (enough time for notification to be sent)
          const chartKey = `chart:alert:${savedAlertHistory._id}`;
          await this.redisClient.setex(chartKey, 300, chartBuffer.toString('base64'));
          console.log(`✅ Pre-captured chart stored in Redis: ${chartKey} (${(chartBuffer.length / 1024).toFixed(1)}KB)`);
        }
      } catch (chartError) {
        console.warn(`⚠️ Pre-capture chart failed for ${alert.symbol}: ${chartError.message}`);
        // Continue with notification - chart is optional
      }

      // Send real-time notification using saved alert history (with _id)
      // Fire and forget - don't block alert processing for notifications
      // This allows Telegram notifications to be sent in parallel without blocking
      this.sendRealTimeNotification(alert, liveData, savedAlertHistory).catch(
        (error) => {
          console.error(
            `❌ Error sending notification for ${alert.symbol} (non-blocking):`,
            error.message
          );
        }
      );

      return true;
    } catch (error) {
      console.error(`❌ Error triggering alert ${alert._id}:`, error);
      return false;
    } finally {
      // CRITICAL: Always release lock, even if error occurs
      if (lockToken) {
        await this.releaseAlertLock(alert._id.toString(), lockToken);
      }
    }
  }

  // Get current live prices for all active symbols
  async getCurrentLivePrices() {
    try {
      const livePrices = {};
      const symbols = Array.from(this.activeAlerts.keys());

      // Try to get from Redis cache first
      const { getRedisClient } = await import("../utils/redis.js");
      const redisClient = getRedisClient();

      for (const symbol of symbols) {
        try {
          let priceData = null;
          if (redisClient) {
            priceData = await redisClient.get(`crypto:${symbol}`);
            if (!priceData) {
              priceData = await redisClient.get(`crypto:${symbol.toLowerCase()}`);
            }
          }

          if (priceData) {
            const data = JSON.parse(priceData);
            livePrices[symbol] = {
              price: parseFloat(data.price),
              volume:
                parseFloat(data.volume) || parseFloat(data.volume24h) || 0,
              volume24h:
                parseFloat(data.volume24h) || parseFloat(data.volume) || 0,
              priceChange: parseFloat(data.priceChange) || 0,
              priceChangePercent: parseFloat(data.priceChangePercent) || 0,
              high: parseFloat(data.high) || parseFloat(data.price),
              low: parseFloat(data.low) || parseFloat(data.price),
              open: parseFloat(data.open) || parseFloat(data.price),
              close: parseFloat(data.close) || parseFloat(data.price),
              timestamp: data.timestamp || Date.now(),
            };
          }
        } catch (error) {
          console.warn(
            `⚠️ Could not get live price for ${symbol}:`,
            error.message
          );
        }
      }

      // Fallback: If no Redis data, fetch from Binance API
      if (Object.keys(livePrices).length === 0) {
        console.log("📊 No Redis data found, fetching from Binance API...");
        try {
          const response = await fetch(
            "https://api.binance.com/api/v3/ticker/24hr"
          );
          const tickers = await response.json();

          for (const symbol of symbols) {
            const ticker = tickers.find((t) => t.symbol === symbol);
            if (ticker) {
              livePrices[symbol] = {
                price: parseFloat(ticker.lastPrice),
                volume: parseFloat(ticker.quoteVolume), // USDT volume
                volume24h: parseFloat(ticker.quoteVolume),
                priceChange: parseFloat(ticker.priceChange),
                priceChangePercent: parseFloat(ticker.priceChangePercent),
                high: parseFloat(ticker.highPrice),
                low: parseFloat(ticker.lowPrice),
                open: parseFloat(ticker.openPrice),
                close: parseFloat(ticker.lastPrice),
                timestamp: Date.now(),
              };
            }
          }
        } catch (apiError) {
          console.warn("⚠️ Error fetching from Binance API:", apiError.message);
        }
      }

      return livePrices;
    } catch (error) {
      console.error("❌ Error getting current live prices:", error);
      return {};
    }
  }

  async processPriceUpdate(priceData) {
    if (this.isProcessing) return;

    this.isProcessing = true;

    try {
      const symbol = priceData.symbol;
      const alerts = this.activeAlerts.get(symbol);

      console.log(
        `📡 Price update received for ${symbol}: Price=${priceData.price
        }, Volume=${priceData.volume || priceData.volume24h}, Change=${priceData.priceChangePercent
        }%`
      );

      if (!alerts || alerts.length === 0) {
        console.log(`⚠️ No active alerts found for ${symbol}`);
        return;
      }

      console.log(`🔍 Found ${alerts.length} active alerts for ${symbol}`);

      // Update candle data for all timeframes used by alerts
      // Include timeframes from both changePercent and candle conditions
      const timeframes = new Set();
      for (const alert of alerts) {
        // Add changePercent timeframes
        if (
          alert.conditions.changePercent &&
          alert.conditions.changePercent.timeframe
        ) {
          timeframes.add(alert.conditions.changePercent.timeframe);
        }
        // Add candle condition timeframes
        if (
          alert.conditions.candle &&
          alert.conditions.candle.timeframes &&
          Array.isArray(alert.conditions.candle.timeframes)
        ) {
          for (const tf of alert.conditions.candle.timeframes) {
            timeframes.add(tf);
          }
        }
      }

      // Update candle data for each timeframe
      for (const timeframe of timeframes) {
        await this.updateCandleData(symbol, timeframe, priceData);
      }

      // Process each alert for this symbol
      for (const alert of alerts) {
        await this.checkAlertConditions(alert, priceData);
      }
    } catch (error) {
      console.error(
        `❌ Error processing price update for ${priceData.symbol}:`,
        error
      );
    } finally {
      this.isProcessing = false;
    }
  }

  async checkAlertConditions(alert, priceData) {
    try {
      // 🔥 CRITICAL FIX: Save ORIGINAL baseline BEFORE any updates (same as processAlertWithLiveData)
      // This prevents false triggers at hour boundaries
      const originalBaselinePrice = parseFloat(alert.baselinePrice) || 0;
      const originalBaselineVolume = parseFloat(alert.baselineVolume) || 0;

      console.log(
        `🔍 Checking alert conditions for ${alert.symbol} (Alert ID: ${alert._id})`
      );
      console.log(
        `📊 Live data: Price=${priceData.price}, Volume=${priceData.volume24h}, Change=${priceData.priceChangePercent}%`
      );
      console.log(
        `📊 Baseline: Price=${originalBaselinePrice}, Volume=${originalBaselineVolume}, Timestamp=${alert.baselineTimestamp}`
      );

      let shouldUpdateBaseline = false;
      let newBaselinePrice = null;
      let newBaselineVolume = null;

      if (alert.conditions?.changePercent?.timeframe) {
        const timeframe = alert.conditions.changePercent.timeframe;
        const timeframeMs = this.getTimeframeMs(timeframe);
        const baselineTimestamp = alert.baselineTimestamp
          ? new Date(alert.baselineTimestamp).getTime()
          : Date.now();
        const currentTime = Date.now();
        const timeSinceBaseline = currentTime - baselineTimestamp;

        // New candle boundary detected — apply baseline reset NOW (before alert check)
        // Deferring it causes false alerts: lock expires + old baseline still in memory
        // = previous candle's accumulated change% triggers immediately on new candle open
        if (timeSinceBaseline >= timeframeMs) {
          console.log(
            `🕯️ New candle boundary for ${alert.symbol} (${timeframe}): resetting baseline from ${alert.baselinePrice} → ${priceData.price} (skipping alert check this tick)`
          );

          shouldUpdateBaseline = true;
          newBaselinePrice = priceData.price;
          newBaselineVolume = priceData.volume || priceData.volume24h;

          // Apply baseline update immediately so next tick starts fresh
          alert.baselinePrice = newBaselinePrice;
          alert.baselineVolume = newBaselineVolume;
          alert.baselineTimestamp = new Date();

          // Persist to DB (non-blocking)
          Alert.findByIdAndUpdate(alert._id, {
            baselinePrice: newBaselinePrice,
            baselineVolume: newBaselineVolume,
            baselineTimestamp: new Date(),
          }).catch((err) => console.error(`❌ Baseline reset DB error ${alert.symbol}:`, err.message));

          // Update in-memory cache
          const alertsForSymbol = this.activeAlerts.get(alert.symbol);
          if (alertsForSymbol) {
            const alertIndex = alertsForSymbol.findIndex((a) => a._id.toString() === alert._id.toString());
            if (alertIndex !== -1) {
              alertsForSymbol[alertIndex] = {
                ...alertsForSymbol[alertIndex],
                baselinePrice: newBaselinePrice,
                baselineVolume: newBaselineVolume,
                baselineTimestamp: new Date(),
              };
            }
          }

          // Update Redis cache (non-blocking)
          this.updateAlertInCache({
            ...alert,
            baselinePrice: newBaselinePrice,
            baselineVolume: newBaselineVolume,
            baselineTimestamp: new Date(),
          }).catch(() => { });

          // Skip alert check this tick — next tick will evaluate with the fresh baseline
          return false;
        } else {
          const remainingMs = timeframeMs - timeSinceBaseline;
          const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
          console.log(
            `⏰ Timeframe interval (${timeframe}) not yet reached for ${alert.symbol} (${remainingMinutes}min remaining)`
          );
        }
      }

      // Check if alert is locked (temporary lock due to alert count)
      // 🔥 SPIKE FIX (Option A - Conservative): Bypass lock for MASSIVE spikes (3x+ target)
      if (isAlertLocked(alert)) {
        const lockUntil = new Date(alert.conditions.alertCount.lockUntil);
        const now = new Date();
        const timeRemaining = Math.max(0, lockUntil.getTime() - now.getTime());
        const minutesRemaining = Math.ceil(timeRemaining / (1000 * 60));

        // Calculate current spike magnitude using ORIGINAL baseline
        const requiredChange = parseFloat(alert.conditions?.changePercent?.percentage) || 0;
        const currentChange = originalBaselinePrice && originalBaselinePrice > 0
          ? Math.abs((priceData.price - originalBaselinePrice) / originalBaselinePrice * 100)
          : 0;

        // Bypass lock ONLY for massive spikes (3x+ the target)
        const spikeBypassThreshold = requiredChange * 3; // Conservative: 3x target
        const isMassiveSpike = currentChange >= spikeBypassThreshold;

        if (isMassiveSpike) {
          console.log(
            `🚨 MASSIVE SPIKE DETECTED! ${currentChange.toFixed(2)}% (${(currentChange / requiredChange).toFixed(1)}x target) - BYPASSING LOCK for ${alert.symbol}`
          );
          console.log(
            `   Lock was until ${lockUntil.toISOString()} (${minutesRemaining}min remaining)`
          );
          // Don't return false - continue to process alert
        } else {
          console.log(
            `🔒 Alert ${alert._id} for ${alert.symbol} is LOCKED until ${lockUntil.toISOString()} (spike ${currentChange.toFixed(2)}% < ${spikeBypassThreshold.toFixed(2)}% bypass threshold)`
          );
          return false;
        }
      }

      // IMPORTANT: Check price direction based on alert settings
      // 🔥 CRITICAL: Use originalBaselinePrice, NOT alert.baselinePrice
      const direction =
        alert.conditions?.changePercent?.direction || "increase";
      const priceChanged = priceData.price !== originalBaselinePrice;

      console.log(
        `📊 Direction Check: Required=${direction}, Original Baseline=${originalBaselinePrice}, Live=${priceData.price}`
      );

      if (direction === "increase" && priceData.price <= originalBaselinePrice) {
        console.log(
          `❌ Direction: INCREASE - Live price ${priceData.price} <= baseline ${originalBaselinePrice}, skipping alert`
        );
        return false;
      }

      if (direction === "decrease" && priceData.price >= originalBaselinePrice) {
        console.log(
          `❌ Direction: DECREASE - Live price ${priceData.price} >= baseline ${originalBaselinePrice}, skipping alert`
        );
        return false;
      }

      if (!priceChanged) {
        console.log(
          `❌ Price hasn't changed from baseline ${originalBaselinePrice}, skipping alert`
        );
        return false;
      }

      console.log(
        `✅ Direction condition met: ${direction.toUpperCase()} - Price moved from ${originalBaselinePrice
        } to ${priceData.price}`
      );

      const conditions = alert.conditions;
      let conditionsMet = true;

      console.log(`📋 Alert conditions:`, JSON.stringify(conditions, null, 2));

      // Check Min Daily volume condition (required)
      if (conditions.minDaily && (priceData.volume || priceData.volume24h)) {
        const minVolume = parseFloat(conditions.minDaily);
        const actualVolume = parseFloat(
          priceData.volume || priceData.volume24h
        );

        if (actualVolume < minVolume) {
          console.log(
            `❌ Min Daily condition FAILED: ${actualVolume} < ${minVolume}`
          );
          conditionsMet = false;
        } else {
          console.log(
            `✅ Min Daily condition PASSED: ${actualVolume} >= ${minVolume}`
          );
        }
      } else {
        console.log(`⚠️ Min Daily condition not set or volume data missing`);
      }

      // Check Change % condition (required) - Now based on candle timeframe
      if (
        conditionsMet &&
        conditions.changePercent &&
        conditions.changePercent.percentage
      ) {
        const requiredChange = parseFloat(conditions.changePercent.percentage);
        const timeframe = conditions.changePercent.timeframe || "5m";

        console.log(
          `📊 Checking candle change condition: ${requiredChange}% in ${timeframe}`
        );

        // Check if candle meets the change requirement using ORIGINAL baseline price
        if (!originalBaselinePrice || originalBaselinePrice === 0) {
          console.log(
            `❌ Candle Change % condition FAILED: Baseline price is 0 or missing`
          );
          conditionsMet = false;
        } else {
          const candleChangeMet = this.checkCandleChangeCondition(
            alert.symbol,
            timeframe,
            requiredChange,
            originalBaselinePrice  // 🔥 FIX: Use original baseline, not updated one
          );

          if (!candleChangeMet) {
            console.log(
              `❌ Candle Change % condition FAILED: Candle change < ${requiredChange}% in ${timeframe}`
            );
            conditionsMet = false;
          } else {
            console.log(
              `✅ Candle Change % condition PASSED: Candle change >= ${requiredChange}% in ${timeframe}`
            );
          }
        }
      } else {
        console.log(`⚠️ Change % condition not set or data missing`);
      }

      // Check Candle conditions (optional)
      if (
        conditionsMet &&
        conditions.candle &&
        conditions.candle.timeframes &&
        conditions.candle.timeframes.length > 0
      ) {
        // CRITICAL: Initialize/update candle data for all required timeframes before evaluation
        for (const timeframe of conditions.candle.timeframes) {
          await this.updateCandleData(alert.symbol, timeframe, priceData);
        }

        const candleMatch = await this.evaluateCandleConditions(
          conditions.candle,
          priceData,
          alert.symbol
        );
        if (!candleMatch) {
          conditionsMet = false;
        }
      }

      // Check RSI Range conditions (optional)
      if (
        conditionsMet &&
        conditions.rsiRange &&
        conditions.rsiRange.timeframes &&
        conditions.rsiRange.timeframes.length > 0
      ) {
        const rsiMatch = await this.evaluateRSIConditions(
          conditions.rsiRange,
          priceData,
          alert.symbol
        );
        if (rsiMatch === false) {
          // null means data still loading — skip check, don't fail alert
          conditionsMet = false;
        }
      }

      // Check RSI Divergence conditions (optional)
      if (
        conditionsMet &&
        conditions.rsiDivergence &&
        conditions.rsiDivergence.timeframes &&
        conditions.rsiDivergence.timeframes.length > 0
      ) {
        const divMatch = await this.evaluateRSIDivergence(
          conditions.rsiDivergence,
          alert.symbol
        );
        if (!divMatch?.found) {
          // null means data still loading — skip check, don't fail alert
          conditionsMet = false;
        }
      }

      // Check Volume conditions (optional)
      if (
        conditionsMet &&
        conditions.volume &&
        conditions.volume.timeframes &&
        conditions.volume.timeframes.length > 0
      ) {
        const volumeMatch = await this.evaluateVolumeConditions(
          conditions.volume,
          priceData,
          alert.symbol,
          alert
        );
        if (volumeMatch === false) {
          // null means data unavailable — skip check, don't fail alert
          conditionsMet = false;
        }
      }

      // Check MACD conditions (optional)
      if (
        conditionsMet &&
        conditions.macd &&
        conditions.macd.timeframes &&
        conditions.macd.timeframes.length > 0
      ) {
        const macdMatch = await this.evaluateMACDConditions(
          conditions.macd,
          priceData,
          alert.symbol
        );
        if (macdMatch === false || macdMatch === null) {
          conditionsMet = false;
        }
      }

      // Check OPEN INTEREST conditions (optional)
      if (
        conditionsMet &&
        conditions.openInterest &&
        conditions.openInterest.timeframes &&
        conditions.openInterest.timeframes.length > 0
      ) {
        const openInterestMatch = await this.evaluateOpenInterestConditions(
          conditions.openInterest,
          alert,
          priceData
        );
        if (!openInterestMatch) {
          conditionsMet = false;
        }
      }

      if (conditionsMet) {
        console.log(
          `🚨 ALL CONDITIONS MET! Triggering alert for ${alert.symbol}, 🎯 Alert will be triggered with price: ${priceData.price}`
        );


        console.log(`🔄 Calling triggerAlert for ${alert.symbol}...`);
        const triggerResult = await this.triggerAlert(alert, priceData);
        console.log(
          `🔄 triggerAlert result for ${alert.symbol}: ${triggerResult}`
        );
      } else {
        console.log(
          `❌ CONDITIONS NOT MET for ${alert.symbol} - Alert will NOT trigger`
        );
      }

      return conditionsMet;
    } catch (error) {
      console.error(
        `❌ Error checking alert conditions for ${alert.symbol}:`,
        error
      );
      return false;
    }
  }

  async triggerAlert(alert, priceData) {
    try {
      console.log(
        `🚀 Starting triggerAlert for ${alert.symbol} (Alert ID: ${alert._id})`
      );

      // Create unique key for duplicate checking
      // Create more robust alert key with longer time window (5 minutes)
      const alertKey = `${alert._id}_${Math.floor(
        priceData.timestamp / (1 * 60 * 1000)
      )}_${parseFloat(priceData.price).toFixed(8)}`; // 🔥 FIX: Use precise price (8 decimals) instead of Math.floor

      // Check if we already processed this alert recently (prevent spam)
      if (this.processedAlerts.has(alertKey)) {
        console.log(
          `⚠️ Alert ${alert._id} already processed recently (within 5min window), skipping duplicate trigger`
        );
        return false;
      }

      // 🔥 FIX: Check price-based key with precise decimal tracking (not floored)
      // This prevents false duplicates for low-price coins (<$1)
      const priceKey = `${alert._id}_price_${parseFloat(priceData.price).toFixed(8)}`;
      if (this.processedAlerts.has(priceKey)) {
        console.log(
          `⚠️ Alert ${alert._id} already triggered at same price level ($${parseFloat(priceData.price).toFixed(8)}), skipping duplicate`
        );
        return false;
      }

      // Safely get baseline values with proper defaults
      const baselinePrice = parseFloat(alert.baselinePrice) || 0;
      const baselineVolume = parseFloat(alert.baselineVolume) || 0;
      const baselineTimestamp = alert.baselineTimestamp || new Date();
      const livePrice = parseFloat(priceData.price) || 0;

      // Calculate change from baseline with proper NaN handling
      let changeFromBaseline = 0;
      let changeFromBaselinePercent = 0;

      if (baselinePrice > 0 && livePrice > 0) {
        changeFromBaseline = livePrice - baselinePrice;
        changeFromBaselinePercent = (changeFromBaseline / baselinePrice) * 100;

        // Handle NaN or Infinity cases
        if (!isFinite(changeFromBaseline)) changeFromBaseline = 0;
        if (!isFinite(changeFromBaselinePercent)) changeFromBaselinePercent = 0;
      }

      // Determine direction based on price change
      const direction =
        changeFromBaselinePercent > 0
          ? "increase"
          : changeFromBaselinePercent < 0
            ? "decrease"
            : "both";

      // Create alert history entry
      const alertHistory = {
        alertId: alert._id,
        userId: alert.userId,
        symbol: alert.symbol,
        alertConditions: {
          ...alert.conditions,
          changePercent: {
            ...alert.conditions.changePercent,
            direction: direction,
          },
        },
        triggerData: {
          price: parseFloat(priceData.price) || 0,
          priceChange: parseFloat(priceData.priceChange) || 0,
          priceChangePercent: parseFloat(priceData.priceChangePercent) || 0,
          volume24h: parseFloat(priceData.volume || priceData.volume24h) || 0,
          high: parseFloat(priceData.high) || 0,
          low: parseFloat(priceData.low) || 0,
          open: parseFloat(priceData.open) || 0,
          close: parseFloat(priceData.close) || 0,
          timestamp: priceData.timestamp || Date.now(),
        },
        baselineData: {
          baselinePrice: baselinePrice,
          baselineVolume: baselineVolume,
          baselineTimestamp: baselineTimestamp,
          changeFromBaseline: changeFromBaseline,
          changeFromBaselinePercent: changeFromBaselinePercent,
        },
        triggeredAt: new Date(),
        conditions: this.getAlertConditionsText(alert.conditions),
      };

      // Save to AlertHistory
      console.log(`📝 Saving alert history for ${alert.symbol}...`);
      console.log(
        `📝 Alert history data:`,
        JSON.stringify(alertHistory, null, 2)
      );

      // Save alert history (only once per trigger)
      let savedHistory = null;
      try {
        savedHistory = await AlertHistoryService.createAlertHistory(
          alertHistory
        );
        if (!savedHistory || !savedHistory._id) {
          console.error(
            `❌ Failed to save alert history for ${alert.symbol}, savedHistory is invalid`
          );
          return false;
        }
        console.log(`✅ Alert history saved successfully: ${savedHistory._id}`);
        console.log(`✅ Alert history details:`, {
          id: savedHistory._id,
          symbol: savedHistory.symbol,
          price: savedHistory.triggerData.price,
          triggeredAt: savedHistory.triggeredAt,
        });

        // Mark as processed AFTER successful save to prevent duplicates
        this.processedAlerts.add(alertKey);
        console.log(
          `✅ Alert ${alert._id} marked as processed after history save`
        );
      } catch (historyError) {
        console.error(
          `❌ Error saving alert history for ${alert.symbol}:`,
          historyError
        );
        console.error(`❌ History error details:`, historyError.message);
        console.error(`❌ History error stack:`, historyError.stack);
        // Don't mark as processed if save failed - allow retry
        return false;
      }

      // Update alert lock if alert count is set
      let updatedConditions = null;
      if (
        alert.conditions.alertCount &&
        alert.conditions.alertCount.timeframe
      ) {
        updatedConditions = updateAlertLock(alert);

        // Update alert conditions with new lock time and new baseline
        await Alert.findByIdAndUpdate(alert._id, {
          conditions: updatedConditions,
          // Update last triggered info but keep alert active
          lastTriggeredAt: new Date(),
          lastTriggeredPrice: priceData.price,
          lastTriggeredVolume: priceData.volume,
          // Update baseline to current price to prevent re-triggering on same price
          baselinePrice: priceData.price,
          baselineVolume: priceData.volume,
          baselineTimestamp: new Date(),
        });

        console.log(
          `🔒 Alert ${alert._id} for ${alert.symbol} locked until ${updatedConditions.alertCount.lockUntil}`
        );
        console.log(
          `⏰ Next trigger allowed after: ${updatedConditions.alertCount.lockUntil}`
        );
        console.log(`📊 Baseline updated to current price: ${priceData.price}`);
      } else {
        // Update last triggered info and baseline but keep alert active
        await Alert.findByIdAndUpdate(alert._id, {
          lastTriggeredAt: new Date(),
          lastTriggeredPrice: priceData.price,
          lastTriggeredVolume: priceData.volume,
          // Update baseline to current price to prevent re-triggering on same price
          baselinePrice: priceData.price,
          baselineVolume: priceData.volume,
          baselineTimestamp: new Date(),
        });

        console.log(
          `✅ Alert ${alert._id} for ${alert.symbol} updated (no lock period)`
        );
        console.log(`📊 Baseline updated to current price: ${priceData.price}`);
      }

      // CRITICAL: Update the in-memory alert with new baseline
      alert.baselinePrice = priceData.price;
      alert.baselineVolume = priceData.volume;
      alert.baselineTimestamp = new Date();
      alert.lastTriggeredAt = new Date();
      alert.lastTriggeredPrice = priceData.price;
      alert.lastTriggeredVolume = priceData.volume;
      if (updatedConditions) {
        alert.conditions = updatedConditions;
      }
      console.log(
        `🔄 In-memory alert updated with new baseline: ${priceData.price}`
      );

      // Update the alert in activeAlerts map
      const alertsForSymbol = this.activeAlerts.get(alert.symbol);
      if (alertsForSymbol) {
        const alertIndex = alertsForSymbol.findIndex(
          (a) => a._id.toString() === alert._id.toString()
        );
        if (alertIndex !== -1) {
          alertsForSymbol[alertIndex] = alert;
          console.log(
            `🔄 Updated alert in activeAlerts map for ${alert.symbol}`
          );
        }
      }

      // Clean up old processed alerts (keep only last 60 seconds)
      const currentTime = Math.floor(Date.now() / 1000);
      for (const key of this.processedAlerts) {
        const [, timestamp] = key.split("_");
        if (timestamp && currentTime - parseInt(timestamp) > 60) {
          this.processedAlerts.delete(key);
        }
      }

      // Send real-time notification using saved alert history (with _id)
      // Fire and forget - don't block alert processing for notifications
      if (savedHistory) {
        this.sendRealTimeNotification(alert, priceData, savedHistory).catch(
          (error) => {
            console.error(
              `❌ Error sending notification for ${alert.symbol} (non-blocking):`,
              error.message
            );
          }
        );
      } else {
        console.error(
          `❌ Cannot send notification: savedHistory is null for ${alert.symbol}`
        );
      }

      return true;
    } catch (error) {
      console.error(`❌ Error triggering alert for ${alert.symbol}:`, error);
      return false;
    }
  }

  getAlertConditionsText(conditions) {
    const parts = [];

    if (conditions.minDaily) {
      parts.push(`Daily min Volume: ${conditions.minDaily}`);
    }

    if (conditions.changePercent) {
      parts.push(
        `Price Change: ${conditions.changePercent.percentage}% (${conditions.changePercent.timeframe})`
      );
    }

    if (conditions.alertCount) {
      parts.push(`Alert Count: ${conditions.alertCount.timeframe}`);
    }

    if (conditions.candle) {
      parts.push(`Candle: ${conditions.candle.condition}`);
    }

    if (conditions.rsiRange) {
      parts.push(
        `RSI: ${conditions.rsiRange.condition} ${conditions.rsiRange.level}`
      );
    }

    if (conditions.volume) {
      parts.push(`Volume: ${conditions.volume.condition}`);
    }

    if (conditions.openInterest) {
      parts.push(
        `Open Interest: ${conditions.openInterest.direction}${conditions.openInterest.percentage
          ? ` ${conditions.openInterest.percentage}%`
          : ""
        }`
      );
    }

    if (conditions.oiChange) {
      parts.push(
        `OI Change: ${conditions.oiChange.direction} ${conditions.oiChange.value}${conditions.oiChange.type === "PERCENTAGE" ? "%" : " absolute"}`
      );
    }

    if (conditions.cvd) {
      const mode = conditions.cvd.mode || "surge";
      if (mode === "surge") {
        parts.push(
          `CVD Surge: ${conditions.cvd.direction} ${conditions.cvd.value}${conditions.cvd.type === "VALUE" ? " absolute" : "%"}`
        );
      } else if (mode === "absorption") {
        parts.push("CVD: Smart Money Absorption");
      } else {
        parts.push("CVD Divergence");
      }
    }

    return parts.join(", ");
  }

  async sendRealTimeNotification(alert, priceData, alertHistory) {
    try {
      console.log(
        `📢 sendRealTimeNotification called for ${alert.symbol}, alertHistory._id: ${alertHistory._id}`
      );

      const redis = await this.getRedisPublisher();

      // Prepare payload with all required fields for frontend
      const payload = {
        type: "alert_triggered",
        historyId: alertHistory._id?.toString(),
        userId: alert.userId?.toString(),
        symbol: alert.symbol,
        price: parseFloat(priceData.price) || 0,
        priceChangePercent: parseFloat(priceData.priceChangePercent) || 0,
        volume: parseFloat(priceData.volume || priceData.volume24h) || 0,
        triggeredAt:
          alertHistory.triggeredAt?.toISOString() || new Date().toISOString(),
        // Frontend required fields
        targetValue:
          alert.alertConditions?.changePercent?.percentage ||
          alert.conditions?.changePercent?.percentage,
        actualValue: parseFloat(alertHistory.baselineData?.changeFromBaselinePercent) || 0,
        timeframe:
          alert.alertConditions?.changePercent?.timeframe ||
          alert.conditions?.changePercent?.timeframe ||
          "5MIN",
        direction:
          (alert.alertConditions?.changePercent?.direction ||
            alert.conditions?.changePercent?.direction) === "increase"
            ? "increase"
            : "decrease",
        baselinePrice: alertHistory.baselineData?.baselinePrice,
        changeFromBaselinePercent:
          alertHistory.baselineData?.changeFromBaselinePercent,
        triggeredPrice: parseFloat(priceData.price) || 0,
        triggeredChange: parseFloat(priceData.priceChangePercent) || 0,
        triggeredVolume:
          parseFloat(priceData.volume || priceData.volume24h) || 0,
        conditions: alertHistory.conditions,
        alertConditions: alert.alertConditions || alert.conditions,
        triggerData: {
          price: parseFloat(priceData.price) || 0,
          priceChangePercent: parseFloat(priceData.priceChangePercent) || 0,
          volume24h: parseFloat(priceData.volume || priceData.volume24h) || 0,
        },
        baselineData: alertHistory.baselineData,
        divergence: alertHistory.divergence || null,
        // Additional fields for backward compatibility
        alertId: alert._id?.toString(),
        _id: alertHistory._id?.toString(),
        id: alertHistory._id?.toString(),
      };

      // 1) SSE / dashboard ke liye (complete payload)
      await redis.publish("alerts:stream", JSON.stringify(payload));

      // 2) notification worker ke liye (minimal data - worker will fetch from DB)
      const workerPayload = {
        type: "alert_triggered",
        historyId: alertHistory._id?.toString(),
        userId: alert.userId?.toString(),
        symbol: alert.symbol,
        price: parseFloat(priceData.price) || 0,
        priceChangePercent: parseFloat(priceData.priceChangePercent) || 0,
        volume: parseFloat(priceData.volume || priceData.volume24h) || 0,
        triggeredAt:
          alertHistory.triggeredAt?.toISOString() || new Date().toISOString(),
      };
      await redis.publish("notifications:queue", JSON.stringify(workerPayload));

      console.log(`📤 Published alert for ${alert.symbol} to Redis channels`);

      // Also publish to alert:triggers for backward compatibility (complete payload)
      await redis.publish("alert:triggers", JSON.stringify(payload));
    } catch (err) {
      console.error("❌ Error publishing alert notification:", err.message);
    }
  }

  // Fetch full OHLC candles, cached per candle boundary.
  // Divergence needs the real candle wicks (high/low), not just closes — comparing
  // closes only is line-chart divergence and disagrees with what TradingView draws.
  async getHistoricalOHLC(symbol, timeframe, period = 14) {
    const key = `${symbol}_${timeframe}_${period}`;
    const timeframeMs = this.getTimeframeMs(timeframe);
    const currentCandleStart = Math.floor(Date.now() / timeframeMs) * timeframeMs;

    if (!this.rsiDataCache) this.rsiDataCache = new Map();
    let historyEntry = this.rsiDataCache.get(key);

    // Re-fetch klines if: no data, cached entry predates OHLC support, or a new candle started
    const needsFresh =
      !historyEntry ||
      !historyEntry.highs ||
      // Entries cached before CVD landed carry no volume arrays; force one
      // refetch rather than handing CVD undefined until the next candle rolls.
      !historyEntry.volumes ||
      historyEntry.candleStart !== currentCandleStart;

    if (needsFresh) {
      if (Date.now() < this.apiBanUntil) return null; // API banned, skip

      try {
        const binanceInterval = this.getBinanceInterval(timeframe);
        const limit = Math.max(period * 10, 250); // Need enough candles for Wilder's Smoothing
        const response = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`
        );

        if (response.status === 418 || response.status === 429) {
          this.apiBanUntil = Date.now() + 120 * 1000;
          return null;
        }

        if (!response.ok) return null;

        const klines = await response.json();

        historyEntry = {
          closes: klines.map(k => parseFloat(k[4])),
          opens: klines.map(k => parseFloat(k[1])),
          highs: klines.map(k => parseFloat(k[2])),
          lows: klines.map(k => parseFloat(k[3])),
          // Volume delta comes free with this same kline payload: index 5 is the
          // candle's total base volume and index 9 the part bought by takers, so
          // sells are the remainder. CVD needs no extra request of its own.
          volumes: klines.map(k => parseFloat(k[5])),
          takerBuyVolumes: klines.map(k => parseFloat(k[9])),
          openTimes: klines.map(k => k[0]),
          candleStart: currentCandleStart,
          fetchedAt: Date.now(),
        };
        this.rsiDataCache.set(key, historyEntry);
      } catch (err) {
        console.error(`❌ RSI klines fetch failed for ${symbol} ${timeframe}: ${err.message}`);
        if (!historyEntry) return null;
      }
    }

    return historyEntry;
  }

  async getHistoricalCloses(symbol, timeframe, period = 14) {
    const ohlc = await this.getHistoricalOHLC(symbol, timeframe, period);
    return ohlc ? ohlc.closes : null;
  }

  async calculateRSI(symbol, timeframe, period = 14) {
    let closes = await this.getHistoricalCloses(symbol, timeframe, period);

    if (!closes || closes.length < period + 1) return null;

    // 2. Add current live price for real-time RSI (overwrite the forming candle)
    const livePrice = this.livePrices[symbol]?.price;
    let calculationCloses = [...closes];

    if (livePrice && calculationCloses.length > 0) {
      calculationCloses[calculationCloses.length - 1] = parseFloat(livePrice);
    }

    // 3. Calculate RSI locally (Wilder's Smoothing)
    return this.computeRSILocally(calculationCloses, period);
  }

  // Queue RSI history fetch (prevents multiple simultaneous API calls)
  queueRsiHistoryFetch(symbol, timeframe, period) {
    const key = `${symbol}_${timeframe}`;

    // Check if already queued
    const exists = this.rsiQueue.some(item => item.key === key);
    if (exists) {
      console.log(`⏳ RSI fetch already queued for ${key}`);
      return;
    }

    // Limit queue size to prevent memory issues
    if (this.rsiQueue.length >= 2000) {
      console.warn(`⚠️ RSI queue at capacity (2000), dropping fetch for ${symbol} ${timeframe}`);
      return;
    }
    if (this.rsiQueue.length > 500 && this.rsiQueue.length % 100 === 0) {
      console.warn(`⚠️ RSI queue high pressure: ${this.rsiQueue.length} items pending`);
    }

    // Add to queue with timestamp for timeout tracking
    this.rsiQueue.push({
      symbol,
      timeframe,
      period,
      key,
      queuedAt: Date.now()
    });

    console.log(`⏳ Queued RSI fetch for ${key} (queue size: ${this.rsiQueue.length})`);

    // Start processing if not already running
    this.processRsiQueue();
  }

  // Process RSI queue with rate limiting
  async processRsiQueue() {
    if (this.isProcessingRsiQueue) return;
    this.isProcessingRsiQueue = true;

    console.log(`🔄 RSI Queue Started: ${this.rsiQueue.length} items pending...`);

    const maxProcessingTime = 5 * 60 * 1000; // 5 minutes max
    const startTime = Date.now();
    let processedCount = 0;

    while (this.rsiQueue.length > 0) {
      // CRITICAL FIX: Add timeout to prevent infinite processing
      if (Date.now() - startTime > maxProcessingTime) {
        console.log(`⏰ RSI Queue timeout after 5 minutes, stopping processing`);
        break;
      }

      // 1. Check for API ban
      if (Date.now() < this.apiBanUntil) {
        const waitTime = Math.ceil((this.apiBanUntil - Date.now()) / 1000);
        if (waitTime % 10 === 0) {
          console.log(`⛔ API Paused due to 418 Error. Resuming in ${waitTime}s...`);
        }
        await this.delay(2000);
        continue;
      }

      // 2. Get next item and check if it's too old
      const task = this.rsiQueue[0];
      const taskAge = Date.now() - (task.queuedAt || 0);

      // Re-queue tasks older than 10 minutes with fresh timestamp instead of discarding
      if (taskAge > 10 * 60 * 1000) {
        const staleTask = this.rsiQueue.shift();
        staleTask.queuedAt = Date.now();
        this.rsiQueue.push(staleTask);
        console.log(`♻️ Re-queued stale RSI task for ${staleTask.key} (was ${Math.round(taskAge / 1000)}s old)`);
        continue;
      }

      try {
        await this.fetchAndStoreRsiHistory(task.symbol, task.timeframe, task.period);

        // Success: Remove from queue and reset failures
        this.rsiQueue.shift();
        const failureKey = `rsi_failures_${task.key}`;
        if (this.rsiFailures) {
          this.rsiFailures.delete(failureKey);
          this.rsiFailures.delete(`${failureKey}_time`);
        }
        processedCount++;

        // 🛑 SLOW DOWN: 300ms delay between requests
        await this.delay(300);

      } catch (error) {
        if (error.status === 418 || error.status === 429) {
          console.error(`🚨 418/429 ERROR! Pausing queue for 2 minutes.`);
          this.apiBanUntil = Date.now() + 120 * 1000;
        } else {
          // ✅ FIX: Count actual API failures here
          const failureKey = `rsi_failures_${task.key}`;
          if (!this.rsiFailures) this.rsiFailures = new Map();
          const failures = this.rsiFailures.get(failureKey) || 0;
          this.rsiFailures.set(failureKey, failures + 1);
          this.rsiFailures.set(`${failureKey}_time`, Date.now());

          console.error(`❌ RSI fetch failed for ${task.key}: ${error.message} (failure #${failures + 1})`);
          this.rsiQueue.shift();
        }
      }

      // CRITICAL FIX: Limit processing per session to prevent overload
      if (processedCount >= 50) {
        console.log(`🛑 RSI Queue processed 50 items, taking a break...`);
        break;
      }
    }

    this.isProcessingRsiQueue = false;
    console.log(`✅ RSI Queue Processed: ${processedCount} items, ${this.rsiQueue.length} remaining`);

    // CRITICAL FIX: If queue still has items, schedule next processing
    if (this.rsiQueue.length > 0) {
      setTimeout(() => {
        this.processRsiQueue();
      }, 10000); // Resume in 10 seconds
    }
  }

  // Fetch RSI history from Binance API (actual API call)
  async fetchAndStoreRsiHistory(symbol, timeframe, period) {
    const binanceInterval = this.getBinanceInterval(timeframe);
    // Fetch at least 250 candles to allow Wilder's smoothing to converge properly
    const limit = Math.max(period * 10, 250);

    const response = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`
    );

    if (response.status === 418 || response.status === 429) {
      const err = new Error("Rate Limit");
      err.status = response.status;
      throw err;
    }

    if (!response.ok) {
      throw new Error(`API Error ${response.status}`);
    }

    const klines = await response.json();
    const closes = klines.map(k => parseFloat(k[4]));

    // Store in history cache
    const key = `${symbol}_${timeframe}`;
    this.rsiHistory.set(key, closes);

    console.log(`📥 RSI History loaded for ${symbol} ${timeframe}: ${closes.length} candles`);
  }

  // Local RSI calculation (no API calls)
  computeRSILocally(closes, period) {
    if (closes.length < period + 1) return null;

    // Calculate price changes
    const changes = [];
    for (let i = 1; i < closes.length; i++) {
      changes.push(closes[i] - closes[i - 1]);
    }

    // Separate gains and losses
    const gains = changes.map((change) => (change > 0 ? change : 0));
    const losses = changes.map((change) => (change < 0 ? Math.abs(change) : 0));

    // Calculate initial average gain and loss
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 0; i < period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }

    avgGain = avgGain / period;
    avgLoss = avgLoss / period;

    // Calculate RSI using Wilder's smoothing method
    for (let i = period; i < changes.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }

    // Avoid division by zero
    if (avgLoss === 0) {
      return avgGain > 0 ? 100 : 50;
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return rsi;
  }

  // Calculate historical RSI array for divergence detection
  computeRSIArray(closes, period) {
    if (closes.length < period + 1) return [];

    const rsiArray = new Array(closes.length).fill(null);
    const changes = [];
    for (let i = 1; i < closes.length; i++) {
      changes.push(closes[i] - closes[i - 1]);
    }

    const gains = changes.map(change => (change > 0 ? change : 0));
    const losses = changes.map(change => (change < 0 ? Math.abs(change) : 0));

    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 0; i < period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }

    avgGain = avgGain / period;
    avgLoss = avgLoss / period;

    // First RSI value
    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiArray[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

    // Calculate rest of RSI using Wilder's smoothing
    for (let i = period; i < changes.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

      if (avgLoss === 0) {
        rsiArray[i + 1] = 100;
      } else {
        rs = avgGain / avgLoss;
        rsiArray[i + 1] = 100 - 100 / (1 + rs);
      }
    }

    return rsiArray;
  }

  // Detect Swing Highs (peaks) or Swing Lows (valleys)
  // Returns array of objects: { index, value }
  findSwings(data, type, leftBars = 2, rightBars = 2) {
    const swings = [];
    for (let i = leftBars; i < data.length - rightBars; i++) {
      const val = data[i];
      if (val === null || val === undefined) continue;

      let isSwing = true;

      // Ties are allowed on the left and rejected on the right, so a flat
      // bottom/top resolves to its last bar. Requiring a strict extreme on both
      // sides skips these outright — and flat stretches are common, since a quiet
      // market repeats the same close and RSI for several candles in a row. Those
      // skipped lows were the real swings, which left the divergence check pairing
      // up two unrelated points hours apart.
      for (let j = i - leftBars; j < i; j++) {
        const compareVal = data[j];
        if (compareVal === null || compareVal === undefined) {
          isSwing = false;
          break;
        }
        if (type === "high" ? val < compareVal : val > compareVal) {
          isSwing = false;
          break;
        }
      }

      if (isSwing) {
        for (let j = i + 1; j <= i + rightBars; j++) {
          const compareVal = data[j];
          if (compareVal === null || compareVal === undefined) {
            isSwing = false;
            break;
          }
          if (type === "high" ? val <= compareVal : val >= compareVal) {
            isSwing = false;
            break;
          }
        }
      }

      if (isSwing) {
        swings.push({ index: i, value: val });
      }
    }
    return swings;
  }

  // Helper: Delay function
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 🛡️ SAFE RSI GETTER - Uses Queue System to Prevent 418 Ban
  async getRSI(symbol, timeframe, period = 14) {
    const key = `${symbol}_${timeframe}_${period}`;
    const now = Date.now();

    // TTL: half of timeframe or minimum 10s
    const ttl = Math.max(this.getTimeframeMs(timeframe) / 2, 10_000);

    // OPTIMIZATION 1: Check in-memory cache first (fastest - 0.1ms)
    const inMemoryCache = this.rsiData.get(key);
    if (inMemoryCache && now - inMemoryCache.timestamp < ttl) {
      return inMemoryCache;
    }

    // OPTIMIZATION 2: Check Redis cache (fast - 5-10ms)
    try {
      const redis = await this.initRedisClient();
      if (redis) {
        const redisKey = `rsi:${key}`;
        const cachedRSI = await redis.get(redisKey);

        if (cachedRSI) {
          const parsed = JSON.parse(cachedRSI);
          const cacheAge = now - parsed.timestamp;

          // If cache is still valid, use it
          if (cacheAge < ttl) {
            // Update in-memory cache for next time
            this.rsiData.set(key, parsed);
            return parsed;
          }
        }
      }
    } catch (error) {
      // Redis error - fallback to calculation
      console.warn(`⚠️ Redis RSI cache error for ${key}:`, error.message);
    }

    // OPTIMIZATION 3: If cache expired, return stale data immediately and update in background
    if (inMemoryCache) {
      // Return stale data immediately (non-blocking)
      const staleData = inMemoryCache;

      // 🛡️ SAFE UPDATE: Use queue system instead of direct API call
      this.calculateRSI(symbol, timeframe, period)
        .then((rsiValue) => {
          if (rsiValue !== null) {
            const updated = {
              current: rsiValue,
              previous: staleData.current,
              timestamp: Date.now(),
            };

            // Update both caches
            this.rsiData.set(key, updated);

            // Update Redis cache in background
            this.initRedisClient().then((redis) => {
              if (redis) {
                const redisKey = `rsi:${key}`;
                redis
                  .setex(
                    redisKey,
                    Math.floor(ttl / 1000),
                    JSON.stringify(updated)
                  )
                  .catch(() => { }); // Silent fail
              }
            });
          }
        })
        .catch(() => { }); // Silent fail - non-critical

      // Return stale data immediately (no delay)
      return staleData;
    }

    // OPTIMIZATION 4: 🛡️ SAFE FIRST-TIME CALCULATION - Use queue system
    const rsiValue = await this.calculateRSI(symbol, timeframe, period);

    if (rsiValue !== null) {
      const previous = inMemoryCache?.current ?? rsiValue;
      const updated = {
        current: rsiValue,
        previous,
        timestamp: now,
      };

      // Update in-memory cache
      this.rsiData.set(key, updated);

      // Update Redis cache in background (non-blocking)
      this.initRedisClient()
        .then((redis) => {
          if (redis) {
            const redisKey = `rsi:${key}`;
            redis
              .setex(redisKey, Math.floor(ttl / 1000), JSON.stringify(updated))
              .catch(() => { }); // Silent fail
          }
        })
        .catch(() => { });

      return updated;
    }

    return inMemoryCache || null;
  }

  // Technical analysis helper methods
  async evaluateCandleConditions(candleConditions, priceData, symbol = null) {
    const currentPrice = parseFloat(priceData.price || priceData.close);
    const condition = candleConditions.condition;
    const timeframes = candleConditions.timeframes || [];
    const EPSILON = 1.0001; // 0.01% epsilon to avoid float equality issues
    const CANDLE_START_BUFFER_MS = 2000; // Wait 2s after candle starts

    ALERT_VERBOSE_LOGS && console.log(`🕯️ Candle Evaluation: ${condition}, Live Price: ${currentPrice}`);

    switch (condition) {
      case "CANDLE_ABOVE_OPEN":
        if (timeframes.length === 0 || !symbol) {
          console.log(`⚠️ No timeframes selected for candle condition`);
          return false;
        }

        ALERT_VERBOSE_LOGS && console.log(`🔍 CANDLE_ABOVE_OPEN: Checking ${timeframes.length} timeframes for ${symbol}`);

        // 🚀 HYBRID APPROACH: Cache First (FAST) + API/Queue Refresh if Stale (ACCURATE)
        const CACHE_FRESH_TTL = 30000; // Cache is "fresh" for 30 seconds
        const now = Date.now();

        const candlePromises = timeframes.map(async (timeframe, index) => {
          const key = `${symbol}_${timeframe}`;
          const cachedCandle = this.candleCache.get(key);

          // Calculate expected candle start for this timeframe
          const timeframeMs = this.getTimeframeMs(timeframe);
          const expectedCandleStart = this.getExpectedCandleStart(timeframe, now);


          // For D/W timeframes, allow timezone tolerance
          const isLargeTimeframe = ['D', '1D', 'W', '1W', '12HR', '12H', 'M', 'MONTH', 'MONTHLY', '1MONTH'].includes(timeframe.toUpperCase());

          // Check if cache is FRESH and CURRENT
          const cacheIsFresh = cachedCandle &&
            cachedCandle.open !== null &&
            cachedCandle.startTime >= expectedCandleStart - (isLargeTimeframe ? 3600000 : 5000);

          if (cacheIsFresh) {
            // ⚡ FAST PATH: Use cached data
            const priceAboveOpen = currentPrice > (cachedCandle.open * EPSILON);
            ALERT_VERBOSE_LOGS && console.log(`   ⚡ [${timeframe}] CACHE HIT: Open=${cachedCandle.open.toFixed(6)}, Above=${priceAboveOpen ? '✅' : '❌'}`);
            return {
              timeframe,
              success: true,
              open: cachedCandle.open,
              priceAboveOpen,
              source: 'cache'
            };
          }

          // 🔥 FIX 1: Check API ban BEFORE making direct calls (was missing!)
          if (Date.now() < this.candleApiBanUntil) {
            const banRemaining = Math.ceil((this.candleApiBanUntil - Date.now()) / 1000);
            console.log(`   ⛔ [${timeframe}] CANDLE_ABOVE_OPEN: API banned (${banRemaining}s remaining), using queue system`);
            // Use stale cache if available
            if (cachedCandle && cachedCandle.open !== null) {
              const priceAboveOpen = currentPrice > (cachedCandle.open * EPSILON);
              console.log(`   ⚠️ [${timeframe}] Using stale cache during ban: Open=${cachedCandle.open}`);
              return { timeframe, success: true, open: cachedCandle.open, priceAboveOpen, source: 'stale_cache_ban' };
            }
            // 🔥 FIX 2: Queue fetch instead of returning failure
            this.addCandleToQueue(symbol, timeframe);
            console.log(`   ⏳ [${timeframe}] CANDLE_ABOVE_OPEN: Queued fetch, will recheck on next tick`);
            return { timeframe, success: false, error: 'API banned, queued for background fetch' };
          }

          // 🔄 SLOW PATH: Fetch fresh from Binance API
          // Stagger requests to avoid 418
          await new Promise(r => setTimeout(r, index * 30));

          try {
            const binanceInterval = this.getBinanceInterval(timeframe);
            const response = await fetch(
              `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=1`
            );

            if (!response.ok) {
              // 🔥 FIX 1: Set ban if rate limited
              if (response.status === 418 || response.status === 429) {
                console.log(`   🚨 [${timeframe}] CANDLE_ABOVE_OPEN: Rate limited (${response.status}), setting 2min ban`);
                this.candleApiBanUntil = Date.now() + 120 * 1000;
              }
              // If API fails, use stale cache as fallback (if exists)
              if (cachedCandle && cachedCandle.open !== null) {
                const priceAboveOpen = currentPrice > (cachedCandle.open * EPSILON);
                console.log(`   ⚠️ [${timeframe}] API ${response.status}, using stale cache: Open=${cachedCandle.open}`);
                return { timeframe, success: true, open: cachedCandle.open, priceAboveOpen, source: 'stale_cache' };
              }
              // 🔥 FIX 2: Queue fetch instead of permanent failure
              this.addCandleToQueue(symbol, timeframe);
              console.log(`   ⏳ [${timeframe}] CANDLE_ABOVE_OPEN: API failed, queued for background fetch`);
              return { timeframe, success: false, error: `API error ${response.status}, queued` };
            }

            const klines = await response.json();
            if (!klines || klines.length === 0) {
              // 🔥 FIX 2: Queue instead of failure
              this.addCandleToQueue(symbol, timeframe);
              return { timeframe, success: false, error: 'No data, queued' };
            }

            const kline = klines[0];
            const candleOpen = parseFloat(kline[1]);
            const candleStartTime = parseInt(kline[0]);

            // 🔥 FIX 3: Validate API response is for CURRENT candle (not stale previous candle)
            // At candle boundaries, Binance may briefly return the just-completed candle
            const isLargeTF = ['D', '1D', 'W', '1W', '12HR', '12H', 'M', 'MONTH', 'MONTHLY', '1MONTH'].includes(timeframe.toUpperCase());
            const staleTolerance = isLargeTF ? 3600000 : 5000; // 1hr for D/W, 5s for others
            if (candleStartTime < expectedCandleStart - staleTolerance) {
              ALERT_VERBOSE_LOGS && console.log(`   ⚠️ [${timeframe}] CANDLE_ABOVE_OPEN: API returned stale candle (start: ${new Date(candleStartTime).toISOString()}, expected: ${new Date(expectedCandleStart).toISOString()})`);
              // Queue a fresh fetch via the safe queue system
              this.addCandleToQueue(symbol, timeframe);
              // Use stale cache if available, otherwise skip this tick
              if (cachedCandle && cachedCandle.open !== null) {
                const priceAboveOpen = currentPrice > (cachedCandle.open * EPSILON);
                return { timeframe, success: true, open: cachedCandle.open, priceAboveOpen, source: 'stale_api_cache' };
              }
              return { timeframe, success: false, error: 'Stale candle from API, queued refresh' };
            }

            // Cache the fresh candle
            this.candleCache.set(key, {
              open: candleOpen,
              high: parseFloat(kline[2]),
              low: parseFloat(kline[3]),
              close: parseFloat(kline[4]),
              volume: parseFloat(kline[5]),
              startTime: candleStartTime,
              endTime: parseInt(kline[6]),
              isComplete: false,
              fetchedAt: now
            });

            // Check: Current Price > Open Price (with epsilon)
            const priceAboveOpen = currentPrice > (candleOpen * EPSILON);
            console.log(`   🔄 [${timeframe}] API FETCH: Open=${candleOpen.toFixed(6)}, Above=${priceAboveOpen ? '✅' : '❌'}`);

            return {
              timeframe,
              success: true,
              open: candleOpen,
              priceAboveOpen,
              source: 'api'
            };
          } catch (error) {
            // On error, try stale cache
            if (cachedCandle && cachedCandle.open !== null) {
              const priceAboveOpen = currentPrice > (cachedCandle.open * EPSILON);
              console.log(`   ⚠️ [${timeframe}] Error, using stale cache`);
              return { timeframe, success: true, open: cachedCandle.open, priceAboveOpen, source: 'stale_cache' };
            }
            // 🔥 FIX 2: Queue fetch instead of permanent failure
            this.addCandleToQueue(symbol, timeframe);
            console.log(`   ⏳ [${timeframe}] CANDLE_ABOVE_OPEN: Error (${error.message}), queued for background fetch`);
            return { timeframe, success: false, error: error.message + ' (queued)' };
          }
        });

        // Wait for ALL timeframes
        const results = await Promise.all(candlePromises);

        // Check results
        let allPassed = true;
        let failedTimeframe = null;

        for (const result of results) {
          if (!result.success) {
            allPassed = false;
            failedTimeframe = result.timeframe;
            break;
          }
          if (!result.priceAboveOpen) {
            allPassed = false;
            failedTimeframe = result.timeframe;
            break;
          }
        }

        if (allPassed) {
          console.log(`   🎉 ALL ${timeframes.length} timeframes PASSED - CANDLE ABOVE OPEN confirmed!`);
        } else {
          console.log(`   ❌ CANDLE_ABOVE_OPEN FAILED at [${failedTimeframe}]`);
        }

        return allPassed;

      case "HAMMER":
        // Hammer: Bullish reversal pattern
        // Conditions:
        // 1. Open AND Close both in upper 30% of range (both >= 70% from low)
        // 2. Current price should be above open for confirmation
        if (timeframes.length === 0 || !symbol) {
          console.log(`⚠️ No timeframes selected for HAMMER condition`);
          return false;
        }

        console.log(`🔍 Checking HAMMER pattern for ${timeframes.length} timeframes (ALL must pass)`);

        // ✅ PHASE 1: Pre-fetch ALL timeframes first
        let hammerDataReady = true;
        let hammerPendingTFs = [];

        for (const timeframe of timeframes) {
          const candle = this.getCandleDataOrQueue(symbol, timeframe);
          if (!candle || candle.open === null || candle.high === null || candle.low === null) {
            hammerDataReady = false;
            hammerPendingTFs.push(timeframe);
          }
        }

        // ✅ PHASE 2: Wait until ALL data is ready
        if (!hammerDataReady) {
          console.log(`⏳ HAMMER: Waiting for ${hammerPendingTFs.length}/${timeframes.length} timeframes: [${hammerPendingTFs.join(', ')}]`);
          return false;
        }

        // ✅ PHASE 3: All data ready - check conditions
        console.log(`✅ HAMMER: All ${timeframes.length} timeframes data ready, checking pattern...`);

        let allHammersPassed = true;
        const hammerNow = Date.now();

        for (const timeframe of timeframes) {
          const candle = this.candleCache.get(`${symbol}_${timeframe}`);

          // 🔥 CRITICAL FIX: Verify this is the CURRENT candle, not a stale one
          const timeframeMs = this.getTimeframeMs(timeframe);
          const expectedCandleStart = this.getExpectedCandleStart(timeframe, hammerNow);

          if (candle.startTime < expectedCandleStart) {
            console.log(`⚠️ [${timeframe}] HAMMER: STALE candle detected! Forcing refresh...`);
            this.candleCache.delete(`${symbol}_${timeframe}`);
            this.addCandleToQueue(symbol, timeframe);
            return false;
          }

          const open = parseFloat(candle.open);
          const high = parseFloat(candle.high);
          const low = parseFloat(candle.low);
          const close = parseFloat(candle.close || currentPrice);
          const range = high - low;

          if (range === 0) {
            console.log(`   [${timeframe}] Hammer: Range is 0, FAIL`);
            allHammersPassed = false;
            break;
          }

          const openPositionFromLow = (open - low) / range;
          const closePositionFromLow = (close - low) / range;
          const upper30PercentThreshold = 0.7;

          const bothInUpper30 =
            openPositionFromLow >= upper30PercentThreshold &&
            closePositionFromLow >= upper30PercentThreshold;

          const priceConfirmed = currentPrice > open;
          const isHammer = bothInUpper30 && priceConfirmed;

          console.log(`📊 [${timeframe}] HAMMER: O=${open}, H=${high}, L=${low}, C=${close}, Pattern: ${isHammer ? '✅' : '❌'}`);

          if (!isHammer) {
            allHammersPassed = false;
            break;
          }
        }

        if (allHammersPassed) {
          console.log(`🎉 HAMMER pattern PASSED for all ${timeframes.length} timeframes`);
        }
        return allHammersPassed;

      case "INVERTED_HAMMER":
        // Inverted Hammer: Bearish reversal pattern
        // Conditions:
        // 1. Open AND Close both in lower 30% of range (both <= 30% from low)
        if (timeframes.length === 0 || !symbol) {
          console.log(`⚠️ No timeframes selected for INVERTED_HAMMER condition`);
          return false;
        }

        console.log(`🔍 Checking INVERTED_HAMMER pattern for ${timeframes.length} timeframes (ALL must pass)`);

        // ✅ PHASE 1: Pre-fetch ALL timeframes first
        let invHammerDataReady = true;
        let invHammerPendingTFs = [];

        for (const timeframe of timeframes) {
          const candle = this.getCandleDataOrQueue(symbol, timeframe);
          if (!candle || candle.open === null || candle.high === null || candle.low === null) {
            invHammerDataReady = false;
            invHammerPendingTFs.push(timeframe);
          }
        }

        // ✅ PHASE 2: Wait until ALL data is ready
        if (!invHammerDataReady) {
          console.log(`⏳ INVERTED_HAMMER: Waiting for ${invHammerPendingTFs.length}/${timeframes.length} timeframes: [${invHammerPendingTFs.join(', ')}]`);
          return false;
        }

        // ✅ PHASE 3: All data ready - check conditions
        console.log(`✅ INVERTED_HAMMER: All ${timeframes.length} timeframes data ready, checking pattern...`);

        let allInvertedHammersPassed = true;

        for (const timeframe of timeframes) {
          const candle = this.candleCache.get(`${symbol}_${timeframe}`);

          const openInv = parseFloat(candle.open);
          const highInv = parseFloat(candle.high);
          const lowInv = parseFloat(candle.low);
          const closeInv = parseFloat(candle.close || currentPrice);
          const rangeInv = highInv - lowInv;

          if (rangeInv === 0) {
            console.log(`   [${timeframe}] Inverted Hammer: Range is 0, FAIL`);
            allInvertedHammersPassed = false;
            break;
          }

          const openPositionFromLowInv = (openInv - lowInv) / rangeInv;
          const closePositionFromLowInv = (closeInv - lowInv) / rangeInv;
          const lower30PercentThreshold = 0.3;

          const bothInLower30 =
            openPositionFromLowInv <= lower30PercentThreshold &&
            closePositionFromLowInv <= lower30PercentThreshold;

          const priceConfirmedInv = currentPrice < openInv;
          const isInvertedHammer = bothInLower30 && priceConfirmedInv;

          console.log(`📊 [${timeframe}] INV_HAMMER: O=${openInv}, H=${highInv}, L=${lowInv}, C=${closeInv}, Pattern: ${isInvertedHammer ? '✅' : '❌'}`);

          if (!isInvertedHammer) {
            allInvertedHammersPassed = false;
            break;
          }
        }

        if (allInvertedHammersPassed) {
          console.log(`🎉 INVERTED_HAMMER pattern PASSED for all ${timeframes.length} timeframes`);
        }
        return allInvertedHammersPassed;

      default:
        console.log(`   Unknown candle condition: ${condition}`);
        return true;
    }
  }

  // RSI Divergence — mirrors TradingView's built-in "Divergence Indicator":
  // pivots are detected on the RSI oscillator, and price is compared using the
  // candle LOW (bullish) / HIGH (bearish) at those pivot bars — real OHLC wicks,
  // not closing prices.
  // The dropdown stores one of three trigger modes. Older alerts were written by
  // a two-option dropdown that stored "condition1"/"condition2"/"" — both of those
  // evaluated the just-closed candle, which is exactly what "previous" does, so
  // they map there and keep behaving the way they always did.
  resolveDivergenceTriggerMode(raw) {
    return ["independent", "previous", "conditional"].includes(raw) ? raw : "previous";
  }

  async evaluateRSIDivergence(condition, symbol, rsiPeriod = 14, triggerMode = "previous") {
    if (!condition || !condition.timeframes || condition.timeframes.length === 0) return { found: false };

    // Client-requested: for these two coins only, print WHY every rejected
    // candidate was rejected — proof the filtering is deliberate, not a bug.
    // Logging only; no threshold or control flow below is touched by this flag.
    const isDiagSymbol = symbol === "BTCUSDT" || symbol === "ETHUSDT" || symbol === "XAUTUSDT";

    // Every mode evaluates on CLOSED candles, Conditional included: the client's
    // rule is "candle close hui, agar us pe div hai to block" — a divergence only
    // counts once the bar it formed on has actually closed. Conditional used to
    // read the still-forming candle, which let it veto on a shape the bar never
    // closed with.
    //
    // Independent and Conditional both hold back one further bar, which then
    // has to confirm the signal rather than contribute to it — the client asked
    // for Conditional to use the same logic as Independent end to end, with
    // only the outcome inverted (Independent fires on a divergence, Conditional
    // blocks on one). Detection is now identical between them.
    //
    // (The live-candle branch below is now unreachable. Left in place rather than
    // ripped out, to keep this change to the behaviour being fixed.)
    const useLiveCandle = false;
    const CONFIRM_BARS =
      triggerMode === "independent" || triggerMode === "conditional" ? 1 : 0;

    // If no specific divergence type is selected, return false
    if (!condition.bullish && !condition.bullishHidden && !condition.bearish && !condition.bearishHidden) {
      return { found: false };
    }

    // Point A is a fully confirmed past pivot — 5 bars clear on both sides, so it
    // is a solid, already-settled swing that a trader would anchor a line to.
    const LB_LEFT = 5;
    const LB_RIGHT_ANCHOR = 5;
    // Hidden Bearish anchors specifically need a wider lookback: with only 5
    // bars clear on each side, a small bump inside a chop range can qualify as
    // a "swing high" even though it isn't the peak a trader would actually draw
    // a line from. Regular Bearish is untouched — its own RSI-zone/ATR/line
    // gates already filter out weak setups without this.
    const LB_LEFT_HIDDEN_BEARISH = 8;

    // Point B is the candle that just closed. Requiring B to also be a confirmed
    // pivot meant waiting several candles into the future before the divergence
    // could be reported, which put the alert well past the point it was tradeable
    // (20 hours on 4HR). Measuring the just-closed candle against the settled
    // anchor keeps the span wide while removing that wait entirely.
    // How far back the anchor may sit, in bars. This ran as two tiers (10-30 on
    // charts up to 1h, 14-60 above) until the client asked for one window across
    // every timeframe, so the tiering and its interval lookup are gone.
    const RANGE_LOWER = 14; // Min bars between anchor and current candle
    const RANGE_UPPER = 90; // Max bars between anchor and current candle

    // Quality gates. All three are on, but the ATR bar and the regular-divergence
    // RSI zone sit at deliberately loose settings: strict values cut volume to a
    // level the client considered too quiet, while removing the gates entirely
    // let through signals whose line could not be drawn at all.
    //   ENABLE_ATR_FILTER  — legs must separate by >= MIN_MOVE_ATR candle ranges
    //   ENABLE_RSI_ZONE    — regular divergences confined to oversold/overbought
    //   ENABLE_LINE_CHECK  — no intermediate candle may pierce the drawn line
    const ENABLE_ATR_FILTER = true;
    const ENABLE_RSI_ZONE = true;
    const ENABLE_LINE_CHECK = true;

    // Strict noise filters so the divergence is clearly visible on the chart
    const MIN_RSI_DIFF = 3;           // RSI points between the two points
    // Measured in the symbol's own typical candle range rather than a flat
    // percentage. A fixed 0.3% is a different demand on every coin: BTC's candles
    // run 3-3.6x smaller than the median liquid pair, so the flat bar quietly made
    // this an altcoin-only filter and BTC-class coins produced no signals at all.
    const MIN_MOVE_ATR = 0.5;         // legs must separate by >= half a typical candle
    const FALLBACK_PRICE_DIFF_PCT = 0.3; // used only if ATR cannot be computed
    // Floor under the relative test. On a pegged pair every candle is minute, so a
    // move of one "typical candle" can still be 0.004% — real by the symbol's own
    // yardstick, meaningless to trade. Sits well below one ATR on the calmest real
    // coin (BTC runs ~0.10% on 5m), so it only removes pegged pairs.
    const ABSOLUTE_MIN_PRICE_PCT = 0.05;
    const MIN_STRENGTH = 4;           // RSI points x price %

    // A divergence is only real if the line a trader draws survives every bar
    // between the two points. Tiny tolerance so one noisy wick does not void
    // an otherwise clean line.
    const LINE_PRICE_TOL = 0.0002;    // 0.02% of price
    const LINE_RSI_TOL = 0.5;         // RSI points

    // Where the current candle must sit on RSI for the signal to be worth acting
    // on. Regular divergences call a reversal, so they stay near the extremes.
    // Hidden divergences call a continuation — they form on a pullback inside a
    // trend and live mid-range, so judging them by the reversal zone threw away
    // 98% of them and is why no hidden alert ever fired.
    const REGULAR_BULLISH_RSI = 50;   // regular bullish: current candle at or below
    const REGULAR_BEARISH_RSI = 60;   // regular bearish: current candle at or above
    const HIDDEN_BULLISH_RSI = 60;    // hidden bullish: current candle at or below
    const HIDDEN_BEARISH_RSI = 40;    // hidden bearish: current candle at or above

    for (const timeframe of condition.timeframes) {
      const ohlc = await this.getHistoricalOHLC(symbol, timeframe, rsiPeriod);
      if (!ohlc || !ohlc.closes || !ohlc.opens || !ohlc.highs || !ohlc.lows) continue;

      const closes = [...ohlc.closes];
      const opens = [...ohlc.opens];
      const highs = [...ohlc.highs];
      const lows = [...ohlc.lows];
      const openTimes = ohlc.openTimes || [];

      if (!useLiveCandle) {
        // Drop the still-forming candle so signals only fire on a closed bar
        closes.pop();
        opens.pop();
        highs.pop();
        lows.pop();
      } else {
        // Fold the live price into the forming candle (extends the wick if needed)
        const livePrice = parseFloat(this.livePrices[symbol]?.price);
        const last = closes.length - 1;
        if (livePrice && last >= 0) {
          closes[last] = livePrice;
          highs[last] = Math.max(highs[last], livePrice);
          lows[last] = Math.min(lows[last], livePrice);
        }
      }

      if (closes.length < rsiPeriod + LB_LEFT + LB_RIGHT_ANCHOR + RANGE_LOWER + 1 + CONFIRM_BARS) continue;

      const rsiArray = this.computeRSIArray(closes, rsiPeriod);
      if (!rsiArray || rsiArray.length === 0) continue;

      // In Independent Trigger mode the newest closed candle is the confirmation
      // bar, so the divergence itself is measured on the one before it.
      const lastIndex = closes.length - 1 - CONFIRM_BARS;
      if (lastIndex < 0) continue;

      // Average true range over the last 14 closed bars, as a % of price. This is
      // the yardstick the price move below is measured against.
      const ATR_BARS = 14;
      let atrPct = null;
      if (lastIndex >= ATR_BARS) {
        let sum = 0;
        let usable = true;
        for (let i = lastIndex - ATR_BARS + 1; i <= lastIndex; i++) {
          const prevClose = closes[i - 1];
          if (!isFinite(highs[i]) || !isFinite(lows[i]) || !isFinite(prevClose) || !closes[i]) {
            usable = false;
            break;
          }
          const trueRange = Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - prevClose),
            Math.abs(lows[i] - prevClose)
          );
          sum += trueRange / closes[i];
        }
        if (usable) atrPct = (sum / ATR_BARS) * 100;
      }

      // Point B is the candle that just closed; Point A is a settled pivot behind
      // it. The anchors are scanned newest-first so the line is drawn from the
      // closest qualifying swing, which is the one a trader would pick.
      const evaluate = (pivotsAnchor, priceSeries, checks, isBearishSide = false, strictAnchorIndices = null) => {
        if (!pivotsAnchor.length) return null;

        const p1 = {
          index: lastIndex,
          price: priceSeries[lastIndex],
          rsi: rsiArray[lastIndex],
        };
        if (!isFinite(p1.price) || p1.rsi === null || p1.rsi === undefined) return null;

        // Independent Trigger: the candle that closed after the divergence has to
        // confirm it with momentum — a bullish signal needs that candle to close
        // Green (close > open), a bearish one needs it to close Red (close < open).
        if (CONFIRM_BARS > 0) {
          const confirmOpen = opens[lastIndex + 1];
          const confirmClose = closes[lastIndex + 1];
          if (!isFinite(confirmOpen) || !isFinite(confirmClose)) return null;
          const held = isBearishSide
            ? confirmClose < confirmOpen
            : confirmClose > confirmOpen;
          if (!held) {
            if (isDiagSymbol) {
              console.log(
                `🔬 ${symbol} ${timeframe} signal rejected: confirmation candle did not close ${isBearishSide ? "Red" : "Green"} (open ${confirmOpen}, close ${confirmClose}) — Independent Trigger not confirmed`
              );
            }
            return null;
          }
        }

        // Each type owns its zone, so bail early only when the candle is outside
        // every enabled one — this keeps the cheap rejection that used to happen
        // here before the zone became per-type.
        if (ENABLE_RSI_ZONE && !checks.some((check) => check.enabled && check.zone(p1.rsi))) {
          if (isDiagSymbol) {
            console.log(
              `🔬 ${symbol} ${timeframe} signal rejected: current RSI ${p1.rsi.toFixed(2)} is outside every enabled zone (no anchor was even checked)`
            );
          }
          return null;
        }

        for (let j = pivotsAnchor.length - 1; j >= 0; j--) {
          const anchorPivot = pivotsAnchor[j];
          if (anchorPivot.index >= p1.index) continue;

          const barsBetween = p1.index - anchorPivot.index;
          if (barsBetween < RANGE_LOWER) {
            if (isDiagSymbol) {
              console.log(
                `🔬 ${symbol} ${timeframe} signal rejected: gap is ${barsBetween} bars (below the ${RANGE_LOWER}-${RANGE_UPPER} bar rule)`
              );
            }
            continue;
          }
          if (barsBetween > RANGE_UPPER) {
            if (isDiagSymbol) {
              console.log(
                `🔬 ${symbol} ${timeframe} signal rejected: gap is ${barsBetween} bars (exceeds the ${RANGE_LOWER}-${RANGE_UPPER} bar rule)`
              );
            }
            break; // all further pivots are even older
          }

          const p2 = {
            index: anchorPivot.index,
            price: priceSeries[anchorPivot.index],
            rsi: anchorPivot.value,
          };

          if (!isFinite(p2.price) || p2.rsi === null) continue;

          // Both legs must actually separate — otherwise this is chart noise
          const rsiDiff = Math.abs(p1.rsi - p2.rsi);
          const priceDiffPct = p2.price !== 0 ? Math.abs((p1.price - p2.price) / p2.price) * 100 : 0;

          // Express the move in candles-worth of range so the same threshold means
          // the same thing on a calm major and a jumpy altcoin.
          const hasAtr = atrPct !== null && atrPct > 0;
          const move = hasAtr ? priceDiffPct / atrPct : priceDiffPct;
          const minMove = hasAtr ? MIN_MOVE_ATR : FALLBACK_PRICE_DIFF_PCT;

          if (priceDiffPct < ABSOLUTE_MIN_PRICE_PCT) {
            if (isDiagSymbol) {
              console.log(
                `🔬 ${symbol} ${timeframe} signal rejected (gap ${barsBetween}b): price diff ${priceDiffPct.toFixed(4)}% is below the ${ABSOLUTE_MIN_PRICE_PCT}% absolute floor`
              );
            }
            continue;
          }
          if (rsiDiff < MIN_RSI_DIFF) {
            if (isDiagSymbol) {
              console.log(
                `🔬 ${symbol} ${timeframe} signal rejected (gap ${barsBetween}b): RSI diff ${rsiDiff.toFixed(2)} is below the required ${MIN_RSI_DIFF}`
              );
            }
            continue;
          }
          if (ENABLE_ATR_FILTER && move < minMove) {
            if (isDiagSymbol) {
              console.log(
                `🔬 ${symbol} ${timeframe} signal rejected (gap ${barsBetween}b): price diff failed ${hasAtr ? "ATR filter" : "min-move filter"} — moved ${move.toFixed(2)}${hasAtr ? " ATR" : "%"}, needed ${minMove}${hasAtr ? " ATR" : "%"} (raw price diff ${priceDiffPct.toFixed(3)}%${hasAtr ? `, ATR ${atrPct.toFixed(3)}%` : ""})`
              );
            }
            continue;
          }
          if (rsiDiff * move < MIN_STRENGTH) {
            if (isDiagSymbol) {
              console.log(
                `🔬 ${symbol} ${timeframe} signal rejected (gap ${barsBetween}b): strength ${(rsiDiff * move).toFixed(2)} is below the required ${MIN_STRENGTH} (RSI diff ${rsiDiff.toFixed(2)} x move ${move.toFixed(2)})`
              );
            }
            continue;
          }

          // Point B is the just-closed candle, which may already have bounced off
          // the real extreme. When that happens the definition still passes, but the
          // bar sitting at the true extreme pierces both the price and the RSI line —
          // so nothing is drawable on the chart and the signal looks wrong to anyone
          // checking it. Reject the pair unless both lines survive every bar between.
          const span = p1.index - p2.index;
          let lineIntact = true;
          for (let i = p2.index + 1; i < p1.index; i++) {
            const f = (i - p2.index) / span;
            const priceLine = p2.price + (p1.price - p2.price) * f;
            const rsiLine = p2.rsi + (p1.rsi - p2.rsi) * f;
            const barPrice = priceSeries[i];
            const barRsi = rsiArray[i];
            if (!isFinite(barPrice) || barRsi === null || barRsi === undefined) continue;

            if (isBearishSide) {
              // Line sits above the highs — nothing may poke through the top
              if (barPrice > priceLine * (1 + LINE_PRICE_TOL) || barRsi > rsiLine + LINE_RSI_TOL) {
                lineIntact = false;
                break;
              }
            } else {
              // Line sits below the lows — nothing may drop through the bottom
              if (barPrice < priceLine * (1 - LINE_PRICE_TOL) || barRsi < rsiLine - LINE_RSI_TOL) {
                lineIntact = false;
                break;
              }
            }
          }
          if (ENABLE_LINE_CHECK && !lineIntact) {
            if (isDiagSymbol) {
              console.log(
                `🔬 ${symbol} ${timeframe} signal rejected (gap ${barsBetween}b): trendline broken by an intermediate candle — not drawable on the chart`
              );
            }
            continue;
          }

          for (const check of checks) {
            if (!check.enabled) continue;
            if (check.requiresStrictAnchor && strictAnchorIndices && !strictAnchorIndices.has(anchorPivot.index)) {
              if (isDiagSymbol) {
                console.log(
                  `🔬 ${symbol} ${timeframe} ${check.type} rejected (gap ${barsBetween}b): anchor is not a wide-enough swing high for Hidden Bearish`
                );
              }
              continue;
            }
            if (ENABLE_RSI_ZONE && !check.zone(p1.rsi)) {
              if (isDiagSymbol) {
                console.log(
                  `🔬 ${symbol} ${timeframe} ${check.type} rejected (gap ${barsBetween}b): current RSI ${p1.rsi.toFixed(2)} is outside the ${check.label} zone`
                );
              }
              continue;
            }
            // p1 = current closed candle, p2 = confirmed anchor pivot
            if (!check.test(p1.price, p2.price, p1.rsi, p2.rsi)) {
              if (isDiagSymbol) {
                console.log(
                  `🔬 ${symbol} ${timeframe} ${check.type} rejected (gap ${barsBetween}b): price/RSI pattern does not match the ${check.label} definition`
                );
              }
              continue;
            }

            return {
              type: check.type,
              isBearish: check.isBearish,
              label: check.label,
              barsBetween,
              pivot1: { price: p1.price, rsi: p1.rsi, time: openTimes[p1.index] || null },
              pivot2: { price: p2.price, rsi: p2.rsi, time: openTimes[p2.index] || null },
            };
          }
        }
        return null;
      };

      let hit = null;

      // Bullish → swing LOWS: RSI pivot lows anchor the swing, price is the candle low there
      if (condition.bullish || condition.bullishHidden) {
        hit = evaluate(
          this.findSwings(rsiArray, "low", LB_LEFT, LB_RIGHT_ANCHOR),
          lows,
          [
            {
              enabled: condition.bullish,
              type: "bullish",
              isBearish: false,
              label: "Regular Bullish Divergence",
              zone: (rsi) => rsi <= REGULAR_BULLISH_RSI,
              // Price Lower Low + RSI Higher Low
              test: (price1, price2, rsi1, rsi2) => price1 < price2 && rsi1 > rsi2,
            },
            {
              enabled: condition.bullishHidden,
              type: "bullishHidden",
              isBearish: false,
              label: "Hidden Bullish Divergence",
              zone: (rsi) => rsi <= HIDDEN_BULLISH_RSI,
              // Price Higher Low + RSI Lower Low
              test: (price1, price2, rsi1, rsi2) => price1 > price2 && rsi1 < rsi2,
            },
          ]
        );
      }

      // Bearish → swing HIGHS: RSI pivot highs anchor the swing, price is the candle high there
      if (!hit && (condition.bearish || condition.bearishHidden)) {
        hit = evaluate(
          this.findSwings(rsiArray, "high", LB_LEFT, LB_RIGHT_ANCHOR),
          highs,
          [
            {
              enabled: condition.bearish,
              type: "bearish",
              isBearish: true,
              label: "Regular Bearish Divergence",
              zone: (rsi) => rsi >= REGULAR_BEARISH_RSI,
              // Price Higher High + RSI Lower High
              test: (price1, price2, rsi1, rsi2) => price1 > price2 && rsi1 < rsi2,
            },
            {
              enabled: condition.bearishHidden,
              type: "bearishHidden",
              isBearish: true,
              label: "Hidden Bearish Divergence",
              zone: (rsi) => rsi >= HIDDEN_BEARISH_RSI,
              requiresStrictAnchor: true,
              // Price Lower High + RSI Higher High
              test: (price1, price2, rsi1, rsi2) => price1 < price2 && rsi1 > rsi2,
            },
          ],
          true,
          new Set(
            this.findSwings(rsiArray, "high", LB_LEFT_HIDDEN_BEARISH, LB_LEFT_HIDDEN_BEARISH).map((a) => a.index)
          )
        );
      }

      if (hit) {
        console.log(
          `🔀 ${hit.label} on ${symbol} ${timeframe} — price ${hit.pivot2.price} → ${hit.pivot1.price}, RSI ${hit.pivot2.rsi.toFixed(2)} → ${hit.pivot1.rsi.toFixed(2)} (${hit.barsBetween} bars apart)`
        );
        return { found: true, timeframe, rsiPeriod, ...hit };
      }
    }

    return { found: false };
  }

  // ================= Conditional Trigger: Divergence Safety Shield =================
  // The exact mirror of the Independent Trigger: same detection, opposite
  // outcome. Independent FIRES an alert when a divergence is found; Conditional
  // VETOES the alert when one is found, and stays out of the way when none is.
  //
  // This delegates to evaluateRSIDivergence rather than detecting anything
  // itself, which is the entire point of the rewrite. The previous version
  // paired two confirmed swings and then ran a separate divergenceMitigationState
  // ledger to decide whether that pivot still counted (block on first re-test,
  // allow afterwards). That is not how the client reads a chart, and it is why
  // blocks landed on candles showing no divergence while candles that plainly
  // had one passed straight through.
  //
  // The client's rule:
  //   price Higher High + RSI Lower High   -> bearish        -> veto
  //   RSI  Higher High + price Lower High  -> hidden bearish -> veto
  //   (inverse on the low side for bullish / hidden bullish)
  //
  // Two details that fall out of reusing the shared detector, rather than
  // needing special handling here:
  //   * "As soon as" price breaks the previous high — the forming candle counts,
  //     not only closed ones. It has to: the % move that would fire the alert is
  //     itself measured live, so waiting for a close would let the alert out the
  //     door before the veto could land. triggerMode "conditional" selects
  //     exactly that (live candle, no confirmation bar).
  //   * "Next candle wont be block because now it will be taking nearest price
  //     high or rsi high" — evaluateRSIDivergence scans anchors newest-first and
  //     draws from the closest qualifying swing, so once a nearer pivot forms it
  //     becomes the reference on its own. No mitigation ledger required.
  //
  // Independent Trigger behaviour is untouched: triggerMode only selects
  // live-candle and confirm-bar handling inside evaluateRSIDivergence, and the
  // "independent" path keeps its own confirmation bar exactly as before.
  async checkDivergenceShield(condition, symbol) {
    const match = await this.evaluateRSIDivergence(condition, symbol, 14, "conditional");

    if (!match || !match.found) return { found: false };

    // A divergence vetoes exactly ONCE. After that its anchor pivot is spent:
    // the client's rule is that the next candle is not blocked, because the
    // reference has moved on to the nearer high. Keyed on the anchor's own
    // timestamp (same shape as the Independent trigger's dedup signature), so
    // a genuinely NEW divergence — different anchor, or a different type on the
    // same anchor — still gets its own single veto.
    //
    // This is needed because a freshly-made high cannot become an anchor until
    // 5 confirming bars have closed after it; without the ledger the same old
    // pivot would keep matching, and keep vetoing, on every candle in between.
    const signature = `${symbol}:${match.timeframe}:${match.type}:${match.pivot2?.time}`;

    this._shieldSpentPivots = this._shieldSpentPivots || new Map();
    if (this._shieldSpentPivots.has(signature)) {
      return { found: false };
    }
    this._shieldSpentPivots.set(signature, Date.now());

    // Bounded: drop anything older than a day once the ledger gets large, so a
    // long-running worker cannot accumulate pivots indefinitely.
    if (this._shieldSpentPivots.size > 5000) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const [k, seenAt] of this._shieldSpentPivots) {
        if (seenAt < cutoff) this._shieldSpentPivots.delete(k);
      }
    }

    return {
      found: true,
      type: match.type,
      label: match.label,
      timeframe: match.timeframe,
      // The anchor pivot: the "previous high/low" the current candle broke.
      // Reported so the veto message names the level actually being tested.
      pivotLine: match.pivot2?.price,
      barsBetween: match.barsBetween,
      pivot1: match.pivot1,
      pivot2: match.pivot2,
    };
  }

  // NOTE: divergenceMitigationState below is no longer reached — the shield no
  // longer uses a mitigation ledger (see above). Left in place rather than
  // deleted to keep this change to the one behaviour being fixed.
  // Decides whether a confirmed divergence still blocks, per the client's rule.
  //
  //   line   = price level of the divergence's STARTING pivot (pivot A)
  //   beyond = above that line for a bearish setup, below it for a bullish one
  //
  //   * price on the safe side of the line       -> allow  (rule 2)
  //   * first push beyond the line since reset   -> BLOCK  (rule 1)
  //   * any later re-cross, already mitigated    -> allow  (rule 3)
  //
  // Crossing is tested on the wick (a touch is a touch), while "came back" is
  // tested on the close, so a single wick poke does not count as a full return.
  divergenceMitigationState(div, bars) {
    const { highs, lows, closes, lastIndex, livePrice } = bars;
    const isHighSide = div.side === "high";
    const line = div.aPrice;

    const beyond = (i) => {
      if (i === lastIndex && isFinite(livePrice)) {
        return isHighSide
          ? Math.max(highs[i], livePrice) >= line
          : Math.min(lows[i], livePrice) <= line;
      }
      return isHighSide ? highs[i] >= line : lows[i] <= line;
    };
    const onSafeSide = (i) => (isHighSide ? closes[i] < line : closes[i] > line);

    // Rule 2 — price is on the safe side of the line, so this divergence has no
    // say at all and the alert must be allowed through.
    if (!beyond(lastIndex)) {
      return { blocks: false, reason: "price on safe side of pivot line — allowed" };
    }

    // The divergence's second pivot is the live candle itself — it is
    // completing on this exact bar. There is no history after B to scan for a
    // pullback-then-reset yet, because B is right now; the general loop below
    // would find nothing after B and misread that as "ran away, mitigated,"
    // which is backwards for a pattern that has not had a chance to be
    // re-tested even once. This IS the first re-test, by construction.
    if (div.B.index === lastIndex) {
      return { blocks: true, reason: "divergence just completed on the live candle — first re-test — blocked" };
    }

    // Price is beyond the line. Whether that blocks depends on whether this is
    // the divergence's first re-test of its own pivot, or a later one.
    //
    // Start from the first bar at or after pivot B that sits on the safe side.
    // For a regular pattern pivot B is itself beyond the line (that is what
    // makes it a higher high), so this skips forward to the pullback; for a
    // hidden pattern pivot B is already on the safe side and this lands on B.
    let resetIdx = -1;
    for (let k = div.B.index; k <= lastIndex; k++) {
      if (onSafeSide(k)) {
        resetIdx = k;
        break;
      }
    }

    // Price never came back to the safe side at all — it ran away from the
    // pivot and never looked back, so the level is long spent. Blocking here is
    // what made a coin that had already tripled stay vetoed forever, which is
    // precisely the failure the client reported.
    if (resetIdx === -1) {
      return { blocks: false, reason: "pivot line left behind — mitigated, allowed" };
    }

    // From that pullback onward, the first bar to push back beyond the line is
    // the one this shield exists to catch.
    let firstCross = -1;
    for (let k = resetIdx + 1; k <= lastIndex; k++) {
      if (beyond(k)) {
        firstCross = k;
        break;
      }
    }

    if (firstCross === -1) {
      return { blocks: false, reason: "price on safe side of pivot line — allowed" };
    }

    // Rule 1 — the re-test is happening on this very bar.
    if (firstCross === lastIndex) {
      return { blocks: true, reason: "first re-test of pivot line — blocked" };
    }

    // Rule 3 — the re-test already happened on an earlier bar, so the level is
    // mitigated and never blocks again.
    return { blocks: false, reason: "pivot line already mitigated — allowed" };
  }

  // ============================ CVD ============================
  // Cumulative Volume Delta. Every kline already carries the two numbers this
  // needs — total base volume and the taker-bought share — so the whole feature
  // rides on the same cached klines RSI/Divergence already fetch. No extra
  // endpoint, no extra polling loop, nothing new against the rate limit.
  //
  //   sellVolume = volume - takerBuyVolume
  //   delta      = takerBuyVolume - sellVolume = 2*takerBuyVolume - volume
  //
  // Nothing in here touches RSI Divergence, OI Change or any other condition —
  // it only reads the shared OHLC cache and keeps its own state.

  resolveCvdTriggerMode(raw) {
    return ["independent", "previous"].includes(raw) ? raw : "previous";
  }

  // Per-candle delta, and the running total measured from a reset anchor.
  // The anchor only bites when it is actually shorter than the candle: asking
  // for a daily reset on a Daily chart would restart the sum every bar and
  // flatten CVD back into raw delta, so those fall through to rolling.
  buildCvdSeries(volumes, takerBuyVolumes, openTimes, resetAnchor, timeframeMs) {
    const deltas = [];
    for (let i = 0; i < volumes.length; i++) {
      const vol = volumes[i];
      const buy = takerBuyVolumes[i];
      deltas.push(isFinite(vol) && isFinite(buy) ? 2 * buy - vol : 0);
    }

    const DAY_MS = 24 * 60 * 60 * 1000;
    const WEEK_MS = 7 * DAY_MS;
    let periodMs = null;
    if (resetAnchor === "daily" && timeframeMs < DAY_MS) periodMs = DAY_MS;
    else if (resetAnchor === "weekly" && timeframeMs < WEEK_MS) periodMs = WEEK_MS;

    const cvd = [];
    let running = 0;
    for (let i = 0; i < deltas.length; i++) {
      if (periodMs && i > 0 && openTimes[i] && openTimes[i - 1]) {
        const curBucket = Math.floor(openTimes[i] / periodMs);
        const prevBucket = Math.floor(openTimes[i - 1] / periodMs);
        if (curBucket !== prevBucket) running = 0; // new session, start over
      }
      running += deltas[i];
      cvd.push(running);
    }

    return { deltas, cvd };
  }

  async evaluateCVDConditions(condition, symbol) {
    if (!condition || !condition.timeframes || condition.timeframes.length === 0) {
      return { found: false };
    }

    const mode = ["surge", "absorption", "divergence"].includes(condition.mode)
      ? condition.mode
      : "surge";
    const resetAnchor = ["daily", "weekly", "rolling"].includes(condition.resetAnchor)
      ? condition.resetAnchor
      : "daily";

    // Same three symbols the divergence diagnostics use, so the client can watch
    // both engines explain themselves side by side on the same coins.
    const isDiagSymbol =
      symbol === "BTCUSDT" || symbol === "ETHUSDT" || symbol === "XAUTUSDT";

    const triggerMode = this.resolveCvdTriggerMode(condition.condition);
    // Independent holds one extra closed bar back to confirm the signal.
    // There is no live-volume feed anywhere in the service, so a "conditional"
    // (forming candle) mode would read a near-empty candle — it is deliberately
    // not offered for CVD.
    const CONFIRM_BARS = mode === "divergence" && triggerMode === "independent" ? 1 : 0;

    for (const timeframe of condition.timeframes) {
      const ohlc = await this.getHistoricalOHLC(symbol, timeframe, 14);
      if (
        !ohlc ||
        !ohlc.closes ||
        !ohlc.opens ||
        !ohlc.highs ||
        !ohlc.lows ||
        !ohlc.volumes ||
        !ohlc.takerBuyVolumes
      ) {
        continue;
      }

      const closes = [...ohlc.closes];
      const opens = [...ohlc.opens];
      const highs = [...ohlc.highs];
      const lows = [...ohlc.lows];
      const volumes = [...ohlc.volumes];
      const takerBuyVolumes = [...ohlc.takerBuyVolumes];
      const openTimes = ohlc.openTimes || [];

      // Always drop the still-forming candle: its volume is only whatever had
      // traded at the instant the klines were fetched, so acting on it would
      // consistently under-read the delta.
      closes.pop();
      opens.pop();
      highs.pop();
      lows.pop();
      volumes.pop();
      takerBuyVolumes.pop();

      if (closes.length < 30) continue;

      const timeframeMs = this.getTimeframeMs(timeframe);
      const { deltas, cvd } = this.buildCvdSeries(
        volumes,
        takerBuyVolumes,
        openTimes,
        resetAnchor,
        timeframeMs
      );

      const lastIndex = closes.length - 1 - CONFIRM_BARS;
      if (lastIndex < 0) continue;

      // ---------------- Mode 1: Delta Surge ----------------
      if (mode === "surge") {
        const hit = this.checkCvdSurge(
          { delta: deltas[lastIndex], volume: volumes[lastIndex] },
          condition,
          symbol,
          timeframe,
          isDiagSymbol
        );
        if (hit) {
          console.log(
            `📊 CVD Surge on ${symbol} ${timeframe} — delta ${hit.delta.toFixed(2)} (${hit.deltaPct.toFixed(2)}% of volume, ${hit.side})`
          );
          return {
            found: true,
            mode,
            timeframe,
            ...hit,
            time: openTimes[lastIndex] || null,
            signature: `${timeframe}:surge:${openTimes[lastIndex]}`,
          };
        }
        continue;
      }

      // ---------------- Mode 2: Smart Money Absorption ----------------
      if (mode === "absorption") {
        const hit = this.checkCvdAbsorption(
          {
            open: opens[lastIndex],
            close: closes[lastIndex],
            delta: deltas[lastIndex],
            volume: volumes[lastIndex],
          },
          condition,
          symbol,
          timeframe,
          isDiagSymbol
        );
        if (hit) {
          console.log(
            `🧊 CVD ${hit.label} on ${symbol} ${timeframe} — ${hit.candleColor} candle with ${hit.delta > 0 ? "positive" : "negative"} delta ${hit.delta.toFixed(2)} (${hit.deltaPct.toFixed(2)}% of volume)`
          );
          return {
            found: true,
            mode,
            timeframe,
            ...hit,
            time: openTimes[lastIndex] || null,
            signature: `${timeframe}:absorption:${hit.type}:${openTimes[lastIndex]}`,
          };
        }
        continue;
      }

      // ---------------- Mode 3: CVD Divergence ----------------
      const hit = this.checkCvdDivergence({
        condition,
        symbol,
        timeframe,
        closes,
        opens,
        highs,
        lows,
        cvd,
        deltas,
        openTimes,
        lastIndex,
        CONFIRM_BARS,
        isDiagSymbol,
      });

      if (hit) {
        console.log(
          `🔷 CVD ${hit.label} on ${symbol} ${timeframe} — price ${hit.pivot2.price} → ${hit.pivot1.price}, CVD ${hit.pivot2.cvd.toFixed(2)} → ${hit.pivot1.cvd.toFixed(2)} (${hit.barsBetween} bars apart)`
        );
        return {
          found: true,
          mode,
          timeframe,
          trigger: triggerMode,
          ...hit,
          // Keyed on the anchor only, so one setup does not re-alert every bar
          // it stays valid — same convention RSI Divergence uses.
          signature: `${timeframe}:cvd:${hit.type}:${hit.pivot2.time}`,
        };
      }
    }

    return { found: false };
  }

  // Delta on a single closed candle, measured against the user's threshold.
  // Percentage mode compares against that same candle's own volume, which keeps
  // one threshold meaningful across coins of wildly different size — the flat-
  // number problem the divergence ATR filter exists to solve.
  checkCvdSurge(candle, condition, symbol, timeframe, isDiagSymbol) {
    const { delta, volume } = candle;
    if (!isFinite(delta) || !isFinite(volume) || volume <= 0) return null;

    const threshold = parseFloat(condition.value);
    if (!isFinite(threshold) || threshold <= 0) return null;

    const useValueMode = condition.type === "VALUE";
    const direction = ["increase", "decrease", "both"].includes(condition.direction)
      ? condition.direction
      : "increase";

    const deltaPct = (delta / volume) * 100;
    const metric = useValueMode ? Math.abs(delta) : Math.abs(deltaPct);

    if (metric < threshold) {
      if (isDiagSymbol) {
        console.log(
          `🔷 ${symbol} ${timeframe} CVD Surge rejected: ${metric.toFixed(2)}${useValueMode ? "" : "%"} is below the ${threshold}${useValueMode ? "" : "%"} threshold`
        );
      }
      return null;
    }

    const side = delta >= 0 ? "buy-dominant" : "sell-dominant";
    if (direction === "increase" && delta <= 0) {
      if (isDiagSymbol) {
        console.log(
          `🔷 ${symbol} ${timeframe} CVD Surge rejected: delta is sell-dominant but the alert asks for buy-dominant`
        );
      }
      return null;
    }
    if (direction === "decrease" && delta >= 0) {
      if (isDiagSymbol) {
        console.log(
          `🔷 ${symbol} ${timeframe} CVD Surge rejected: delta is buy-dominant but the alert asks for sell-dominant`
        );
      }
      return null;
    }

    return {
      type: "surge",
      label: "CVD Surge",
      delta,
      deltaPct,
      volume,
      side,
      threshold,
      thresholdType: useValueMode ? "VALUE" : "PERCENTAGE",
    };
  }

  // Candle direction and delta polarity disagreeing: price closed down while
  // buyers were the aggressors, or closed up while sellers were. The floor stops
  // a delta of near-zero on a doji from reading as absorption.
  checkCvdAbsorption(candle, condition, symbol, timeframe, isDiagSymbol) {
    const { open, close, delta, volume } = candle;
    if (![open, close, delta, volume].every(isFinite) || volume <= 0) return null;

    const MIN_ABSORPTION_PCT = 5; // delta must be >= 5% of the candle's volume

    const wantBullish = condition.bullishAbsorption === true;
    const wantBearish = condition.bearishAbsorption === true;
    if (!wantBullish && !wantBearish) return null;

    const deltaPct = (delta / volume) * 100;
    const isRed = close < open;
    const isGreen = close > open;

    if (Math.abs(deltaPct) < MIN_ABSORPTION_PCT) {
      if (isDiagSymbol) {
        console.log(
          `🔷 ${symbol} ${timeframe} CVD Absorption rejected: delta is only ${deltaPct.toFixed(2)}% of volume (needs ${MIN_ABSORPTION_PCT}%)`
        );
      }
      return null;
    }

    // Red candle but buyers were the aggressors — someone is absorbing the sell-off
    if (wantBullish && isRed && delta > 0) {
      return {
        type: "bullishAbsorption",
        label: "Bullish Absorption",
        isBearish: false,
        candleColor: "red",
        delta,
        deltaPct,
        volume,
        open,
        close,
      };
    }

    // Green candle but sellers were the aggressors — someone is selling into strength
    if (wantBearish && isGreen && delta < 0) {
      return {
        type: "bearishAbsorption",
        label: "Bearish Absorption",
        isBearish: true,
        candleColor: "green",
        delta,
        deltaPct,
        volume,
        open,
        close,
      };
    }

    if (isDiagSymbol) {
      console.log(
        `🔷 ${symbol} ${timeframe} CVD Absorption rejected: ${isRed ? "red" : isGreen ? "green" : "flat"} candle with ${delta > 0 ? "positive" : "negative"} delta does not contradict`
      );
    }
    return null;
  }

  // Price vs the cumulative delta line, run through the same shape of gates the
  // RSI divergence uses — bar-gap window, ATR-normalised price move, and a
  // trendline that no intermediate bar may pierce on either series.
  //
  // CVD is unbounded and its scale is entirely coin-specific, so there is no
  // fixed oversold/overbought zone and no fixed "points" threshold to apply.
  // Both are normalised against the average absolute per-candle delta, which is
  // CVD's own equivalent of ATR.
  checkCvdDivergence(ctx) {
    const {
      condition, symbol, timeframe,
      closes, opens, highs, lows, cvd, deltas, openTimes,
      lastIndex, CONFIRM_BARS, isDiagSymbol,
    } = ctx;

    if (!condition.bullish && !condition.bullishHidden && !condition.bearish && !condition.bearishHidden) {
      return null;
    }

    const LB_LEFT = 5;
    const LB_RIGHT_ANCHOR = 5;
    const RANGE_LOWER = 14;
    const RANGE_UPPER = 90;

    const MIN_CVD_DIFF_CANDLES = 1.0; // pivots must differ by >= 1 typical candle of delta
    const MIN_MOVE_ATR = 0.5;
    const FALLBACK_PRICE_DIFF_PCT = 0.3;
    const ABSOLUTE_MIN_PRICE_PCT = 0.05;
    const MIN_STRENGTH = 1.0; // normalised CVD diff x price move
    const LINE_PRICE_TOL = 0.0002;
    const LINE_CVD_TOL_CANDLES = 0.5; // in units of avg |delta|

    // CVD's yardstick: how big a typical candle's delta is on this pair.
    let avgAbsDelta = 0;
    let counted = 0;
    for (let i = Math.max(0, lastIndex - 99); i <= lastIndex; i++) {
      if (isFinite(deltas[i])) {
        avgAbsDelta += Math.abs(deltas[i]);
        counted++;
      }
    }
    avgAbsDelta = counted > 0 ? avgAbsDelta / counted : 0;
    if (avgAbsDelta <= 0) {
      if (isDiagSymbol) {
        console.log(`🔷 ${symbol} ${timeframe} CVD Divergence rejected: no usable volume delta on this pair`);
      }
      return null;
    }
    const lineCvdTol = LINE_CVD_TOL_CANDLES * avgAbsDelta;

    // Price ATR%, same 14-bar true-range average the RSI divergence uses.
    const ATR_BARS = 14;
    let atrPct = null;
    if (lastIndex >= ATR_BARS) {
      let sum = 0;
      let usable = true;
      for (let i = lastIndex - ATR_BARS + 1; i <= lastIndex; i++) {
        const prevClose = closes[i - 1];
        if (!isFinite(highs[i]) || !isFinite(lows[i]) || !isFinite(prevClose) || !closes[i]) {
          usable = false;
          break;
        }
        sum += Math.max(
          highs[i] - lows[i],
          Math.abs(highs[i] - prevClose),
          Math.abs(lows[i] - prevClose)
        ) / closes[i];
      }
      if (usable) atrPct = (sum / ATR_BARS) * 100;
    }

    const evaluate = (pivotsAnchor, priceSeries, checks, isBearishSide) => {
      if (!pivotsAnchor.length) return null;

      const p1 = {
        index: lastIndex,
        price: priceSeries[lastIndex],
        cvd: cvd[lastIndex],
      };
      if (!isFinite(p1.price) || !isFinite(p1.cvd)) return null;

      // Independent trigger: the bar after the signal has to close in the
      // confirming colour — green under a bullish call, red under a bearish one.
      if (CONFIRM_BARS > 0) {
        const confirmOpen = opens[lastIndex + 1];
        const confirmClose = closes[lastIndex + 1];
        if (!isFinite(confirmOpen) || !isFinite(confirmClose)) return null;
        const held = isBearishSide ? confirmClose < confirmOpen : confirmClose > confirmOpen;
        if (!held) {
          if (isDiagSymbol) {
            console.log(
              `🔷 ${symbol} ${timeframe} CVD Divergence rejected: confirmation candle did not close ${isBearishSide ? "Red" : "Green"} (open ${confirmOpen}, close ${confirmClose})`
            );
          }
          return null;
        }
      }

      for (let j = pivotsAnchor.length - 1; j >= 0; j--) {
        const anchorPivot = pivotsAnchor[j];
        if (anchorPivot.index >= p1.index) continue;

        const barsBetween = p1.index - anchorPivot.index;
        if (barsBetween < RANGE_LOWER) continue;
        if (barsBetween > RANGE_UPPER) break;

        const p2 = {
          index: anchorPivot.index,
          price: priceSeries[anchorPivot.index],
          cvd: anchorPivot.value,
        };
        if (!isFinite(p2.price) || !isFinite(p2.cvd)) continue;

        const cvdDiffCandles = Math.abs(p1.cvd - p2.cvd) / avgAbsDelta;
        const priceDiffPct = p2.price !== 0 ? Math.abs((p1.price - p2.price) / p2.price) * 100 : 0;
        const hasAtr = atrPct !== null && atrPct > 0;
        const move = hasAtr ? priceDiffPct / atrPct : priceDiffPct;
        const minMove = hasAtr ? MIN_MOVE_ATR : FALLBACK_PRICE_DIFF_PCT;

        if (priceDiffPct < ABSOLUTE_MIN_PRICE_PCT) {
          if (isDiagSymbol) {
            console.log(
              `🔷 ${symbol} ${timeframe} CVD Divergence rejected (gap ${barsBetween}b): price diff ${priceDiffPct.toFixed(4)}% is below the ${ABSOLUTE_MIN_PRICE_PCT}% floor`
            );
          }
          continue;
        }
        if (cvdDiffCandles < MIN_CVD_DIFF_CANDLES) {
          if (isDiagSymbol) {
            console.log(
              `🔷 ${symbol} ${timeframe} CVD Divergence rejected (gap ${barsBetween}b): CVD legs differ by only ${cvdDiffCandles.toFixed(2)} typical candles (needs ${MIN_CVD_DIFF_CANDLES})`
            );
          }
          continue;
        }
        if (move < minMove) {
          if (isDiagSymbol) {
            console.log(
              `🔷 ${symbol} ${timeframe} CVD Divergence rejected (gap ${barsBetween}b): price moved ${move.toFixed(2)}${hasAtr ? " ATR" : "%"}, needed ${minMove}`
            );
          }
          continue;
        }
        if (cvdDiffCandles * move < MIN_STRENGTH) {
          if (isDiagSymbol) {
            console.log(
              `🔷 ${symbol} ${timeframe} CVD Divergence rejected (gap ${barsBetween}b): strength ${(cvdDiffCandles * move).toFixed(2)} is below the required ${MIN_STRENGTH}`
            );
          }
          continue;
        }

        // Both lines have to survive every bar in between, or the divergence is
        // not something a trader could actually draw on the chart.
        const span = p1.index - p2.index;
        let lineIntact = true;
        for (let i = p2.index + 1; i < p1.index; i++) {
          const f = (i - p2.index) / span;
          const priceLine = p2.price + (p1.price - p2.price) * f;
          const cvdLine = p2.cvd + (p1.cvd - p2.cvd) * f;
          const barPrice = priceSeries[i];
          const barCvd = cvd[i];
          if (!isFinite(barPrice) || !isFinite(barCvd)) continue;

          if (isBearishSide) {
            if (barPrice > priceLine * (1 + LINE_PRICE_TOL) || barCvd > cvdLine + lineCvdTol) {
              lineIntact = false;
              break;
            }
          } else {
            if (barPrice < priceLine * (1 - LINE_PRICE_TOL) || barCvd < cvdLine - lineCvdTol) {
              lineIntact = false;
              break;
            }
          }
        }
        if (!lineIntact) {
          if (isDiagSymbol) {
            console.log(
              `🔷 ${symbol} ${timeframe} CVD Divergence rejected (gap ${barsBetween}b): trendline broken by an intermediate candle`
            );
          }
          continue;
        }

        for (const check of checks) {
          if (!check.enabled) continue;
          if (!check.test(p1.price, p2.price, p1.cvd, p2.cvd)) continue;

          return {
            type: check.type,
            isBearish: check.isBearish,
            label: check.label,
            barsBetween,
            cvdDiffCandles,
            priceMoveAtr: move,
            pivot1: { price: p1.price, cvd: p1.cvd, time: openTimes[p1.index] || null },
            pivot2: { price: p2.price, cvd: p2.cvd, time: openTimes[p2.index] || null },
          };
        }
      }
      return null;
    };

    let hit = null;

    // Bullish → swing LOWS on the CVD line, price read at the candle low
    if (condition.bullish || condition.bullishHidden) {
      hit = evaluate(
        this.findSwings(cvd, "low", LB_LEFT, LB_RIGHT_ANCHOR),
        lows,
        [
          {
            enabled: condition.bullish,
            type: "bullish",
            isBearish: false,
            label: "Regular Bullish CVD Divergence",
            // Price Lower Low + CVD Higher Low — selling pressure is drying up
            test: (price1, price2, c1, c2) => price1 < price2 && c1 > c2,
          },
          {
            enabled: condition.bullishHidden,
            type: "bullishHidden",
            isBearish: false,
            label: "Hidden Bullish CVD Divergence",
            // Price Higher Low + CVD Lower Low
            test: (price1, price2, c1, c2) => price1 > price2 && c1 < c2,
          },
        ],
        false
      );
    }

    // Bearish → swing HIGHS on the CVD line, price read at the candle high
    if (!hit && (condition.bearish || condition.bearishHidden)) {
      hit = evaluate(
        this.findSwings(cvd, "high", LB_LEFT, LB_RIGHT_ANCHOR),
        highs,
        [
          {
            enabled: condition.bearish,
            type: "bearish",
            isBearish: true,
            label: "Regular Bearish CVD Divergence",
            // Price Higher High + CVD Lower High — the rally is running on less buying
            test: (price1, price2, c1, c2) => price1 > price2 && c1 < c2,
          },
          {
            enabled: condition.bearishHidden,
            type: "bearishHidden",
            isBearish: true,
            label: "Hidden Bearish CVD Divergence",
            // Price Lower High + CVD Higher High
            test: (price1, price2, c1, c2) => price1 < price2 && c1 > c2,
          },
        ],
        true
      );
    }

    return hit;
  }

  async evaluateRSIConditions(rsiConditions, priceData, symbol = null) {
    const { condition, level, period, timeframes } = rsiConditions;
    const targetLevel = parseFloat(level) || 50;
    const rsiPeriod = parseInt(period) || 14;

    ALERT_VERBOSE_LOGS && console.log(
      `📈 RSI Evaluation: ${condition} ${targetLevel} (Period: ${rsiPeriod})`
    );

    // ✅ FIX: Return false if no timeframes (condition cannot be checked)
    if (!timeframes || timeframes.length === 0 || !symbol) {
      console.log(`   ⚠️ No timeframes specified or symbol missing`);
      return false;
    }

    ALERT_VERBOSE_LOGS && console.log(`   🔍 Checking ${timeframes.length} timeframes (ALL must pass)`);

    // ✅ PHASE 1: Pre-fetch ALL timeframes first (like Candle strategy)
    let allDataReady = true;
    let pendingTimeframes = [];
    const rsiValues = new Map();

    for (const timeframe of timeframes) {
      const rsiData = await this.getRSI(symbol, timeframe, rsiPeriod);
      if (!rsiData || rsiData.current === null) {
        allDataReady = false;
        pendingTimeframes.push(timeframe);
      } else {
        rsiValues.set(timeframe, rsiData);
      }
    }

    // ✅ PHASE 2: Wait until ALL data is ready
    if (!allDataReady) {
      console.log(`   ⏳ RSI: Data loading for ${symbol} [${pendingTimeframes.join(', ')}] — skipping RSI check this tick (alert not failed)`);
      return null; // null = data not ready, skip this condition (don't fail the alert)
    }

    // ✅ PHASE 3: All data ready - NOW check conditions
    ALERT_VERBOSE_LOGS && console.log(`   ✅ RSI: All ${timeframes.length} timeframes data ready, checking conditions...`);

    for (const timeframe of timeframes) {
      const rsiData = rsiValues.get(timeframe);
      const currentRSI = rsiData.current;
      const previousRSI = rsiData.previous || currentRSI;

      // Apply condition based on type
      let conditionMet = false;

      switch (condition) {
        case "ABOVE":
          conditionMet = currentRSI > targetLevel;
          console.log(`   📊 [${timeframe}] RSI=${currentRSI.toFixed(2)} > ${targetLevel}? ${conditionMet ? '✅' : '❌'}`);
          break;

        case "BELOW":
          conditionMet = currentRSI < targetLevel;
          console.log(`   📊 [${timeframe}] RSI=${currentRSI.toFixed(2)} < ${targetLevel}? ${conditionMet ? '✅' : '❌'}`);
          break;

        case "CROSSING_UP":
          conditionMet = previousRSI <= targetLevel && currentRSI > targetLevel;
          console.log(`   📊 [${timeframe}] RSI Crossing Up: ${previousRSI.toFixed(2)} → ${currentRSI.toFixed(2)} (level: ${targetLevel})? ${conditionMet ? '✅' : '❌'}`);
          break;

        case "CROSSING_DOWN":
          conditionMet = previousRSI >= targetLevel && currentRSI < targetLevel;
          console.log(`   📊 [${timeframe}] RSI Crossing Down: ${previousRSI.toFixed(2)} → ${currentRSI.toFixed(2)} (level: ${targetLevel})? ${conditionMet ? '✅' : '❌'}`);
          break;

        default:
          console.log(`   ❌ Unknown RSI condition: ${condition}`);
          conditionMet = false;
      }

      // CRITICAL: If even one timeframe fails, return false immediately
      if (!conditionMet) {
        console.log(`   ❌ RSI FAILED: ${timeframe} did not meet condition ${condition}`);
        return false;
      }
    }

    // All timeframes passed
    console.log(`   🎉 RSI: All ${timeframes.length} timeframes PASSED ${condition} ${targetLevel}`);
    return true;
  }

  // ==================== MACD (Fast EMA vs Slow EMA) ====================

  computeEMAArray(values, period) {
    if (!values || values.length < period) return null;
    const multiplier = 2 / (period + 1);
    const emaArray = new Array(values.length).fill(null);

    // SMA for the first valid period
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    emaArray[period - 1] = ema;

    // EMA for the rest of the array
    for (let i = period; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
      emaArray[i] = ema;
    }
    return emaArray;
  }

  computeMACDFromCloses(closes, fastPeriod, slowPeriod, signalPeriod = 9) {
    if (!closes || closes.length < slowPeriod + signalPeriod) return null;

    // 1. Calculate Fast and Slow EMAs for the entire closes array
    const fastEMAs = this.computeEMAArray(closes, fastPeriod);
    const slowEMAs = this.computeEMAArray(closes, slowPeriod);

    if (!fastEMAs || !slowEMAs) return null;

    // 2. Calculate the MACD Line array (Fast EMA - Slow EMA)
    const validMacdValues = [];
    const startIndex = slowPeriod - 1; // Index where slowEMA starts having values

    for (let i = startIndex; i < closes.length; i++) {
      validMacdValues.push(fastEMAs[i] - slowEMAs[i]);
    }

    // 3. Calculate Signal Line (EMA of MACD Line)
    const signalEMAs = this.computeEMAArray(validMacdValues, signalPeriod);

    if (!signalEMAs) return null;

    // 4. Get the current and previous values
    const currentMacdLine = validMacdValues[validMacdValues.length - 1];
    const currentSignalLine = signalEMAs[signalEMAs.length - 1];

    const prevMacdLine = validMacdValues[validMacdValues.length - 2];
    const prevSignalLine = signalEMAs[signalEMAs.length - 2];

    return {
      macdLine: currentMacdLine,
      signalLine: currentSignalLine,
      prevMacdLine: prevMacdLine,
      prevSignalLine: prevSignalLine
    };
  }

  async getMACD(symbol, timeframe, fastPeriod = 12, slowPeriod = 26, currentPrice = null) {
    const key = `${symbol}_${timeframe}_${fastPeriod}_${slowPeriod}`;

    if (!this.macdData) this.macdData = new Map();
    if (!this.macdHistory) this.macdHistory = new Map();

    const cached = this.macdData.get(key);
    const timeframeMs = this.getTimeframeMs(timeframe);

    // Invalidate cache at candle boundaries — MACD crossovers are timing-sensitive
    const currentCandleStart = Math.floor(Date.now() / timeframeMs) * timeframeMs;
    const cacheFromSameCandle = cached && cached.candleStart === currentCandleStart;

    // Short cache TTL: max 5 seconds
    const cacheTTL = 5000;
    if (cached && cacheFromSameCandle && (Date.now() - cached.timestamp) < cacheTTL) {
      return cached;
    }

    // ═══════════════════════════════════════════════════════════════
    // MACD needs FRESH candle data — NOT the stale rsiHistory cache.
    // rsiHistory is fetched once and never refreshed, so after a few
    // candles it becomes stale and EMAs diverge from TradingView.
    // We fetch fresh klines directly and cache per-candle-boundary.
    // ═══════════════════════════════════════════════════════════════
    const historyKey = `${symbol}_${timeframe}`;
    let historyEntry = this.macdHistory.get(historyKey);

    // Re-fetch klines if: no data, or a new candle has started since last fetch
    const needsFresh = !historyEntry || historyEntry.candleStart !== currentCandleStart;

    if (needsFresh) {
      // Check API ban
      if (Date.now() < this.apiBanUntil) return null;

      try {
        const binanceInterval = this.getBinanceInterval(timeframe);
        const limit = Math.max(slowPeriod * 8, 250);
        const response = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`
        );

        if (response.status === 418 || response.status === 429) {
          this.apiBanUntil = Date.now() + 120 * 1000;
          return null;
        }

        if (!response.ok) return null;

        const klines = await response.json();
        const closes = klines.map(k => parseFloat(k[4]));

        historyEntry = {
          closes,
          candleStart: currentCandleStart,
          fetchedAt: Date.now(),
        };
        this.macdHistory.set(historyKey, historyEntry);
      } catch (err) {
        console.error(`❌ MACD klines fetch failed for ${symbol} ${timeframe}: ${err.message}`);
        // Fall back to existing entry if available
        if (!historyEntry) return null;
      }
    }

    let closes = historyEntry.closes;
    const minRequired = Math.max(slowPeriod * 8, 200);
    if (!closes || closes.length < minRequired) return null;

    // ═══════════════════════════════════════════════════════════════
    // FIX: Compute MACD TWO ways:
    //   1. closedResult — from ONLY closed candles (drop the last/forming candle)
    //      Used for CROSSING_UP / CROSSING_DOWN (matches TradingView behavior)
    //   2. liveResult — with live price injected into the forming candle
    //      Used for ABOVE / BELOW (real-time state check)
    //
    // The last kline from Binance is always the still-forming candle.
    // Using it for crossover detection causes phantom crosses when
    // the live price briefly crosses then reverts before candle close.
    // ═══════════════════════════════════════════════════════════════

    // 1. CLOSED-ONLY: exclude the last (forming) candle
    const closedCloses = closes.slice(0, -1);
    const closedResult = this.computeMACDFromCloses(closedCloses, fastPeriod, slowPeriod);

    // 2. WITH LIVE PRICE: replace forming candle close with live price
    let livePrice = currentPrice;
    if (!livePrice && this.livePrices && this.livePrices[symbol]) {
      livePrice = parseFloat(this.livePrices[symbol].price);
    }

    let closesForLive = [...closes];
    if (livePrice && !isNaN(livePrice) && closesForLive.length > 0) {
      closesForLive[closesForLive.length - 1] = livePrice;
    }
    const liveResult = this.computeMACDFromCloses(closesForLive, fastPeriod, slowPeriod);

    if (!closedResult && !liveResult) return null;

    const macdResult = {
      // Live MACD values (for ABOVE/BELOW — includes forming candle with live price)
      macdLine: liveResult ? liveResult.macdLine : (closedResult ? closedResult.macdLine : 0),
      signalLine: liveResult ? liveResult.signalLine : (closedResult ? closedResult.signalLine : 0),
      prevMacdLine: liveResult ? liveResult.prevMacdLine : (closedResult ? closedResult.prevMacdLine : 0),
      prevSignalLine: liveResult ? liveResult.prevSignalLine : (closedResult ? closedResult.prevSignalLine : 0),
      // Closed-candle MACD values (for CROSSING — only uses confirmed closed candles)
      closedMacdLine: closedResult ? closedResult.macdLine : 0,
      closedSignalLine: closedResult ? closedResult.signalLine : 0,
      closedPrevMacdLine: closedResult ? closedResult.prevMacdLine : 0,
      closedPrevSignalLine: closedResult ? closedResult.prevSignalLine : 0,
      candleStart: currentCandleStart,
      timestamp: Date.now(),
    };

    this.macdData.set(key, macdResult);
    return macdResult;
  }

  async evaluateMACDConditions(macdConditions, priceData, symbol = null) {
    const { condition, fastPeriod, slowPeriod, timeframes } = macdConditions;
    const fast = parseInt(fastPeriod) || 12;
    const slow = parseInt(slowPeriod) || 26;

    // Extract current price from priceData for real-time MACD calculation
    const currentPrice = priceData ? parseFloat(priceData.price || priceData.c || 0) : null;

    console.log(`📊 MACD Check: ${symbol} | Condition: ${condition} | Fast: ${fast} | Slow: ${slow} | Price: ${currentPrice}`);
    ALERT_VERBOSE_LOGS && console.log(`   🔍 Checking ${timeframes.length} timeframes (ALL must pass)`);

    let allDataReady = true;
    let pendingTimeframes = [];
    const macdValues = new Map();

    for (const timeframe of timeframes) {
      const macdData = await this.getMACD(symbol, timeframe, fast, slow, currentPrice);
      if (!macdData) {
        allDataReady = false;
        pendingTimeframes.push(timeframe);
      } else {
        macdValues.set(timeframe, macdData);
      }
    }

    if (!allDataReady) {
      console.log(`   ⏳ MACD: Data loading for ${symbol} [${pendingTimeframes.join(', ')}] — skipping this tick`);
      return null;
    }

    for (const timeframe of timeframes) {
      const data = macdValues.get(timeframe);
      // Live values (includes forming candle with live price) — for ABOVE/BELOW
      const { macdLine, signalLine, prevMacdLine, prevSignalLine } = data;
      // Closed-candle values (only confirmed closed candles) — for CROSSING
      const {
        closedMacdLine, closedSignalLine,
        closedPrevMacdLine, closedPrevSignalLine
      } = data;

      let conditionMet = false;

      switch (condition) {
        case "ABOVE":
          // Use LIVE values — real-time check against forming candle
          conditionMet = macdLine > signalLine;
          break;
        case "BELOW":
          // Use LIVE values — real-time check against forming candle
          conditionMet = macdLine < signalLine;
          break;
        case "CROSSING_UP":
          // Use CLOSED-CANDLE values only — crossover must be confirmed
          // by a closed candle, matching TradingView behavior.
          // prev = second-to-last closed candle, current = last closed candle
          conditionMet = closedPrevMacdLine <= closedPrevSignalLine && closedMacdLine > closedSignalLine;
          break;
        case "CROSSING_DOWN":
          // Use CLOSED-CANDLE values only — crossover must be confirmed
          conditionMet = closedPrevMacdLine >= closedPrevSignalLine && closedMacdLine < closedSignalLine;
          break;
        default:
          conditionMet = false;
      }

      const isCrossing = condition === "CROSSING_UP" || condition === "CROSSING_DOWN";
      const displayMacd = isCrossing ? closedMacdLine : macdLine;
      const displaySignal = isCrossing ? closedSignalLine : signalLine;
      console.log(
        `   ${conditionMet ? '✅' : '❌'} [${timeframe}] MACD: ${displayMacd.toFixed(6)} | Signal: ${displaySignal.toFixed(6)} | Condition: ${condition}${isCrossing ? ' (closed-candle)' : ' (live)'}`
      );

      if (!conditionMet) {
        console.log(`   ❌ MACD: Timeframe ${timeframe} FAILED ${condition}`);
        return false;
      }

    }

    console.log(`   🎉 MACD: All ${timeframes.length} timeframes PASSED ${condition}`);
    return true;
  }

  // ==================== END MACD ====================

  async evaluateVolumeConditions(
    volumeConditions,
    priceData,
    symbol = null,
    alert = null
  ) {
    const { condition, percentage, timeframes } = volumeConditions;
    const requiredPercentage = parseFloat(percentage) || 0;

    if (!alert || !symbol) {
      return false;
    }

    if (!timeframes || timeframes.length === 0) {
      return false;
    }

    // 🔥 CORE LOGIC: Only check the SMALLEST timeframe
    // Reason: If 1MIN volume is increasing, then 5MIN/15MIN/1HR automatically include it
    // So checking all timeframes individually is redundant and causes false negatives
    const timeframeOrder = {
      '1MIN': 1, '1M': 1,
      '3MIN': 2, '3M': 2,
      '5MIN': 3, '5M': 3,
      '15MIN': 4, '15M': 4,
      '30MIN': 5, '30M': 5,
      '1HR': 6, '1H': 6,
      '2HR': 7, '2H': 7,
      '4HR': 8, '4H': 8,
      '6HR': 9, '6H': 9,
      '8HR': 10, '8H': 10,
      '12HR': 11, '12H': 11,
      '1D': 12, '1DAY': 12, 'D': 12,
      '1W': 13, '1WEEK': 13, 'W': 13,
      '1MONTH': 14, 'MONTH': 14,
    };

    // Find the smallest timeframe from user's selection
    let smallestTF = timeframes[0];
    let smallestRank = timeframeOrder[timeframes[0].toUpperCase()] || 99;

    for (const tf of timeframes) {
      const rank = timeframeOrder[tf.toUpperCase()] || 99;
      if (rank < smallestRank) {
        smallestRank = rank;
        smallestTF = tf;
      }
    }

    const tf = smallestTF.toUpperCase();
    const binanceInterval = this.getBinanceInterval(tf);

    console.log(
      `📉 Volume Check: ${symbol} | ${condition} ≥ ${requiredPercentage}% | Selected TFs: [${timeframes.join(", ")}] → Checking smallest: [${tf}]`
    );

    let currentCandleVolume = 0;
    let previousCandleVolume = 0;
    let dataSource = "none";

    // Check if we have cached volume comparison data
    const volumeKey = `vol:${symbol}_${tf}`;

    if (this.volumeCompareCache && this.volumeCompareCache.has(volumeKey)) {
      const cached = this.volumeCompareCache.get(volumeKey);
      const timeframeMs = this.getTimeframeMs(tf);
      const currentBoundary = Math.floor(Date.now() / timeframeMs) * timeframeMs;

      // Use cache if it's from the current candle period
      if (cached.boundary === currentBoundary) {
        currentCandleVolume = cached.currentVolume;
        previousCandleVolume = cached.previousVolume;
        dataSource = "cache";
      }
    }

    // If no cached data, fetch from Binance API
    if (dataSource === "none") {
      try {
        // Check for API ban — try stale cache as fallback before skipping
        if (Date.now() < (this.candleApiBanUntil || 0)) {
          const staleCached = this.volumeCompareCache && this.volumeCompareCache.get(volumeKey);
          if (staleCached) {
            console.log(`   📦 [${tf}] API banned — using stale cached volume data`);
            currentCandleVolume = staleCached.currentVolume;
            previousCandleVolume = staleCached.previousVolume;
            dataSource = "stale-cache";
          } else {
            console.log(`   ⛔ [${tf}] API banned and no cache — skipping volume check this tick`);
            return null; // null = skip, don't fail the alert
          }
        }

        if (dataSource === "none") {
          const response = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=2`
          );

          if (response.status === 418 || response.status === 429) {
            this.candleApiBanUntil = Date.now() + 120000;
            // Try stale cache before giving up
            const staleCached = this.volumeCompareCache && this.volumeCompareCache.get(volumeKey);
            if (staleCached) {
              console.log(`   📦 [${tf}] Rate limited — using stale cached volume data`);
              currentCandleVolume = staleCached.currentVolume;
              previousCandleVolume = staleCached.previousVolume;
              dataSource = "stale-cache";
            } else {
              console.warn(`   🚫 [${tf}] Volume API rate limited, no cache — skipping this tick`);
              return null; // null = skip, don't fail the alert
            }
          } else if (!response.ok) {
            console.warn(`   ⚠️ [${tf}] Volume API error: ${response.status} — skipping this tick`);
            return null; // null = skip, don't fail the alert
          } else {
            const klines = await response.json();
            if (klines && klines.length >= 2) {
              // klines[0] = previous completed candle, klines[1] = current ongoing candle
              previousCandleVolume = parseFloat(klines[0][7]); // Quote volume (USDT) of previous candle
              currentCandleVolume = parseFloat(klines[1][7]);   // Quote volume (USDT) of current candle
              dataSource = "api";

              // Cache the result
              if (!this.volumeCompareCache) this.volumeCompareCache = new Map();
              const timeframeMs = this.getTimeframeMs(tf);
              const currentBoundary = Math.floor(Date.now() / timeframeMs) * timeframeMs;
              this.volumeCompareCache.set(volumeKey, {
                currentVolume: currentCandleVolume,
                previousVolume: previousCandleVolume,
                boundary: currentBoundary,
                fetchedAt: Date.now(),
              });
            } else if (klines && klines.length === 1) {
              console.log(`   ⚠️ [${tf}] Only 1 candle available — skipping volume check this tick`);
              return null; // null = skip, don't fail the alert
            }
          }
        }
      } catch (error) {
        // Try stale cache as fallback on any network error
        const staleCached = this.volumeCompareCache && this.volumeCompareCache.get(volumeKey);
        if (staleCached) {
          console.log(`   📦 [${tf}] Fetch error — using stale cached volume data: ${error.message}`);
          currentCandleVolume = staleCached.currentVolume;
          previousCandleVolume = staleCached.previousVolume;
          dataSource = "stale-cache";
        } else {
          console.warn(`   ⚠️ [${tf}] Volume fetch error, no cache — skipping this tick: ${error.message}`);
          return null; // null = skip, don't fail the alert
        }
      }
    }

    // Previous volume is 0 at candle boundaries — skip this tick, don't fail the alert
    if (previousCandleVolume === 0) {
      console.log(`   ⏭️ [${tf}] Previous candle volume=0 (candle boundary) — skipping volume check this tick`);
      return null; // null = skip, don't fail the alert
    }

    // Project current volume to end of candle for fair comparison
    const timeframeMs = this.getTimeframeMs(tf);
    const currentBoundary = Math.floor(Date.now() / timeframeMs) * timeframeMs;
    const elapsedMs = Date.now() - currentBoundary;

    let projectedVolume = currentCandleVolume;
    // Only project if at least 1% of the candle has formed (avoids wild spikes right at the start)
    if (elapsedMs > 0 && (elapsedMs / timeframeMs) > 0.01) {
      projectedVolume = currentCandleVolume * (timeframeMs / Math.min(elapsedMs, timeframeMs));
    }

    // Calculate volume change percentage: projected current candle vs previous candle
    const volumeChangePercent = ((projectedVolume - previousCandleVolume) / previousCandleVolume) * 100;

    // Check condition
    let conditionMet = false;

    switch (condition) {
      case "INCREASING":
        conditionMet = volumeChangePercent >= requiredPercentage;
        break;
      case "DECREASING":
        conditionMet = volumeChangePercent <= -requiredPercentage;
        break;
      case "ABOVE":
        conditionMet = currentCandleVolume > requiredPercentage;
        break;
      case "BELOW":
        conditionMet = currentCandleVolume < requiredPercentage;
        break;
      default:
        conditionMet = false;
    }

    console.log(
      `   ${conditionMet ? '✅' : '❌'} [${tf}] Vol: ${currentCandleVolume.toFixed(0)} (Projected: ${projectedVolume.toFixed(0)}) vs prev: ${previousCandleVolume.toFixed(0)} | Change: ${volumeChangePercent.toFixed(2)}% | Required: ${condition} ${requiredPercentage}% (${dataSource})`
    );

    return conditionMet;
  }

  // ==================== Volume EMA Crossing ====================
  // Alerts when the volume bar crosses above the Volume EMA line
  // Uses same REST API approach as MACD/RSI to avoid drift
  async evaluateVolumeEmaCrossing(volumeEmaConditions, priceData, symbol) {
    const { timeframes, emaPeriod, condition } = volumeEmaConditions;
    const period = parseInt(emaPeriod) || 20;

    if (!symbol || !timeframes || timeframes.length === 0) {
      return false;
    }

    console.log(`📊 Volume EMA Check: ${symbol} | Period: ${period} | Condition: ${condition} | Timeframes: [${timeframes.join(", ")}]`);

    // ALL selected timeframes must pass (same logic as MACD)
    for (const timeframe of timeframes) {
      const result = await this.getVolumeEmaData(symbol, timeframe, period);

      if (!result) {
        console.log(`   ⏳ [${timeframe}] Volume EMA data not ready — skipping`);
        return null; // Data not ready
      }

      const { prevVolume, prevEma, currentVolume, currentEma } = result;

      let crossed = false;
      if (condition === "CROSSING_UP") {
        // Previous volume was below EMA, current volume is above EMA
        crossed = prevVolume < prevEma && currentVolume > currentEma;
      } else if (condition === "CROSSING_DOWN") {
        // Previous volume was above EMA, current volume is below EMA
        crossed = prevVolume > prevEma && currentVolume < currentEma;
      }

      console.log(
        `   ${crossed ? "✅" : "❌"} [${timeframe}] Vol: ${currentVolume.toFixed(2)} | EMA(${period}): ${currentEma.toFixed(2)} | PrevVol: ${prevVolume.toFixed(2)} | PrevEMA: ${prevEma.toFixed(2)} | ${condition}: ${crossed}`
      );

      if (!crossed) {
        return false; // If any timeframe fails, the whole condition fails
      }
    }

    return true; // All timeframes passed
  }

  // Fetch volume data and compute Volume EMA (cached per candle boundary)
  async getVolumeEmaData(symbol, timeframe, emaPeriod) {
    const key = `${symbol}_${timeframe}_volema_${emaPeriod}`;
    const timeframeMs = this.getTimeframeMs(timeframe);
    const currentCandleStart = Math.floor(Date.now() / timeframeMs) * timeframeMs;

    if (!this.volumeEmaCache) this.volumeEmaCache = new Map();
    let cached = this.volumeEmaCache.get(key);

    // Use cache if from the same candle
    if (cached && cached.candleStart === currentCandleStart) {
      return cached;
    }

    // Fetch fresh klines from Binance
    if (Date.now() < this.apiBanUntil) return null;

    try {
      const binanceInterval = this.getBinanceInterval(timeframe);
      const limit = Math.max(emaPeriod * 5, 100); // Need enough for EMA convergence
      const response = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`
      );

      if (response.status === 418 || response.status === 429) {
        this.apiBanUntil = Date.now() + 120 * 1000;
        return null;
      }

      if (!response.ok) return null;

      const klines = await response.json();
      if (!klines || klines.length < emaPeriod + 2) return null;

      // Extract base asset volumes (index [5] in klines)
      const volumes = klines.map((k) => parseFloat(k[5]));

      // Compute EMA of volumes
      const emaArray = this.computeEMAArray(volumes, emaPeriod);
      if (!emaArray) return null;

      // Get current and previous values
      const lastIdx = volumes.length - 1;
      const prevIdx = volumes.length - 2;

      if (emaArray[lastIdx] === null || emaArray[prevIdx] === null) return null;

      const result = {
        currentVolume: volumes[lastIdx],
        currentEma: emaArray[lastIdx],
        prevVolume: volumes[prevIdx],
        prevEma: emaArray[prevIdx],
        candleStart: currentCandleStart,
        timestamp: Date.now(),
      };

      this.volumeEmaCache.set(key, result);
      return result;
    } catch (err) {
      console.error(`❌ Volume EMA klines fetch failed for ${symbol} ${timeframe}: ${err.message}`);
      return null;
    }
  }


  async getUserFavorites(userId) {
    try {
      // First try to get from Redis cache
      const cachedFavorites = await FavoritesCache.getUserFavorites(userId);
      if (cachedFavorites) {
        return cachedFavorites;
      }

      // If not in cache, get from database
      const user = await User.findById(userId).select("favorites").lean();
      if (user && user.favorites) {
        // Cache the result for future use
        await FavoritesCache.setUserFavorites(userId, user.favorites);
        return user.favorites;
      }

      return [];
    } catch (error) {
      console.error(`❌ Error getting favorites for user ${userId}:`, error);
      return [];
    }
  }

  async refreshAlerts() {
    await this.loadAllActiveAlerts();
  }

  // Force refresh alerts when favorites change
  async forceRefreshAlerts() {
    try {
      console.log("🔄 Force refreshing alerts...");
      await this.loadAllActiveAlerts();
      console.log(
        `✅ Refreshed alerts. Active symbols: ${this.activeAlerts.size}`
      );
    } catch (error) {
      console.error("❌ Error refreshing alerts:", error);
    }
  }

  // Remove alerts for a specific symbol and user when it's unfavorited
  async removeAlertsForSymbol(symbol, userId) {
    try {
      console.log(`🗑️ Removing alerts for symbol: ${symbol}, user: ${userId}`);

      // Get current alerts for this symbol
      const symbolAlerts = this.activeAlerts.get(symbol) || [];

      // Filter out alerts for this specific user
      const remainingAlerts = symbolAlerts.filter(
        (alert) => alert.userId.toString() !== userId.toString()
      );

      const removedCount = symbolAlerts.length - remainingAlerts.length;
      console.log(`📊 Removed ${removedCount} alerts for ${symbol} (user: ${userId})`);

      // Update in-memory cache
      if (remainingAlerts.length === 0) {
        // No alerts left for this symbol - remove completely
        this.activeAlerts.delete(symbol);
        console.log(`✅ Removed symbol ${symbol} from activeAlerts (no alerts left)`);

        // Clean up candle data for this symbol
        for (const [key, candle] of this.candleData.entries()) {
          if (key.startsWith(`${symbol}_`)) {
            this.candleData.delete(key);
          }
        }
      } else {
        // Other users still have alerts for this symbol
        this.activeAlerts.set(symbol, remainingAlerts);
        console.log(`✅ Updated ${symbol}: ${remainingAlerts.length} alerts remaining (other users)`);
      }

      // CRITICAL: Update Redis cache
      const redis = await this.initRedisClient();
      if (redis) {
        const cacheKey = `alerts:cache:${symbol}`;

        if (remainingAlerts.length === 0) {
          await redis.del(cacheKey);
          console.log(`✅ Deleted Redis cache for ${symbol}`);
        } else {
          await redis.set(cacheKey, JSON.stringify(remainingAlerts));
          console.log(`✅ Updated Redis cache for ${symbol}`);
        }
      }

      // 🔥 CRITICAL FIX: Update MicroBatchEngine's activeSymbolsSet
      // This ensures the engine stops processing if no alerts remain
      await this.updateMicroBatchActiveSymbols();
      console.log(`✅ MicroBatchEngine activeSymbols updated after removing alerts`);
    } catch (error) {
      console.error(`❌ Error removing alerts for ${symbol}:`, error);
    }
  }

  // Remove alerts for a specific user when they clear all favorites
  async removeAlertsForUser(userId) {
    try {
      console.log(`🗑️ Removing all alerts for user: ${userId}`);
      const symbolsToUpdate = new Set();
      const alertIdsToRemove = new Set();

      // Remove all alerts for this user from active processing
      for (const [symbol, alerts] of this.activeAlerts.entries()) {
        const userAlerts = alerts.filter((alert) => {
          const alertUserId = alert.userId?.toString
            ? alert.userId.toString()
            : alert.userId;
          return alertUserId === userId.toString();
        });

        if (userAlerts.length > 0) {
          // Collect alert IDs to remove
          userAlerts.forEach((alert) => {
            alertIdsToRemove.add(alert._id.toString());
          });

          const remainingAlerts = alerts.filter((alert) => {
            const alertUserId = alert.userId?.toString
              ? alert.userId.toString()
              : alert.userId;
            return alertUserId !== userId.toString();
          });

          if (remainingAlerts.length > 0) {
            this.activeAlerts.set(symbol, [...remainingAlerts]); // Create new array reference
            symbolsToUpdate.add(symbol);
            console.log(`✅ Updated ${symbol}: ${remainingAlerts.length} alerts remaining`);
          } else {
            this.activeAlerts.delete(symbol);
            symbolsToUpdate.add(symbol);
            console.log(`✅ Removed ${symbol}: no alerts remaining`);
          }
        }
      }

      // CRITICAL: Update Redis cache for all affected symbols
      const redis = await this.initRedisClient();
      if (redis && symbolsToUpdate.size > 0) {
        for (const symbol of symbolsToUpdate) {
          const cacheKey = `alerts:cache:${symbol}`;
          const alerts = this.activeAlerts.get(symbol);

          if (!alerts || alerts.length === 0) {
            await redis.del(cacheKey);
          } else {
            await redis.set(cacheKey, JSON.stringify(alerts));
          }
        }
      }

      // 🔥 CRITICAL FIX: Update MicroBatchEngine's activeSymbolsSet
      // This ensures the engine stops processing removed symbols
      await this.updateMicroBatchActiveSymbols();
      console.log(`✅ MicroBatchEngine activeSymbols updated after removing user ${userId} alerts`);
    } catch (error) {
      console.error(`❌ Error removing alerts for user ${userId}:`, error);
    }
  }

  // Add a new alert to active monitoring
  async addAlert(alertId) {
    try {
      console.log(`➕ Adding alert ${alertId} to active monitoring...`);

      const alert = await Alert.findById(alertId).lean();
      if (!alert) {
        console.log(`❌ Alert ${alertId} not found in database`);
        return false;
      }

      if (alert.status !== "active") {
        console.log(
          `❌ Alert ${alertId} is not active (status: ${alert.status})`
        );
        return false;
      }

      // Check if user still has this symbol in favorites
      const userFavorites = await this.getUserFavorites(alert.userId);
      if (!userFavorites || !userFavorites.includes(alert.symbol)) {
        console.log(
          `❌ Alert ${alertId} for ${alert.symbol} not in user favorites`
        );
        return false;
      }

      // Add to active alerts
      const symbol = alert.symbol;
      if (!this.activeAlerts.has(symbol)) {
        this.activeAlerts.set(symbol, []);
      }

      // Check if alert already exists
      const inMemoryAlerts = this.activeAlerts.get(symbol);
      const alertExists = inMemoryAlerts.some(
        (a) => a._id.toString() === alertId
      );

      if (!alertExists) {
        this.activeAlerts.get(symbol).push(alert);
        this.alertIds.add(alertId);

        // CRITICAL: Update Redis cache immediately to include new alert
        const redis = await this.initRedisClient();
        if (redis) {
          const cacheKey = `alerts:cache:${symbol}`;
          const redisAlerts = await this.getAlertsFromCache(symbol);

          // Check if alert already exists in Redis cache
          const existsInRedis = redisAlerts.some(
            (a) => a._id.toString() === alertId
          );

          if (!existsInRedis) {
            // Add new alert to Redis cache
            redisAlerts.push(alert);
            await redis.set(cacheKey, JSON.stringify(redisAlerts));
          }
        }

        // Reset baseline for this alert (new conditions = new baseline)
        const alertKey = `${alertId}_${symbol}`;
        this.alertBaselines.delete(alertKey);

        // 🔥 CRITICAL FIX: Update MicroBatchEngine's activeSymbolsSet
        // This ensures the engine starts processing this new symbol
        await this.updateMicroBatchActiveSymbols();
        console.log(`✅ MicroBatchEngine activeSymbols updated after adding alert ${alertId}`);

        console.log(
          `✅ Alert ${alertId} for ${alert.symbol} added to active monitoring`
        );
        return true;
      } else {
        console.log(
          `⚠️ Alert ${alertId} for ${alert.symbol} already exists in active monitoring`
        );
        return false;
      }
    } catch (error) {
      console.error(`❌ Error adding alert ${alertId}:`, error);
      return false;
    }
  }

  // Remove an alert from active monitoring
  async removeAlert(alertId) {
    try {
      // Find and remove from activeAlerts
      let removed = false;
      let removedSymbol = null;

      for (const [symbol, alerts] of this.activeAlerts.entries()) {
        const alertIndex = alerts.findIndex(
          (a) => a._id.toString() === alertId
        );
        if (alertIndex !== -1) {
          removed = true;
          removedSymbol = symbol;
          break;
        }
      }

      console.log(`🔍 Removing alert ${alertId}, found symbol: ${removedSymbol}`);

      if (!removed || !removedSymbol) {
        // Alert not found in in-memory cache, but still try to remove from Redis
        const redis = await this.initRedisClient();
        if (redis) {
          // Try to find alert in Redis cache by checking all symbols
          // This is a fallback in case alert is only in Redis
          const allSymbols = Array.from(this.activeAlerts.keys());
          for (const symbol of allSymbols) {
            const cacheKey = `alerts:cache:${symbol}`;
            const existingAlerts = await this.getAlertsFromCache(symbol);
            const alertExists = existingAlerts.some(
              (a) => a._id.toString() === alertId
            );

            if (alertExists) {
              const updatedAlerts = existingAlerts.filter(
                (a) => a._id.toString() !== alertId
              );

              if (updatedAlerts.length === 0) {
                await redis.del(cacheKey);
                this.activeAlerts.delete(symbol);
              } else {
                await redis.set(cacheKey, JSON.stringify(updatedAlerts));
                this.activeAlerts.set(symbol, updatedAlerts);
              }
              removed = true;
              removedSymbol = symbol;
              break;
            }
          }
        }
      }

      // Remove from alertIds set
      this.alertIds.delete(alertId);

      // CRITICAL: Clean up processedAlerts Set (remove entries for this alert)
      for (const key of this.processedAlerts) {
        if (key.startsWith(`${alertId}_`)) {
          this.processedAlerts.delete(key);
        }
      }

      // Clean up baseline data for this alert
      for (const [key] of this.alertBaselines.entries()) {
        if (key.startsWith(`${alertId}_`)) {
          this.alertBaselines.delete(key);
        }
      }

      // Clean up candle data for this alert's symbol (only if no other alerts for this symbol)
      if (removedSymbol) {
        const remainingAlertsForSymbol = this.activeAlerts.get(removedSymbol);
        if (
          !remainingAlertsForSymbol ||
          remainingAlertsForSymbol.length === 0
        ) {
          // No alerts left for this symbol, clean up all data
          for (const [key] of this.candleData.entries()) {
            if (key.startsWith(`${removedSymbol}_`)) {
              this.candleData.delete(key);
            }
          }

          // Clean up RSI data for this symbol
          for (const [key] of this.rsiData.entries()) {
            if (key.startsWith(`${removedSymbol}_`)) {
              this.rsiData.delete(key);
            }
          }

          // Clean up open interest data for this symbol
          for (const [key] of this.openInterestData.entries()) {
            if (key.startsWith(`${removedSymbol}_`)) {
              this.openInterestData.delete(key);
            }
          }
        }

        // CRITICAL: Update Redis cache immediately to remove the alert
        const redis = await this.initRedisClient();
        if (redis && removedSymbol) {
          const cacheKey = `alerts:cache:${removedSymbol}`;
          const existingAlerts = await this.getAlertsFromCache(removedSymbol);

          // Filter out the removed alert
          const updatedAlerts = existingAlerts.filter(
            (a) => a._id.toString() !== alertId
          );

          // Update Redis cache
          if (updatedAlerts.length === 0) {
            // If no alerts left, delete the cache key
            await redis.del(cacheKey);
            // CRITICAL: Also remove from in-memory cache
            this.activeAlerts.delete(removedSymbol);
            console.log(`✅ Removed symbol ${removedSymbol} from activeAlerts (no alerts left)`);
          } else {
            // Update with remaining alerts
            await redis.set(cacheKey, JSON.stringify(updatedAlerts));
            // CRITICAL: Update in-memory cache with new array (not modify in place)
            this.activeAlerts.set(removedSymbol, [...updatedAlerts]);
            console.log(`✅ Updated symbol ${removedSymbol} in activeAlerts (${updatedAlerts.length} alerts remaining)`);
          }
        } else if (removedSymbol) {
          // If Redis is not available, still update in-memory cache
          const alerts = this.activeAlerts.get(removedSymbol);
          if (alerts) {
            const updatedAlerts = alerts.filter(
              (a) => a._id.toString() !== alertId
            );
            if (updatedAlerts.length === 0) {
              this.activeAlerts.delete(removedSymbol);
              console.log(`✅ Removed symbol ${removedSymbol} from activeAlerts (no Redis, no alerts left)`);
            } else {
              // Create new array to ensure reference is updated
              this.activeAlerts.set(removedSymbol, [...updatedAlerts]);
              console.log(`✅ Updated symbol ${removedSymbol} in activeAlerts (no Redis, ${updatedAlerts.length} alerts remaining)`);
            }
          }
        }

        // 🔥 CRITICAL FIX: Update MicroBatchEngine's activeSymbolsSet
        // This ensures the engine stops processing removed symbols
        await this.updateMicroBatchActiveSymbols();
        console.log(`✅ MicroBatchEngine activeSymbols updated after removing alert ${alertId}`);
      }

      // CRITICAL: Update micro-batch engine active symbols after removal
      if (removed && this.microBatchEngine) {
        await this.updateMicroBatchActiveSymbols();
      }

      console.log(
        `✅ Alert ${alertId} removed from all caches${removed ? "" : " (not found in cache)"
        }`
      );
      return removed;
    } catch (error) {
      console.error(`❌ Error removing alert ${alertId}:`, error);
      return false;
    }
  }

  // Check if an alert is currently being monitored
  isAlertActive(alertId) {
    return this.alertIds.has(alertId);
  }

  // Get count of active alerts
  getActiveAlertCount() {
    return this.alertIds.size;
  }

  // Get count of alerts per symbol
  getAlertsBySymbol() {
    const result = {};
    for (const [symbol, alerts] of this.activeAlerts.entries()) {
      result[symbol] = alerts.length;
    }
    return result;
  }

  // Force reset baseline for a specific alert (when conditions change)
  resetAlertBaseline(alertId, symbol) {
    const alertKey = `${alertId}_${symbol}`;
    this.alertBaselines.delete(alertKey);
    console.log(`🔄 Force reset baseline for alert ${alertId} (${symbol})`);
  }

  // Force reset all baselines (when system restarts or conditions change globally)
  resetAllBaselines() {
    this.alertBaselines.clear();
    this.candleData.clear();
    console.log(`🔄 Reset all alert baselines and candle data`);
  }

  // Convert timeframe string to milliseconds
  getTimeframeMs(timeframe) {
    if (!timeframe) return 5 * 60 * 1000; // Default to 5 minutes

    // Normalize timeframe (uppercase for consistency)
    const normalized = timeframe.toUpperCase();

    const timeframes = {
      "1M": 1 * 60 * 1000, // 1 minute
      "1MIN": 1 * 60 * 1000, // 1 minute
      "2M": 2 * 60 * 1000, // 2 minutes
      "2MIN": 2 * 60 * 1000, // 2 minutes
      "3M": 3 * 60 * 1000, // 3 minutes
      "3MIN": 3 * 60 * 1000, // 3 minutes
      "5M": 5 * 60 * 1000, // 5 minutes
      "5MIN": 5 * 60 * 1000, // 5 minutes (uppercase format)
      "10M": 10 * 60 * 1000, // 10 minutes
      "10MIN": 10 * 60 * 1000, // 10 minutes
      "15M": 15 * 60 * 1000, // 15 minutes
      "15MIN": 15 * 60 * 1000, // 15 minutes
      "30M": 30 * 60 * 1000, // 30 minutes
      "30MIN": 30 * 60 * 1000, // 30 minutes
      "1H": 60 * 60 * 1000, // 1 hour
      "1HR": 60 * 60 * 1000, // 1 hour
      "2H": 2 * 60 * 60 * 1000, // 2 hours
      "2HR": 2 * 60 * 60 * 1000, // 2 hours
      "4H": 4 * 60 * 60 * 1000, // 4 hours
      "4HR": 4 * 60 * 60 * 1000, // 4 hours
      "6H": 6 * 60 * 60 * 1000, // 6 hours
      "6HR": 6 * 60 * 60 * 1000, // 6 hours
      "8H": 8 * 60 * 60 * 1000, // 8 hours
      "8HR": 8 * 60 * 60 * 1000, // 8 hours
      "12H": 12 * 60 * 60 * 1000, // 12 hours
      "12HR": 12 * 60 * 60 * 1000, // 12 hours
      "1D": 24 * 60 * 60 * 1000, // 1 day
      "1DAY": 24 * 60 * 60 * 1000, // 1 day
      "D": 24 * 60 * 60 * 1000, // 1 day (short format)
      "DAY": 24 * 60 * 60 * 1000, // 1 day
      "DAILY": 24 * 60 * 60 * 1000, // 1 day
      "1W": 7 * 24 * 60 * 60 * 1000, // 1 week
      "W": 7 * 24 * 60 * 60 * 1000, // 1 week (short format)
      "WEEK": 7 * 24 * 60 * 60 * 1000, // 1 week
      "WEEKLY": 7 * 24 * 60 * 60 * 1000, // 1 week
      "1MONTH": 30 * 24 * 60 * 60 * 1000, // 1 month (approx)
      "M": 30 * 24 * 60 * 60 * 1000, // 1 month (short - be careful, conflicts with minute)
      "MONTH": 30 * 24 * 60 * 60 * 1000, // 1 month
      "MONTHLY": 30 * 24 * 60 * 60 * 1000, // 1 month
    };

    return timeframes[normalized] || timeframes["5MIN"]; // Default to 5 minutes
  }

  // The correct UTC boundary for the CURRENT candle of this timeframe, as of
  // `now`. Math.floor(now/ms)*ms only works for timeframes that evenly tile
  // a day from a midnight-UTC reference (intraday intervals, 12HR, Daily) --
  // Unix epoch (Jan 1 1970) was a Thursday, so floor-dividing a 7-day span
  // lands on Thursday boundaries, three days off from the Monday boundary
  // Binance actually uses for weekly candles. Months run 28-31 days, so no
  // fixed millisecond duration (getTimeframeMs uses a 30-day approximation)
  // can ever line up with a calendar-month boundary either.
  //
  // This was silently producing "stale candle" false positives for W (and
  // would for M too) wherever it fed the 1-hour staleness tolerance meant
  // for ordinary boundary jitter -- a real Monday candle looked 3 days
  // "early" against the wrong Thursday-based expectation. One other call
  // site already worked around this by skipping the check outright for W/M;
  // this computes the real boundary instead, so staleness detection still
  // catches genuinely stale data on these timeframes rather than giving up
  // on validating them.
  getExpectedCandleStart(timeframe, now = Date.now()) {
    const upper = (timeframe || "").toUpperCase();

    if (["W", "1W", "WEEK", "WEEKLY"].includes(upper)) {
      const d = new Date(now);
      const daysSinceMonday = (d.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday, 0, 0, 0, 0);
    }

    if (["M", "1MONTH", "MONTH", "MONTHLY"].includes(upper)) {
      const d = new Date(now);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
    }

    const timeframeMs = this.getTimeframeMs(timeframe);
    return Math.floor(now / timeframeMs) * timeframeMs;
  }

  // Get Binance interval from our timeframe format
  getBinanceInterval(timeframe) {
    const tf = timeframe.toUpperCase();
    switch (tf) {
      case "1MIN":
      case "1M":
        return "1m";
      case "5MIN":
      case "5M":
        return "5m";
      case "15MIN":
      case "15M":
        return "15m";
      case "1HR":
      case "1H":
      case "1HOUR":
        return "1h";
      case "4HR":
      case "4H":
      case "4HOUR":
        return "4h";
      case "12HR":
      case "12H":
      case "12HOUR":
        return "12h";
      case "D":
      case "DAY":
      case "DAILY":
        return "1d";
      case "W":
      case "WEEK":
      case "WEEKLY":
        return "1w";
      case "M":
      case "MONTH":
      case "MONTHLY":
        return "1M";
      default:
        return "5m";
    }
  }

  // 🛡️ SAFE CANDLE GETTER - Uses Queue System to Prevent 418 Ban
  getCandleDataOrQueue(symbol, timeframe) {
    const key = `${symbol}_${timeframe}`;

    // 1. Check Cache
    if (this.candleCache.has(key)) {
      return this.candleCache.get(key);
    }

    // 2. Agar Cache nahi hai, aur ye request already queue mein nahi hai
    if (!this.pendingCandleRequests.has(key)) {
      console.log(`⏳ Queueing candle fetch for ${key}`);
      this.addCandleToQueue(symbol, timeframe);
    }

    return null; // Abhi k liye null, background mein data aa jayega
  }

  // Add to Candle Queue Logic
  //
  // Root cause of the Aug 20 rate-limit storm: every one of this function's
  // six call sites is an error-recovery path inside a per-tick, per-symbol,
  // per-timeframe condition check -- exactly the code that runs MORE often
  // while the API is already banned/failing, not less. pendingCandleRequests
  // was being written to but never READ here, so none of those call sites
  // were actually deduplicated despite the Set's own "prevent duplicate
  // requests" comment. During a ban, every tick for every affected
  // symbol/timeframe kept stacking another identical entry into candleQueue
  // for the whole 2-minute ban window; by the time the ban lifted, the queue
  // had to burn through a huge pile of duplicates before reaching anything
  // new, which produced more 429s and re-armed the ban -- a self-sustaining
  // storm, not an isolated rate-limit blip.
  addCandleToQueue(symbol, timeframe) {
    const key = `${symbol}_${timeframe}`;
    if (this.pendingCandleRequests.has(key)) return; // already queued, skip the duplicate

    // Same safety net the RSI queue already has: cap growth instead of
    // letting a bad stretch turn into an unbounded backlog. Length stays
    // pinned at the cap while full (every call here returns before
    // pushing), so a length-based modulo would fire on literally every
    // dropped call instead of periodically -- throttle by time instead.
    if (this.candleQueue.length >= 2000) {
      const now = Date.now();
      if (!this._lastCandleCapWarnAt || now - this._lastCandleCapWarnAt > 10000) {
        this._lastCandleCapWarnAt = now;
        console.warn(`⚠️ Candle queue at capacity (${this.candleQueue.length}), dropping fetch for ${key}`);
      }
      return;
    }

    this.pendingCandleRequests.add(key);
    this.candleQueue.push({ symbol, timeframe, key });
    this.processCandleQueue();
  }

  // Process Candle Queue (Dhire Dhire API Call)
  async processCandleQueue() {
    if (this.isProcessingCandleQueue) return;
    this.isProcessingCandleQueue = true;

    console.log(`🔄 Candle Queue Started: ${this.candleQueue.length} items pending...`);

    while (this.candleQueue.length > 0) {
      // 1. Check for API ban
      if (Date.now() < this.candleApiBanUntil) {
        const waitTime = Math.ceil((this.candleApiBanUntil - Date.now()) / 1000);
        if (waitTime % 10 === 0) {
          console.log(`⛔ Candle API Paused due to 418 Error. Resuming in ${waitTime}s...`);
        }
        await this.delay(2000);
        continue;
      }

      // 2. Get next item
      const task = this.candleQueue[0];

      try {
        await this.fetchAndStoreCandleData(task.symbol, task.timeframe);

        // Success: Remove from queue
        this.candleQueue.shift();
        this.pendingCandleRequests.delete(task.key);

        // 🛑 SLOW DOWN: 200ms delay between requests (5 requests per second)
        await this.delay(200);

      } catch (error) {
        if (error.status === 418 || error.status === 429) {
          console.error(`🚨 Candle 418/429 ERROR! Pausing queue for 2 minutes.`);
          this.candleApiBanUntil = Date.now() + 120 * 1000; // 2 Minutes Ban
        } else {
          // Other error: Remove task and log
          console.error(`❌ [${task.timeframe}] Failed to fetch current candle data`);
          this.candleQueue.shift();
          this.pendingCandleRequests.delete(task.key);
        }
      }
    }

    this.isProcessingCandleQueue = false;
    console.log("✅ Candle Queue Processed.");
  }

  // Actual API Call for Candle (Private)
  async fetchAndStoreCandleData(symbol, timeframe) {
    const binanceInterval = this.getBinanceInterval(timeframe);
    const response = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=1`
    );

    if (response.status === 418 || response.status === 429) {
      const err = new Error("Rate Limit");
      err.status = response.status;
      throw err;
    }

    if (!response.ok) {
      throw new Error(`API Error ${response.status}`);
    }

    const klines = await response.json();
    if (klines && klines.length > 0) {
      const kline = klines[0];
      const candleStartTime = parseInt(kline[0]);
      const timeframeMs = this.getTimeframeMs(timeframe);
      const expectedStartTime = Math.floor(Date.now() / timeframeMs) * timeframeMs;

      // Skip stale detection for W/M timeframes
      // Binance uses Monday alignment for weekly candles which differs from our calculation
      const isLargeTimeframe = ['W', 'WEEK', 'WEEKLY', '1W', 'M', 'MONTH', 'MONTHLY', '1MONTH'].includes(timeframe.toUpperCase());

      if (!isLargeTimeframe) {
        // Dynamic stale threshold based on timeframe
        // For D candles, allow up to 1 hour difference (timezone alignment)
        // For smaller timeframes, use 5 seconds
        const staleThreshold = timeframeMs >= 24 * 60 * 60 * 1000
          ? 60 * 60 * 1000  // 1 hour for D
          : 5000;           // 5 seconds for smaller timeframes

        // Verify this is the CURRENT candle (not stale)
        if (Math.abs(candleStartTime - expectedStartTime) > staleThreshold) {
          console.warn(`⚠️ Stale candle detected for ${symbol} ${timeframe} (diff: ${Math.abs(candleStartTime - expectedStartTime)}ms, threshold: ${staleThreshold}ms)`);
          return null;
        }
      } else {
        // For W/M, just log that we're accepting the candle without stale check
        console.log(`📅 ${timeframe} candle accepted (large timeframe, skipping stale check)`);
      }

      const candle = {
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
        quoteVolume: parseFloat(kline[7]), // Explicitly store Quote Volume (USDT)
        startTime: candleStartTime,
        endTime: parseInt(kline[6]),
        isComplete: false,
      };

      // Store in Cache
      const key = `${symbol}_${timeframe}`;
      this.candleCache.set(key, candle);
      console.log(`✅ Candle data fetched & cached for ${key}`);
    }
  }

  // Legacy method - kept for backward compatibility
  async fetchCurrentCandleFromBinance(symbol, timeframe) {
    // Use safe queue system instead of direct API call
    return this.getCandleDataOrQueue(symbol, timeframe);
  }

  // Legacy method - kept for backward compatibility
  async fetchCandleFromBinance(symbol, timeframe) {
    return this.fetchCurrentCandleFromBinance(symbol, timeframe);
  }

  // Get or create candle data for a symbol and timeframe
  getCandleData(symbol, timeframe) {
    const key = `${symbol}_${timeframe}`;
    if (!this.candleData.has(key)) {
      this.candleData.set(key, {
        open: null,
        high: null,
        low: null,
        close: null,
        volume: 0,
        startTime: null,
        endTime: null,
        isComplete: false,
      });
    }
    return this.candleData.get(key);
  }

  // Update candle data with new price
  async updateCandleData(symbol, timeframe, priceData) {
    const candle = this.getCandleData(symbol, timeframe);
    const currentTime = Date.now();
    const timeframeMs = this.getTimeframeMs(timeframe);

    // Calculate candle start time (aligned to timeframe)
    const candleStartTime = Math.floor(currentTime / timeframeMs) * timeframeMs;

    // If this is a new candle, reset the candle data
    if (candle.startTime !== candleStartTime) {
      if (candle.startTime !== null) {
        // Previous candle is complete
        candle.isComplete = true;
        console.log(
          `🕯️ Candle completed for ${symbol} (${timeframe}): Open=${candle.open
          }, Close=${candle.close}, Change=${this.calculateCandleChange(
            candle
          )}%`
        );
      }

      // CRITICAL FIX: WebSocket ticker OHLC is 24-hour data, NOT current candle data!
      // DO NOT use priceData.open - it's the 24h opening price, not the candle's open!
      // Always fetch from Binance klines API for accurate candle open price.

      // Temporarily use live price until Binance API returns actual candle data
      candle.open = parseFloat(priceData.price);
      candle.high = parseFloat(priceData.price);
      candle.low = parseFloat(priceData.price);
      candle.close = parseFloat(priceData.price);
      candle.volume = parseFloat(priceData.volume) || 0;
      candle.startTime = candleStartTime;
      candle.endTime = candleStartTime + timeframeMs;
      candle.isComplete = false;

      console.log(
        `🕯️ New candle started for ${symbol} (${timeframe}): Open=${candle.open} (temporary - fetching from Binance API)`
      );

      // CRITICAL: Fetch actual candle open from Binance klines API (this is the correct open)
      this.fetchCandleFromBinance(symbol, timeframe)
        .then((binanceCandle) => {
          if (binanceCandle && binanceCandle.startTime === candleStartTime) {
            // Update with accurate Binance data
            const currentCandle = this.getCandleData(symbol, timeframe);
            if (currentCandle.startTime === candleStartTime) {
              currentCandle.open = binanceCandle.open; // This is the REAL candle open!
              currentCandle.high = Math.max(
                currentCandle.high,
                binanceCandle.high
              );
              currentCandle.low = Math.min(
                currentCandle.low,
                binanceCandle.low
              );
              currentCandle.close = binanceCandle.close;
              currentCandle.volume = binanceCandle.volume;
              console.log(
                `✅ Updated ${symbol} (${timeframe}) with Binance candle open: ${binanceCandle.open}`
              );
            }
          }
        })
        .catch(() => { }); // Silent fail - non-critical
    } else {
      // OPTIMIZATION: Update existing candle with WebSocket OHLC data (if available)
      // This ensures we have accurate high/low values from Binance
      if (priceData.high && priceData.low) {
        candle.high = Math.max(
          candle.high || priceData.high,
          parseFloat(priceData.high)
        );
        candle.low = Math.min(
          candle.low || priceData.low,
          parseFloat(priceData.low)
        );
      } else {
        // Fallback to price-based calculation
        const price = parseFloat(priceData.price);
        candle.high = Math.max(candle.high || price, price);
        candle.low = Math.min(candle.low || price, price);
      }

      candle.close = parseFloat(priceData.close || priceData.price);
      candle.volume += parseFloat(priceData.volume) || 0;

      // Check if current candle meets change requirement (immediate check)
      const currentChange = this.calculateCandleChange(candle);
      ALERT_VERBOSE_LOGS && console.log(
        `🕯️ Candle updated for ${symbol} (${timeframe}): High=${candle.high
        }, Low=${candle.low}, Close=${candle.close
        }, Current Change=${currentChange.toFixed(3)}%`
      );
    }

    return candle;
  }

  // Calculate percentage change for a candle
  calculateCandleChange(candle) {
    if (!candle.open || !candle.close) return 0;
    return ((candle.close - candle.open) / candle.open) * 100;
  }

  // Check if a candle meets the change percentage requirement
  async checkCandleChangeCondition(
    symbol,
    timeframe,
    requiredChange,
    baselinePrice
  ) {
    let candle = this.getCandleData(symbol, timeframe);

    console.log(`🔍 Checking candle for ${symbol} (${timeframe}):`);
    console.log(`   Candle complete: ${candle.isComplete}`);
    console.log(`   Open: ${candle.open}, Close: ${candle.close}`);
    console.log(`   Baseline Price: ${baselinePrice}`);
    console.log(
      `   Start time: ${candle.startTime}, End time: ${candle.endTime}`
    );

    // CRITICAL: If candle data is missing, fetch from Binance immediately
    if (
      !candle.open ||
      !candle.close ||
      candle.open === null ||
      candle.close === null
    ) {
      console.log(
        `⚠️ Candle data missing (Open=${candle.open}, Close=${candle.close}), fetching from Binance...`
      );

      const binanceCandle = await this.fetchCandleFromBinance(
        symbol,
        timeframe
      );
      if (binanceCandle) {
        // Update candle data with Binance data
        candle.open = binanceCandle.open;
        candle.close = binanceCandle.close;
        candle.high = binanceCandle.high;
        candle.low = binanceCandle.low;
        candle.volume = binanceCandle.volume;
        candle.startTime = binanceCandle.startTime;
        candle.endTime = binanceCandle.endTime;
        candle.isComplete = binanceCandle.isComplete;

        console.log(
          `✅ Fetched candle data from Binance: Open=${candle.open}, Close=${candle.close}`
        );
      } else {
        // If Binance fetch fails, use current price as fallback
        console.log(
          `⚠️ Binance fetch failed, using baseline price as fallback`
        );
        candle.open = baselinePrice;
        candle.close = baselinePrice;
      }
    }

    // Check if we have valid candle data after fetch
    if (
      !candle.open ||
      !candle.close ||
      candle.open === null ||
      candle.close === null
    ) {
      console.log(
        `❌ Candle not ready: Open=${candle.open}, Close=${candle.close}`
      );
      return false;
    }

    // Calculate change from baseline price instead of candle open
    const currentPrice = candle.close;
    const changeFromBaseline =
      ((currentPrice - baselinePrice) / baselinePrice) * 100;
    const absoluteChange = Math.abs(changeFromBaseline);

    console.log(`📊 Candle Change Check for ${symbol} (${timeframe}):`);
    console.log(`   Baseline: ${baselinePrice}, Current: ${currentPrice}`);
    console.log(
      `   Change from Baseline: ${changeFromBaseline.toFixed(
        3
      )}%, Required: ${requiredChange}%`
    );
    console.log(`   Absolute Change: ${absoluteChange.toFixed(3)}%`);

    const meetsRequirement = absoluteChange >= requiredChange;
    console.log(`   Result: ${meetsRequirement ? "✅ PASSED" : "❌ FAILED"}`);

    return meetsRequirement;
  }

  // Reload alerts cache from database
  // Called automatically on alert create/update/delete events
  async reloadAlertsCache() {
    console.log("🔄 Reloading alerts cache...");
    await this.loadAlertsToRedisCache();

    // 🔥 CRITICAL FIX: Update MicroBatchEngine's activeSymbolsSet
    // This ensures the engine stays in sync with database changes
    await this.updateMicroBatchActiveSymbols();
    console.log("✅ MicroBatchEngine activeSymbols updated after cache reload");
  }

  async subscribeToAlertManagement() {
    if (this.redisSubscribed) {
      return;
    }

    try {
      await AlertRedisService.subscribeToAlertManagement((data) => {
        this.handleAlertManagementEvent(data);
      });
      this.redisSubscribed = true;
      console.log("✅ Subscribed to alert management events");
    } catch (error) {
      console.error("❌ Error subscribing to alert management:", error);
    }
  }

  // Handle Redis alert management events
  async handleAlertManagementEvent(data) {
    try {
      switch (data.type) {
        case "alert_created":
          await this.addAlert(data.alertId);
          // Reload cache to include new alert
          await this.reloadAlertsCache();
          break;

        case "alert_removed":
          await this.removeAlert(data.alertId);
          // Reload cache to remove deleted alert
          await this.reloadAlertsCache();
          break;

        case "bulk_alerts_created":
          for (const alertId of data.alertIds) {
            await this.addAlert(alertId);
          }
          // Reload cache to include all new alerts
          await this.reloadAlertsCache();
          break;

        case "alerts_cleared":
          await this.removeAlertsForUser(data.userId);
          // Reload cache to remove all user alerts
          await this.reloadAlertsCache();
          break;

        case "alerts_removed_for_symbol":
          // Check if userId is provided (for single user removal)
          if (data.userId) {
            await this.removeAlertsForSymbol(data.symbol, data.userId);
          } else {
            // If no userId, this shouldn't happen but handle gracefully
            console.warn(`⚠️ alerts_removed_for_symbol event without userId for ${data.symbol}`);
          }
          // Reload cache to remove alerts for this symbol
          await this.reloadAlertsCache();
          break;

        default:
          console.log(`⚠️ Unknown alert management event type: ${data.type}`);
      }
    } catch (error) {
      console.error("❌ Error handling alert management event:", error);
    }
  }

  // Unsubscribe from Redis alert management events
  async unsubscribeFromAlertManagement() {
    if (!this.redisSubscribed) {
      console.log("⚠️ Not subscribed to alert management events");
      return;
    }

    try {
      await AlertRedisService.unsubscribeFromAlertManagement();
      this.redisSubscribed = false;
      console.log("✅ Unsubscribed from alert management events");
    } catch (error) {
      console.error("❌ Error unsubscribing from alert management:", error);
    }
  }
  // ============================================
  // Health Monitoring and System Control
  // ============================================

  // Start heartbeat for health monitoring
  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Safety net: if the engine's symbol set ever drifts from what's actually in
    // the database, monitoring goes quiet for the missing symbols without any
    // error being raised — the only symptom is alerts that never arrive. Compare
    // the two periodically and repair rather than relying on every write path
    // getting it right.
    if (this.symbolReconcileInterval) {
      clearInterval(this.symbolReconcileInterval);
    }
    this.symbolReconcileInterval = setInterval(async () => {
      try {
        const alerts = await Alert.find({ status: "active" }).lean();
        const expected = new Set(alerts.map((a) => a.symbol).filter(Boolean));
        const tracked = this.microBatchEngine?.activeSymbolsSet;
        if (!tracked || tracked.size === expected.size) return;

        console.warn(
          `⚠️ Symbol set drift: engine has ${tracked.size}, database has ${expected.size} — repairing`
        );
        this.microBatchEngine.updateActiveSymbols(alerts);
      } catch (error) {
        console.error("❌ Error reconciling active symbols:", error.message);
      }
    }, 60 * 1000);

    // Send heartbeat every 30 seconds
    this.heartbeatInterval = setInterval(async () => {
      try {
        if (this.redisClient) {
          await this.redisClient.set(
            "alert:processor:heartbeat",
            Date.now().toString(),
            "EX",
            120 // Expire in 2 minutes
          );

          // Also update processor stats
          const stats = this.safeProcessor ? this.safeProcessor.getStats() : {};
          await this.redisClient.set(
            "alert:processor:stats",
            JSON.stringify({
              ...stats,
              activeAlerts: this.activeAlerts.size,
              isWebSocketRunning: this.isWebSocketRunning,
              timestamp: Date.now(),
            }),
            "EX",
            300 // Expire in 5 minutes
          );
        }
      } catch (error) {
        console.error("❌ Error sending heartbeat:", error.message);
      }
    }, 30000);

    console.log("💓 Heartbeat started (30s interval)");
  }

  // Stop heartbeat
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log("💓 Heartbeat stopped");
    }
    if (this.symbolReconcileInterval) {
      clearInterval(this.symbolReconcileInterval);
      this.symbolReconcileInterval = null;
    }
  }

  // Initialize separate Redis subscriber connection for pub/sub
  async initRedisSubscriber() {
    try {
      if (this.redisSubscriber) {
        return this.redisSubscriber;
      }

      const Redis = (await import("ioredis")).default;
      this.redisSubscriber = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT || 6379,
        lazyConnect: false,
        retryDelayOnClusterDown: 300,
        maxRetriesPerRequest: 5,
        enableReadyCheck: false,
        keepAlive: 30000,
        connectTimeout: 10000,
      });

      this.redisSubscriber.on("error", (err) => {
        console.error("❌ Redis subscriber error:", err.message);
      });

      this.redisSubscriber.on("close", () => {
        console.warn("⚠️ Redis subscriber connection closed");
        this.redisSubscriber = null;
      });

      console.log("✅ Redis subscriber initialized (separate connection)");
      return this.redisSubscriber;
    } catch (error) {
      console.error("❌ Error initializing Redis subscriber:", error);
      return null;
    }
  }

  // Subscribe to system control messages
  async subscribeToSystemControl() {
    try {
      // Use SEPARATE Redis connection for pub/sub operations
      const subscriber = await this.initRedisSubscriber();
      if (!subscriber) {
        console.error("❌ Redis subscriber not available for system control");
        return;
      }

      await subscriber.subscribe("system:control");
      console.log(
        "✅ Subscribed to system:control channel (separate connection)"
      );

      subscriber.on("message", async (channel, message) => {
        if (channel === "system:control") {
          try {
            const data = JSON.parse(message);
            await this.handleSystemControlMessage(data);
          } catch (error) {
            console.error("❌ Error parsing system control message:", error);
          }
        }
      });
    } catch (error) {
      console.error("❌ Error subscribing to system control:", error);
    }
  }

  // Handle system control messages
  async handleSystemControlMessage(data) {
    console.log("🎛️ Received system control message:", data.command);

    switch (data.command) {
      case "restart_alert_processor":
        console.log("🔄 Restarting alert processor...");
        // Restart WebSocket connection
        this.stopWebSocketPriceFeed();
        setTimeout(() => {
          this.startWebSocketPriceFeed();
        }, 3000);
        if (process.env.ENABLE_KLINE_WS === "1") {
          this.stopBinanceKlineWebSocket();
          setTimeout(() => {
            this.startBinanceKlineWebSocket();
          }, 3000);
        }
        break;

      case "emergency_cleanup":
        console.log("🧹 Running emergency cleanup...");
        await this.emergencyCleanup();
        break;

      case "reload_alerts":
        console.log("🔄 Reloading alerts cache...");
        await this.loadAlertsToRedisCache();
        break;

      case "get_stats":
        console.log("📊 Sending processor stats...");
        await this.sendProcessorStats();
        break;

      case "reset_rsi_ban":
        console.log("🛡️ Resetting RSI API ban...");
        this.apiBanUntil = 0;
        this.rsiQueue = [];
        if (this.rsiFailures) {
          this.rsiFailures.clear();
          console.log(`✅ Reset ${this.rsiFailures.size} circuit breaker failures`);
        }
        console.log("✅ RSI ban reset, queue cleared, circuit breaker reset");
        break;

      case "reset_rsi_circuit_breaker":
        console.log("🛡️ Resetting RSI circuit breaker...");
        if (this.rsiFailures) {
          const count = this.rsiFailures.size;
          this.rsiFailures.clear();
          console.log(`✅ Reset ${count} RSI circuit breaker failures`);
        }
        break;

      case "reset_candle_ban":
        console.log("🛡️ Resetting Candle API ban...");
        this.candleApiBanUntil = 0;
        this.candleQueue = [];
        this.pendingCandleRequests.clear();
        console.log("✅ Candle ban reset, queue cleared");
        break;

      case "get_microbatch_stats":
        console.log("📊 Sending micro-batch stats...");
        await this.sendMicroBatchStats();
        break;

      case "reset_microbatch_metrics":
        console.log("🔄 Resetting micro-batch metrics...");
        if (this.microBatchEngine) {
          this.microBatchEngine.resetMetrics();
        }
        break;

      case "clear_processing_locks":
        console.log("🧹 Clearing all processing locks...");
        if (this.safeProcessor) {
          await this.safeProcessor.clearAllProcessingLocks();
        }
        break;

      default:
        console.log("❓ Unknown system control command:", data.command);
    }
  }

  // 🛡️ Get RSI Queue Status
  getRsiQueueStatus() {
    return {
      queueLength: this.rsiQueue.length,
      isProcessing: this.isProcessingRsiQueue,
      isApiBanned: Date.now() < this.apiBanUntil,
      banTimeRemaining: Math.max(0, this.apiBanUntil - Date.now()),
      historySize: this.rsiHistory.size,
      nextBanReset: this.apiBanUntil > 0 ? new Date(this.apiBanUntil).toISOString() : null
    };
  }

  // 🛡️ Get Candle Queue Status
  getCandleQueueStatus() {
    return {
      queueLength: this.candleQueue.length,
      isProcessing: this.isProcessingCandleQueue,
      isApiBanned: Date.now() < this.candleApiBanUntil,
      banTimeRemaining: Math.max(0, this.candleApiBanUntil - Date.now()),
      cacheSize: this.candleCache.size,
      pendingRequests: this.pendingCandleRequests.size,
      nextBanReset: this.candleApiBanUntil > 0 ? new Date(this.candleApiBanUntil).toISOString() : null
    };
  }

  // Emergency cleanup for memory issues
  async emergencyCleanup() {
    try {
      console.log("🚨 Running emergency cleanup...");

      // Clear old processed alerts and processing locks
      if (this.safeProcessor) {
        this.safeProcessor.cleanup();
        await this.safeProcessor.clearAllProcessingLocks();
      }

      // Clear old candle data (keep only last 1 hour)
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      for (const [key, candle] of this.candleData.entries()) {
        if (candle.startTime < oneHourAgo) {
          this.candleData.delete(key);
        }
      }

      // Clear old RSI data
      this.rsiData.clear();

      // 🛡️ Clear RSI queue and history
      this.rsiQueue = [];
      this.rsiHistory.clear();
      this.apiBanUntil = 0; // Reset ban

      // 🛡️ Reset circuit breaker failures
      if (this.rsiFailures) {
        this.rsiFailures.clear();
      }

      // 🛡️ Clear Candle queue and cache
      this.candleQueue = [];
      this.candleCache.clear();
      this.pendingCandleRequests.clear();
      this.candleApiBanUntil = 0; // Reset candle ban

      // Clear old open interest data
      this.openInterestData.clear();

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        console.log("🗑️ Forced garbage collection");
      }

      console.log("✅ Emergency cleanup completed");
    } catch (error) {
      console.error("❌ Error in emergency cleanup:", error);
    }
  }

  // Send processor statistics
  async sendProcessorStats() {
    try {
      const stats = {
        activeAlerts: this.activeAlerts.size,
        isWebSocketRunning: this.isWebSocketRunning,
        candleDataSize: this.candleData.size,
        rsiDataSize: this.rsiData.size,
        openInterestDataSize: this.openInterestData.size,
        memoryUsage: process.memoryUsage(),
        timestamp: Date.now(),
      };

      if (this.safeProcessor) {
        Object.assign(stats, { safeProcessor: this.safeProcessor.getStats() });
      }

      if (this.microBatchEngine) {
        Object.assign(stats, {
          microBatch: this.microBatchEngine.getPerformanceStats(),
        });
      }

      if (this.redisClient) {
        await this.redisClient.publish("system:stats", JSON.stringify(stats));
      }

      console.log("📊 Processor stats sent:", stats);
    } catch (error) {
      console.error("❌ Error sending processor stats:", error);
    }
  }

  // Send micro-batch specific statistics
  async sendMicroBatchStats() {
    try {
      if (!this.microBatchEngine) {
        console.log("⚠️ Micro-batch engine not available");
        return;
      }

      const microBatchStats = this.microBatchEngine.getPerformanceStats();

      if (this.redisClient) {
        await this.redisClient.publish(
          "system:microbatch:stats",
          JSON.stringify(microBatchStats)
        );
      }

      console.log("🚀 Micro-batch stats sent:", microBatchStats);
    } catch (error) {
      console.error("❌ Error sending micro-batch stats:", error);
    }
  }

  // Unsubscribe from system control messages
  async unsubscribeFromSystemControl() {
    try {
      if (this.redisSubscriber) {
        await this.redisSubscriber.unsubscribe("system:control");
        await this.redisSubscriber.quit();
        this.redisSubscriber = null;
        console.log("✅ Unsubscribed from system:control channel");
      }
    } catch (error) {
      console.error("❌ Error unsubscribing from system control:", error);
    }
  }
}
export default new RealTimeAlertProcessor();
