// Enhanced Alert Processing with Race Condition Protection
import Redis from "ioredis";
import { isAlertLocked, updateAlertLock } from "./alertLock.js";

export class SafeAlertProcessor {
  constructor() {
    this.redis = null;
    this.processingLocks = new Map(); // In-memory locks to prevent race conditions
    this.alertQueue = new Map(); // Queue alerts per symbol to prevent parallel processing
    this.processedAlerts = new Map(); // Track processed alerts with timestamps
    this.cleanupInterval = null;
    this.isRedisConnected = false;

    this.initRedis();
    this.startCleanupInterval();
  }

  async initRedis() {
    try {
      this.redis = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT || 6379,
        lazyConnect: false,
        retryStrategy: (times) => {
          // Reconnect after delay: first few attempts quick, then slow down
          const delay = Math.min(times * 200, 5000);
          console.log(`🔄 Redis reconnecting in ${delay}ms (attempt ${times})...`);
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        reconnectOnError: (err) => {
          // Reconnect on specific errors
          const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNABORTED'];
          if (targetErrors.some(e => err.message.includes(e))) {
            console.log(`🔄 Redis reconnecting due to: ${err.message}`);
            return true;
          }
          return false;
        },
      });

      // Event handlers for connection stability
      this.redis.on('connect', () => {
        console.log('🔌 Redis connecting...');
      });

      this.redis.on('ready', () => {
        this.isRedisConnected = true;
        console.log('✅ SafeAlertProcessor Redis ready');
      });

      this.redis.on('error', (err) => {
        console.error('❌ SafeAlertProcessor Redis error:', err.message);
        this.isRedisConnected = false;
      });

      this.redis.on('close', () => {
        console.warn('⚠️ SafeAlertProcessor Redis connection closed');
        this.isRedisConnected = false;
      });

      this.redis.on('reconnecting', () => {
        console.log('🔄 SafeAlertProcessor Redis reconnecting...');
      });

      this.redis.on('end', () => {
        console.warn('⚠️ SafeAlertProcessor Redis connection ended');
        this.isRedisConnected = false;
      });

    } catch (error) {
      console.error("❌ Error initializing SafeAlertProcessor Redis:", error);
      this.isRedisConnected = false;
    }
  }

  // Check if Redis is available before operations
  isRedisAvailable() {
    return this.redis && this.isRedisConnected && this.redis.status === 'ready';
  }

  // Prevent race conditions by using distributed locks
  async acquireProcessingLock(alertId, symbol) {
    const lockKey = `alert:processing:${alertId}`;
    const lockValue = `${Date.now()}_${Math.random()}`;
    const lockTTL = 1; // 🔥 REDUCED: 1 second (was 5s - caused missed alerts)

    // Check if Redis is available
    if (!this.isRedisAvailable()) {
      console.warn(`⚠️ Redis unavailable, using in-memory lock for ${alertId}`);
      // Fallback to in-memory lock only
      if (this.processingLocks.has(alertId)) {
        const existingLock = this.processingLocks.get(alertId);
        if (Date.now() - existingLock.timestamp < lockTTL * 1000) {
          return { acquired: false, lockValue: null };
        }
      }
      this.processingLocks.set(alertId, {
        timestamp: Date.now(),
        lockValue: lockValue,
        symbol: symbol,
      });
      return { acquired: true, lockValue: lockValue };
    }

    try {
      // Try to acquire Redis lock first (distributed lock across multiple instances)
      const acquired = await this.redis.set(
        lockKey,
        lockValue,
        "PX",
        lockTTL * 1000,
        "NX"
      );

      if (acquired) {
        // Also set in-memory lock for faster local checks
        this.processingLocks.set(alertId, {
          timestamp: Date.now(),
          lockValue: lockValue,
          symbol: symbol,
        });

        console.log(`🔒 Acquired processing lock for alert ${alertId}`);
        return { acquired: true, lockValue: lockValue };
      }

      console.log(`⏸️ Processing lock already exists for alert ${alertId}`);
      return { acquired: false, lockValue: null };
    } catch (error) {
      console.error(`❌ Error acquiring lock for alert ${alertId}:`, error.message);
      // Fallback to in-memory lock on Redis error
      this.processingLocks.set(alertId, {
        timestamp: Date.now(),
        lockValue: lockValue,
        symbol: symbol,
      });
      return { acquired: true, lockValue: lockValue };
    }
  }

  async releaseProcessingLock(alertId, lockValue) {
    const lockKey = `alert:processing:${alertId}`;

    // Always remove from in-memory locks first
    this.processingLocks.delete(alertId);

    // Skip Redis if not available
    if (!this.isRedisAvailable()) {
      console.warn(`⚠️ Redis unavailable, skipping Redis lock release for ${alertId}`);
      return true;
    }

    try {
      // Use Lua script to ensure we only delete our own lock
      const script = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;

      const result = await this.redis.eval(script, 1, lockKey, lockValue);

      if (result === 1) {
        console.log(`🔓 Released processing lock for alert ${alertId}`);
        return true;
      } else {
        console.log(
          `⚠️ Lock for alert ${alertId} was already released or expired`
        );
        return false;
      }
    } catch (error) {
      console.error(`❌ Error releasing lock for alert ${alertId}:`, error.message);
      return true; // Return true since in-memory lock was already removed
    }
  }

  // Check if alert was recently processed (prevent duplicates)
  // NOTE: This check is disabled - we rely on alertCount lock for cooldown
  // AlertCount lock is based on candle periods and is more accurate
  isRecentlyProcessed(alertId, currentTimestamp) {
    const processed = this.processedAlerts.get(alertId);
    if (!processed) return false;

    // Consider alert recently processed if within last 60 seconds
    const timeDiff = currentTimestamp - processed.timestamp;
    return timeDiff < 10000; // 10 seconds
  }

  // Mark alert as processed
  markAsProcessed(alertId, symbol, price, timestamp = Date.now()) {
    this.processedAlerts.set(alertId, {
      timestamp: timestamp,
      symbol: symbol,
      price: price,
    });
  }

  // Safe alert processing with race condition protection
  async processAlertSafely(alert, liveData, processingFunction) {
    const alertId = alert._id.toString();
    const currentTimestamp = Date.now();

    try {
      // Step 1: Check if alert is locked (business logic lock - alertCount)
      // NOTE: Removed 1 minute wait check - alertCount lock is sufficient
      if (isAlertLocked(alert)) {
        console.log(`🔒 Alert ${alertId} is locked, skipping`);
        return { success: false, reason: "alert_locked" };
      }

      // Step 2: Acquire processing lock (prevent race conditions)
      const lock = await this.acquireProcessingLock(alertId, alert.symbol);
      if (!lock.acquired) {
        console.log(
          `⏸️ Alert ${alertId} is being processed by another instance, skipping`
        );
        return { success: false, reason: "processing_lock_exists" };
      }

      try {
        // Step 3: Process the alert using provided function
        console.log(`🚀 Processing alert ${alertId} for ${alert.symbol}`);
        const result = await processingFunction(alert, liveData);

        // Step 4: Mark as processed if successful (for statistics only)
        // NOTE: We don't use this for blocking anymore - alertCount lock handles cooldown
        if (result && result.triggered) {
          this.markAsProcessed(
            alertId,
            alert.symbol,
            liveData.price,
            currentTimestamp
          );
          console.log(`✅ Alert ${alertId} processed successfully`);
          return { success: true, result: result };
        } else {
          console.log(`ℹ️ Alert ${alertId} processed but not triggered`);
          return { success: true, result: result };
        }
      } finally {
        // Step 5: Always release the processing lock
        await this.releaseProcessingLock(alertId, lock.lockValue);
      }
    } catch (error) {
      console.error(`❌ Error in safe alert processing for ${alertId}:`, error);
      return {
        success: false,
        reason: "processing_error",
        error: error.message,
      };
    }
  }

  // Queue-based processing to prevent symbol-level race conditions
  async queueAlertForProcessing(symbol, alert, liveData, processingFunction) {
    // Create queue for symbol if it doesn't exist
    if (!this.alertQueue.has(symbol)) {
      this.alertQueue.set(symbol, []);
    }

    const queue = this.alertQueue.get(symbol);

    // Add alert to queue
    queue.push({
      alert: alert,
      liveData: liveData,
      processingFunction: processingFunction,
      timestamp: Date.now(),
    });

    // Process queue if not already processing
    if (queue.length === 1) {
      this.processAlertQueue(symbol);
    }
  }

  async processAlertQueue(symbol) {
    const queue = this.alertQueue.get(symbol);
    if (!queue || queue.length === 0) return;

    while (queue.length > 0) {
      const item = queue.shift();

      try {
        // Check if item is too old (older than 5 seconds)
        const age = Date.now() - item.timestamp;
        if (age > 5000) {
          console.log(
            `⚠️ Dropping old queued alert for ${symbol} (age: ${age}ms)`
          );
          continue;
        }

        // Process the alert safely
        await this.processAlertSafely(
          item.alert,
          item.liveData,
          item.processingFunction
        );
      } catch (error) {
        console.error(`❌ Error processing queued alert for ${symbol}:`, error);
      }
    }

    // Clean up empty queue
    if (queue.length === 0) {
      this.alertQueue.delete(symbol);
    }
  }

  // Cleanup old processed alerts and locks
  startCleanupInterval() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5000); // CRITICAL FIX: Clean every 5 seconds to prevent stuck locks
  }

  cleanup() {
    const now = Date.now();
    const processedThreshold = 60000; // 1 minute for processed alerts
    const lockThreshold = 10000; // 10 seconds for processing locks

    // Clean old processed alerts
    let cleanedProcessed = 0;
    for (const [alertId, data] of this.processedAlerts.entries()) {
      if (now - data.timestamp > processedThreshold) {
        this.processedAlerts.delete(alertId);
        cleanedProcessed++;
      }
    }

    // CRITICAL FIX: Clean old processing locks more aggressively
    let cleanedLocks = 0;
    for (const [alertId, lock] of this.processingLocks.entries()) {
      if (now - lock.timestamp > lockThreshold) {
        this.processingLocks.delete(alertId);
        cleanedLocks++;
      }
    }

    if (cleanedProcessed > 0 || cleanedLocks > 0) {
      console.log(
        `🧹 Cleaned ${cleanedProcessed} processed alerts and ${cleanedLocks} old locks`
      );
    }
  }

  // CRITICAL FIX: Force clear all processing locks
  async clearAllProcessingLocks() {
    console.log(`🧹 Force clearing ${this.processingLocks.size} processing locks...`);

    // Clear Redis locks
    const lockKeys = [];
    for (const alertId of this.processingLocks.keys()) {
      lockKeys.push(`alert:processing:${alertId}`);
    }

    if (lockKeys.length > 0 && this.redis) {
      try {
        await this.redis.del(...lockKeys);
        console.log(`✅ Cleared ${lockKeys.length} Redis processing locks`);
      } catch (error) {
        console.error(`❌ Error clearing Redis locks:`, error.message);
      }
    }

    // Clear in-memory locks
    this.processingLocks.clear();
    this.processedAlerts.clear();

    console.log(`✅ All processing locks cleared`);
  }

  // Get processing statistics
  getStats() {
    return {
      activeProcessingLocks: this.processingLocks.size,
      recentlyProcessedAlerts: this.processedAlerts.size,
      activeQueues: this.alertQueue.size,
      totalQueuedAlerts: Array.from(this.alertQueue.values()).reduce(
        (total, queue) => total + queue.length,
        0
      ),
    };
  }

  async close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    if (this.redis) {
      await this.redis.quit();
    }
  }
}

export default SafeAlertProcessor;
