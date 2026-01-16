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
class RealTimeAlertProcessor {
  constructor() {
    this.activeAlerts = new Map(); // symbol -> alert data
    this.processedAlerts = new Set(); // Track processed alerts to avoid duplicates
    this.isProcessing = false;
    this.alertIds = new Set(); // Track which alert IDs are currently active
    this.alertBaselines = new Map(); // Track baseline prices for change calculations
    this.redisSubscribed = false; // Track Redis subscription status
    this.candleData = new Map(); // Track candle data for timeframe-based changes
    // Concurrency limit for parallel alert processing - INCREASED for 95% accuracy
    this.processLimit = pLimit(100); // Was 50, now 100 for faster processing
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

    // 🛡️ CIRCUIT BREAKER - Prevent infinite retry loops
    this.rsiFailures = new Map(); // Track RSI calculation failures
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
        console.warn("⚠️ Redis cache client connection closed");
        this.redisClient = null;
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
        console.warn("⚠️ Redis DB queue client connection closed");
        this.dbQueueClient = null;
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
        return null; // If Redis unavailable, allow processing (fallback)
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
      return null; // On error, allow processing (fail open)
    }
  }

  // Release Redis lock for alert processing
  async releaseAlertLock(alertId, token) {
    try {
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
      return true;
    } catch (error) {
      console.error("❌ Error loading alerts to Redis cache:", error);
      return false;
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
  startWebSocketPriceFeed() {
    if (this.isWebSocketRunning) {
      console.log("⚠️ WebSocket already running");
      return;
    }

    console.log("🚀 Starting Binance WebSocket price feed...");

    try {
      // Connect to Binance !ticker@arr stream (all tickers)
      const wsUrl = "wss://stream.binance.com:9443/ws/!ticker@arr";
      this.binanceWebSocket = new WebSocket(wsUrl);

      this.binanceWebSocket.on("open", () => {
        console.log("✅ Binance WebSocket connected");
        this.isWebSocketRunning = true;
      });

      this.binanceWebSocket.on("message", (data) => {
        try {
          const tickers = JSON.parse(data.toString());
          if (tickers && Array.isArray(tickers)) {
            // 🚀 MICRO-BATCH EXECUTION ENGINE - Ultra High Performance Processing
            const startTime = performance.now();

            console.log(
              `📊 WebSocket: Received ${tickers.length} ticker updates`
            );

            // Step 1: Ultra-fast symbol filtering (O(1) lookup)
            const relevantUpdates =
              this.microBatchEngine.filterRelevantSymbols(tickers);

            if (relevantUpdates.size === 0) {
              console.log(
                `😴 No alerts for any of the ${tickers.length} ticker updates, 100% CPU saved!`
              );
              return;
            }

            // Step 2: Update live prices cache for all symbols (background task)
            this.updateLivePricesCache(tickers);

            // Step 3: Add relevant symbols to micro-batch queue
            this.microBatchEngine.addToBatch(relevantUpdates);

            const processingTime = performance.now() - startTime;
            const efficiency = (relevantUpdates.size / tickers.length) * 100;

            console.log(
              `⚡ Micro-Batch: ${relevantUpdates.size}/${tickers.length
              } relevant (${efficiency.toFixed(
                1
              )}% efficiency) queued in ${processingTime.toFixed(2)}ms`
            );
          }
        } catch (error) {
          console.error("❌ Error parsing WebSocket message:", error);
        }
      });

      this.binanceWebSocket.on("error", (error) => {
        console.error("❌ Binance WebSocket error:", error.message);
        this.isWebSocketRunning = false;
      });

      this.binanceWebSocket.on("close", () => {
        console.log(
          "⚠️ Binance WebSocket closed, reconnecting in 3 seconds..."
        );
        this.isWebSocketRunning = false;
        this.binanceWebSocket = null;

        // Reconnect after 3 seconds
        setTimeout(() => {
          this.startWebSocketPriceFeed();
        }, 3000);
      });
    } catch (error) {
      console.error("❌ Error starting WebSocket:", error);
      this.isWebSocketRunning = false;

      // Retry after 3 seconds
      setTimeout(() => {
        this.startWebSocketPriceFeed();
      }, 3000);
    }
  }

  // Process price update in real-time (from WebSocket)
  async processPriceUpdateRealTime(symbol, liveData) {
    try {
      // OPTIMIZATION: Use in-memory cache FIRST (0.1ms vs 5-20ms Redis)
      let alerts = this.activeAlerts.get(symbol) || [];

      // Only fallback to Redis if in-memory cache is empty
      if (alerts.length === 0) {
        alerts = await this.getAlertsFromCache(symbol);
        // Update in-memory cache for next time
        if (alerts.length > 0) {
          this.activeAlerts.set(symbol, alerts);
        } else if (alerts.length === 0) {
          alerts = await this.loadAllActiveAlerts();
        }
        if (alerts.length > 0) {
          this.activeAlerts.set(symbol, alerts);
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
    await this.initDbQueueClient(); // Initialize DB queue client

    // Step 2: Load all alerts from DB and cache in Redis (initial load only)
    await this.loadAlertsToRedisCache();

    // Step 3: Start WebSocket connection
    this.startWebSocketPriceFeed();

    // Step 4: Subscribe to alert management events
    // Cache is updated automatically when alerts are created/updated/deleted
    // No periodic reload needed - events handle all cache updates
    await this.subscribeToAlertManagement();

    // Step 5: Start heartbeat for health monitoring
    this.startHeartbeat();

    // Step 6: Subscribe to system control messages
    await this.subscribeToSystemControl();

    // Step 7: Setup micro-batch processing
    this.setupMicroBatchEngine();

    // Step 8: Load active symbols for micro-batch filtering
    await this.updateMicroBatchActiveSymbols();
  }

  // Stop WebSocket connection
  async stopWebSocketPriceFeed() {
    if (this.binanceWebSocket) {
      console.log("🛑 Stopping Binance WebSocket...");
      this.binanceWebSocket.close();
      this.binanceWebSocket = null;
      this.isWebSocketRunning = false;
    }

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
    try {
      // Get all active alerts to determine which symbols we need to monitor
      const alerts = await Alert.find({ status: "active" }).lean();

      // Update micro-batch engine's active symbols
      this.microBatchEngine.updateActiveSymbols(alerts);

      console.log(
        `📊 Updated micro-batch active symbols: ${alerts.length} alerts`
      );
    } catch (error) {
      console.error("❌ Error updating micro-batch active symbols:", error);
    }
  }

  // Update live prices cache for all symbols (background task)
  updateLivePricesCache(tickers) {
    // This is a fire-and-forget background task - don't block micro-batch processing
    setImmediate(async () => {
      try {
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

          // Update Redis cache (fire-and-forget)
          if (this.redisClient) {
            this.redisClient
              .setex(
                `crypto:${symbol}`,
                300, // 5 minutes TTL
                JSON.stringify(priceData)
              )
              .catch(() => { }); // Silent fail - non-critical
          }
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
      // 🔥 CRITICAL FIX: Save ORIGINAL baseline BEFORE any updates
      // This prevents race condition where baseline resets before condition check
      const originalBaselinePrice = parseFloat(alert.baselinePrice) || 0;
      const originalBaselineVolume = parseFloat(alert.baselineVolume) || 0;

      // 🛡️ SAFETY CHECK: If baseline is 0 or missing, set it to current price and skip this check
      if (originalBaselinePrice <= 0) {
        console.log(`⚠️ Alert ${alert._id} has no baseline price, setting to current: ${liveData.price}`);
        alert.baselinePrice = liveData.price;
        alert.baselineTimestamp = new Date();
        // Skip this cycle - alert needs a baseline first
        return { triggered: false, reason: "baseline_initialized" };
      }

      console.log(
        `📊 Baseline: ${originalBaselinePrice}, Live: ${liveData.price}`
      );

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

          // Update baseline to current live price
          alert.baselinePrice = liveData.price;
          alert.baselineTimestamp = new Date(currentCandleStart); // Set to candle start for accurate tracking

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
            baselinePrice: liveData.price,
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
                baselinePrice: liveData.price,
                baselineVolume: liveData.volume || liveData.volume24h,
                baselineTimestamp: new Date(currentCandleStart),
                conditions: alert.conditions, // Preserve lock
              };
            }
          }

          // OPTIMIZATION: Update Redis cache (non-blocking)
          this.updateAlertInCache({
            ...alert,
            baselinePrice: liveData.price,
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

        console.log(
          `🔒 Alert ${alert._id} for ${alert.symbol
          } is LOCKED until ${lockUntil.toISOString()}`
        );
        return { triggered: false, reason: "alert_locked" };
      }

      console.log(`✅ Alert ${alert._id} for ${alert.symbol} is NOT locked, proceeding...`);

      // 🔥 CRITICAL FIX: Use ORIGINAL baseline for direction check
      // This ensures we compare against the baseline BEFORE it was updated
      const direction =
        alert.conditions?.changePercent?.direction || "increase";

      // 🛡️ Calculate actual change percentage FIRST
      const livePrice = parseFloat(liveData.price) || 0;
      const actualChangePercent = originalBaselinePrice > 0
        ? ((livePrice - originalBaselinePrice) / originalBaselinePrice) * 100
        : 0;

      // 🛡️ MINIMUM CHANGE THRESHOLD - Prevent 0% change alerts
      const MIN_CHANGE_THRESHOLD = 0.001; // 0.001% minimum change required
      const hasMinimumChange = Math.abs(actualChangePercent) >= MIN_CHANGE_THRESHOLD;

      if (!hasMinimumChange) {
        console.log(`⏸️ Alert ${alert._id}: Change ${actualChangePercent.toFixed(4)}% below threshold ${MIN_CHANGE_THRESHOLD}%`);
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

      // Check alert conditions - pass original baseline for Change Percent calculation
      const conditionsMet = await this.checkAlertConditionsWithLiveData(
        alert,
        liveData,
        originalBaselinePrice // 🔥 CRITICAL: Use original baseline for % change calc
      );

      if (conditionsMet) {
        // Trigger the alert (this will apply the lock)
        // 🔥 FIX: Pass original baseline so correct % is saved in history
        await this.triggerAlertWithLiveData(alert, liveData, originalBaselinePrice);

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
  async checkAlertConditionsWithLiveData(alert, liveData, originalBaselinePrice = null) {
    try {
      const conditions = alert.conditions;

      // 🔥 CRITICAL: Use original baseline if provided, otherwise use alert's baseline
      const baselinePriceForCheck = originalBaselinePrice || alert.baselinePrice;

      console.log(`📋 Checking conditions for ${alert.symbol}:`);

      // OPTIMIZATION 1: Create array of only SET conditions for hierarchical checking
      const activeConditions = this.getActiveConditions(
        conditions,
        liveData,
        alert,
        baselinePriceForCheck // 🔥 Pass original baseline for % change calculation
      );

      if (activeConditions.length === 0) {
        console.log(`⚠️ No active conditions found for ${alert.symbol}`);
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

      // Check if all conditions passed
      for (let i = 0; i < conditionResults.length; i++) {
        const result = conditionResults[i];
        const conditionCheck = activeConditions[i];

        if (!result.passed) {
          console.log(`❌ ${conditionCheck.name} FAILED: ${result.reason}`);
          return false; // Early exit
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

  // OPTIMIZATION HELPER: Get only active/set conditions in priority order
  getActiveConditions(conditions, liveData, alert, baselinePriceForCheck = null) {
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

          // 🔥 CRITICAL FIX: Calculate change from ORIGINAL baseline price
          // This uses effectiveBaseline (passed from original) not alert.baselinePrice (possibly updated)
          const changeFromBaseline =
            ((liveData.price - effectiveBaseline) / effectiveBaseline) *
            100;
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
          return {
            passed: candleMatch,
            reason: candleMatch
              ? "Candle pattern met"
              : "Candle pattern not met",
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
          return {
            passed: rsiMatch,
            reason: rsiMatch ? "RSI condition met" : "RSI condition not met",
          };
        },
      });
    }

    // Priority 6: Volume (medium-high cost)
    if (this.isConditionSet(conditions.volume?.timeframes)) {
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
          return {
            passed: volumeMatch,
            reason: volumeMatch
              ? "Volume condition met"
              : "Volume condition not met",
          };
        },
      });
    }

    // Priority 7: Open Interest (highest cost)
    if (this.isConditionSet(conditions.openInterest?.timeframes)) {
      activeConditions.push({
        name: "Open Interest",
        priority: 7,
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
  async triggerAlertWithLiveData(alert, liveData, originalBaselinePrice = null) {
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
        const timeframe = alert.conditions?.changePercent?.timeframe?.toLowerCase() || "5m";
        const chartOptions = {
          alertData: {
            triggerPrice: liveData.price,
            baselinePrice: baselinePrice,
            changePercent: changeFromBaselinePercent
          }
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
      const redis = await import("../utils/redis.js");

      for (const symbol of symbols) {
        try {
          let priceData = await redis.default.get(`crypto:${symbol}`);
          if (!priceData) {
            priceData = await redis.default.get(
              `crypto:${symbol.toLowerCase()}`
            );
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
      console.log(
        `🔍 Checking alert conditions for ${alert.symbol} (Alert ID: ${alert._id})`
      );
      console.log(
        `📊 Live data: Price=${priceData.price}, Volume=${priceData.volume24h}, Change=${priceData.priceChangePercent}%`
      );
      console.log(
        `📊 Baseline: Price=${alert.baselinePrice}, Volume=${alert.baselineVolume}, Timestamp=${alert.baselineTimestamp}`
      );

      // 🔥 CRITICAL FIX: Track if baseline needs updating, but DON'T update until AFTER alert check
      // This prevents the "Change in price: 0.000%" bug at timeframe boundaries
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

        // Check if timeframe interval has passed
        if (timeSinceBaseline >= timeframeMs) {
          console.log(
            `⏰ Timeframe interval passed for ${alert.symbol}, will update baseline from ${alert.baselinePrice} to ${priceData.price} AFTER alert check`
          );

          // 🔥 FIX: Store new baseline values but DON'T apply them yet
          shouldUpdateBaseline = true;
          newBaselinePrice = priceData.price;
          newBaselineVolume = priceData.volume || priceData.volume24h;
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

        // Calculate current spike magnitude
        const requiredChange = parseFloat(alert.conditions?.changePercent?.percentage) || 0;
        const currentChange = alert.baselinePrice && alert.baselinePrice > 0
          ? Math.abs((priceData.price - alert.baselinePrice) / alert.baselinePrice * 100)
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
      const direction =
        alert.conditions?.changePercent?.direction || "increase";
      const priceChanged = priceData.price !== alert.baselinePrice;

      console.log(
        `📊 Direction Check: Required=${direction}, Baseline=${alert.baselinePrice}, Live=${priceData.price}`
      );

      if (direction === "increase" && priceData.price <= alert.baselinePrice) {
        console.log(
          `❌ Direction: INCREASE - Live price ${priceData.price} <= baseline ${alert.baselinePrice}, skipping alert`
        );
        return false;
      }

      if (direction === "decrease" && priceData.price >= alert.baselinePrice) {
        console.log(
          `❌ Direction: DECREASE - Live price ${priceData.price} >= baseline ${alert.baselinePrice}, skipping alert`
        );
        return false;
      }

      if (!priceChanged) {
        console.log(
          `❌ Price hasn't changed from baseline ${alert.baselinePrice}, skipping alert`
        );
        return false;
      }

      console.log(
        `✅ Direction condition met: ${direction.toUpperCase()} - Price moved from ${alert.baselinePrice
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

        // Check if candle meets the change requirement using baseline price
        if (!alert.baselinePrice || alert.baselinePrice === 0) {
          console.log(
            `❌ Candle Change % condition FAILED: Baseline price is 0 or missing`
          );
          conditionsMet = false;
        } else {
          const candleChangeMet = this.checkCandleChangeCondition(
            alert.symbol,
            timeframe,
            requiredChange,
            alert.baselinePrice
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
        if (!rsiMatch) {
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
        if (!volumeMatch) {
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

      // 🔥 CRITICAL FIX: Apply deferred baseline update AFTER alert processing
      // This ensures alert was triggered with the OLD baseline (correct change calculation)
      // Now we update to the NEW baseline for the next alert cycle
      if (shouldUpdateBaseline && newBaselinePrice !== null) {
        console.log(
          `🔄 NOW updating baseline for ${alert.symbol} from ${alert.baselinePrice} to ${newBaselinePrice} (deferred from earlier)`
        );

        // Update in-memory alert
        alert.baselinePrice = newBaselinePrice;
        alert.baselineVolume = newBaselineVolume;
        alert.baselineTimestamp = new Date();

        // Queue baseline update to database (non-blocking)
        await this.enqueueDbOperation({
          type: "update_baseline",
          alertId: alert._id.toString(),
          data: {
            baselinePrice: newBaselinePrice,
            baselineVolume: newBaselineVolume,
            baselineTimestamp: new Date(),
          },
          priority: "normal",
        }).catch((error) => {
          console.error(
            `❌ Error enqueueing deferred baseline update:`,
            error.message
          );
          // Fallback: Try direct DB update if queue fails
          Alert.findByIdAndUpdate(alert._id, {
            baselinePrice: newBaselinePrice,
            baselineVolume: newBaselineVolume,
            baselineTimestamp: new Date(),
          }).catch((dbError) => {
            console.error(
              `❌ Error updating deferred baseline (fallback):`,
              dbError.message
            );
          });
        });

        // Update in-memory cache
        const alertsForSymbol = this.activeAlerts.get(alert.symbol);
        if (alertsForSymbol) {
          const alertIndex = alertsForSymbol.findIndex(
            (a) => a._id.toString() === alert._id.toString()
          );
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
        await this.updateAlertInCache({
          ...alert,
          baselinePrice: newBaselinePrice,
          baselineVolume: newBaselineVolume,
          baselineTimestamp: new Date(),
        }).catch((error) => {
          console.error(
            `❌ Error updating deferred baseline in Redis cache:`,
            error.message
          );
        });

        console.log(
          `✅ Deferred baseline update applied for ${alert.symbol}: ${newBaselinePrice}`
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
      parts.push(`Min Daily: ${conditions.minDaily}`);
    }

    if (conditions.changePercent) {
      parts.push(
        `Change: ${conditions.changePercent.percentage}% (${conditions.changePercent.timeframe})`
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

  // 🛡️ SAFE RSI CALCULATION - Queue System to Prevent 418 Ban
  async calculateRSI(symbol, timeframe, period = 14) {
    const key = `${symbol}_${timeframe}`;

    // Circuit breaker - check if we've had actual API failures
    const failureKey = `rsi_failures_${key}`;
    const failures = this.rsiFailures?.get(failureKey) || 0;
    const lastFailureTime = this.rsiFailures?.get(`${failureKey}_time`) || 0;
    const timeSinceLastFailure = Date.now() - lastFailureTime;

    // Only block if we have real failures AND within 10 minute window
    if (failures >= 5 && timeSinceLastFailure < 10 * 60 * 1000) {
      return null;
    } else if (failures >= 5 && timeSinceLastFailure >= 10 * 60 * 1000) {
      // Reset after 10 minutes
      this.rsiFailures.delete(failureKey);
      this.rsiFailures.delete(`${failureKey}_time`);
    }

    // 1. Check if we have history for local calculation
    let closes = this.rsiHistory.get(key);

    if (!closes || closes.length < period + 1) {
      // Data missing -> Queue background fetch (but only if not already queued)
      const alreadyQueued = this.rsiQueue.some(item => item.key === key);
      if (!alreadyQueued && this.rsiQueue.length < 500) {
        this.queueRsiHistoryFetch(symbol, timeframe, period);
      }

      // ✅ FIX: Don't count as failure - data is just loading
      // Return null immediately (alert will retry next tick)
      return null;
    }

    // 2. Add current live price for real-time RSI
    const livePrice = this.livePrices[symbol]?.price;
    let calculationCloses = [...closes];

    if (livePrice) {
      calculationCloses.push(livePrice);
    }

    // 3. Calculate RSI locally (no API call)
    const rsi = this.computeRSILocally(calculationCloses, period);

    // Reset failure count on success
    if (rsi !== null && this.rsiFailures) {
      this.rsiFailures.delete(failureKey);
      this.rsiFailures.delete(`${failureKey}_time`);
    }

    return rsi;
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

    // CRITICAL FIX: Limit queue size to prevent memory issues
    if (this.rsiQueue.length >= 500) {
      return;
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

      // CRITICAL FIX: Remove tasks older than 10 minutes
      if (taskAge > 10 * 60 * 1000) {
        console.log(`⏰ Removing stale RSI task for ${task.key} (age: ${Math.round(taskAge / 1000)}s)`);
        this.rsiQueue.shift();
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
    const limit = period + 10; // Extra buffer

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

    console.log(`🕯️ Candle Evaluation: ${condition}, Live Price: ${currentPrice}`);

    switch (condition) {
      case "CANDLE_ABOVE_OPEN":
        if (timeframes.length === 0 || !symbol) {
          console.log(`⚠️ No timeframes selected for candle condition`);
          return false;
        }

        console.log(`🔍 CANDLE_ABOVE_OPEN: Checking ${timeframes.length} timeframes for ${symbol}`);

        // 🚀 HYBRID APPROACH: Cache First (FAST) + API Refresh if Stale (ACCURATE)
        const CACHE_FRESH_TTL = 30000; // Cache is "fresh" for 30 seconds
        const now = Date.now();

        const candlePromises = timeframes.map(async (timeframe, index) => {
          const key = `${symbol}_${timeframe}`;
          const cachedCandle = this.candleCache.get(key);

          // Calculate expected candle start for this timeframe
          const timeframeMs = this.getTimeframeMs(timeframe);
          const expectedCandleStart = Math.floor(now / timeframeMs) * timeframeMs;

          // For D/W timeframes, allow timezone tolerance
          const isLargeTimeframe = ['D', '1D', 'W', '1W', '12HR', '12H'].includes(timeframe.toUpperCase());

          // Check if cache is FRESH and CURRENT
          const cacheIsFresh = cachedCandle &&
            cachedCandle.open !== null &&
            cachedCandle.startTime >= expectedCandleStart - (isLargeTimeframe ? 3600000 : 5000);

          if (cacheIsFresh) {
            // ⚡ FAST PATH: Use cached data
            const priceAboveOpen = currentPrice > (cachedCandle.open * EPSILON);
            console.log(`   ⚡ [${timeframe}] CACHE HIT: Open=${cachedCandle.open.toFixed(6)}, Above=${priceAboveOpen ? '✅' : '❌'}`);
            return {
              timeframe,
              success: true,
              open: cachedCandle.open,
              priceAboveOpen,
              source: 'cache'
            };
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
              // If API fails, use stale cache as fallback (if exists)
              if (cachedCandle && cachedCandle.open !== null) {
                const priceAboveOpen = currentPrice > (cachedCandle.open * EPSILON);
                console.log(`   ⚠️ [${timeframe}] API ${response.status}, using stale cache: Open=${cachedCandle.open}`);
                return { timeframe, success: true, open: cachedCandle.open, priceAboveOpen, source: 'stale_cache' };
              }
              return { timeframe, success: false, error: `API error ${response.status}` };
            }

            const klines = await response.json();
            if (!klines || klines.length === 0) {
              return { timeframe, success: false, error: 'No data' };
            }

            const kline = klines[0];
            const candleOpen = parseFloat(kline[1]);
            const candleStartTime = parseInt(kline[0]);

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
            return { timeframe, success: false, error: error.message };
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
          const expectedCandleStart = Math.floor(hammerNow / timeframeMs) * timeframeMs;

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

  async evaluateRSIConditions(rsiConditions, priceData, symbol = null) {
    const { condition, level, period, timeframes } = rsiConditions;
    const targetLevel = parseFloat(level) || 50;
    const rsiPeriod = parseInt(period) || 14;

    console.log(
      `📈 RSI Evaluation: ${condition} ${targetLevel} (Period: ${rsiPeriod})`
    );

    // ✅ FIX: Return false if no timeframes (condition cannot be checked)
    if (!timeframes || timeframes.length === 0 || !symbol) {
      console.log(`   ⚠️ No timeframes specified or symbol missing`);
      return false;
    }

    console.log(`   🔍 Checking ${timeframes.length} timeframes (ALL must pass)`);

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
      console.log(`   ⏳ RSI: Waiting for ${pendingTimeframes.length}/${timeframes.length} timeframes: [${pendingTimeframes.join(', ')}]`);
      console.log(`   Data will be fetched by queue system, will recheck on next price update...`);
      return false;
    }

    // ✅ PHASE 3: All data ready - NOW check conditions
    console.log(`   ✅ RSI: All ${timeframes.length} timeframes data ready, checking conditions...`);

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

  async evaluateVolumeConditions(
    volumeConditions,
    priceData,
    symbol = null,
    alert = null
  ) {
    const { condition, percentage, timeframes } = volumeConditions;
    const requiredPercentage = parseFloat(percentage) || 0;

    console.log(
      `📉 Volume Evaluation: ${condition} by ${requiredPercentage}% | Timeframes: ${timeframes?.join(", ") || "N/A"}`
    );

    if (!alert) {
      console.log(`   ⚠️ No alert object, skipping volume check`);
      return false;
    }

    // Get current 24h volume from live data
    const currentVolume = parseFloat(priceData.quoteVolume || priceData.volume24h || priceData.volume) || 0;

    // Get baseline volume from alert (saved when alert created or last triggered)
    const baselineVolume = parseFloat(alert.baselineVolume) || 0;

    console.log(`   📊 Current Volume: ${currentVolume.toLocaleString()} USDT`);
    console.log(`   📏 Baseline Volume: ${baselineVolume.toLocaleString()} USDT`);

    // If no baseline, cannot check - need to initialize
    if (baselineVolume === 0) {
      console.log(`   ⚠️ No baseline volume set, skipping (will be set on first trigger)`);
      return false;
    }

    if (currentVolume === 0) {
      console.log(`   ⚠️ Current volume is 0, skipping`);
      return false;
    }

    // ✅ Calculate volume change percentage from baseline
    const volumeChangePercent = ((currentVolume - baselineVolume) / baselineVolume) * 100;
    console.log(`   📈 Volume Change: ${volumeChangePercent.toFixed(2)}% (Required: ${condition} ${requiredPercentage}%)`);

    // ✅ Check condition based on type
    let conditionMet = false;

    switch (condition) {
      case "INCREASING":
        // Volume increased by X% or more from baseline
        conditionMet = volumeChangePercent >= requiredPercentage;
        console.log(`   ${conditionMet ? '✅' : '❌'} INCREASING: ${volumeChangePercent.toFixed(2)}% >= ${requiredPercentage}%? ${conditionMet}`);
        break;

      case "DECREASING":
        // Volume decreased by X% or more from baseline (negative change)
        conditionMet = volumeChangePercent <= -requiredPercentage;
        console.log(`   ${conditionMet ? '✅' : '❌'} DECREASING: ${volumeChangePercent.toFixed(2)}% <= -${requiredPercentage}%? ${conditionMet}`);
        break;

      case "ABOVE":
        // Current volume above absolute threshold
        conditionMet = currentVolume > requiredPercentage;
        console.log(`   ${conditionMet ? '✅' : '❌'} ABOVE: ${currentVolume.toLocaleString()} > ${requiredPercentage.toLocaleString()}? ${conditionMet}`);
        break;

      case "BELOW":
        // Current volume below absolute threshold
        conditionMet = currentVolume < requiredPercentage;
        console.log(`   ${conditionMet ? '✅' : '❌'} BELOW: ${currentVolume.toLocaleString()} < ${requiredPercentage.toLocaleString()}? ${conditionMet}`);
        break;

      default:
        console.log(`   ❌ Unknown volume condition: ${condition}`);
        conditionMet = false;
    }

    // ✅ NOTE: Baseline update happens in processAlert when alert triggers
    // Timeframes determine the baseline update interval (smallest timeframe used)
    // This is handled by the Alert Count lock mechanism based on selected timeframes

    if (conditionMet) {
      console.log(`   🎉 Volume condition MET - Alert will trigger`);
    }

    return conditionMet;
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
  addCandleToQueue(symbol, timeframe) {
    const key = `${symbol}_${timeframe}`;
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
      console.log(
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
