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

    this.initRedis();
    this.startCleanupInterval();
  }

  async initRedis() {
    try {
      this.redis = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT || 6379,
        lazyConnect: false,
        retryDelayOnClusterDown: 300,
        maxRetriesPerRequest: 3,
      });
      console.log("✅ SafeAlertProcessor Redis initialized");
    } catch (error) {
      console.error("❌ Error initializing SafeAlertProcessor Redis:", error);
    }
  }

  // Prevent race conditions by using distributed locks
  async acquireProcessingLock(alertId, symbol) {
    const lockKey = `alert:processing:${alertId}`;
    const lockValue = `${Date.now()}_${Math.random()}`;
    const lockTTL = 30; // 30 seconds lock timeout

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
      console.error(`❌ Error acquiring lock for alert ${alertId}:`, error);
      return { acquired: false, lockValue: null };
    }
  }

  async releaseProcessingLock(alertId, lockValue) {
    const lockKey = `alert:processing:${alertId}`;

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

      // Remove from in-memory locks
      this.processingLocks.delete(alertId);

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
      console.error(`❌ Error releasing lock for alert ${alertId}:`, error);
      return false;
    }
  }

  // Check if alert was recently processed (prevent duplicates)
  // NOTE: This check is disabled - we rely on alertCount lock for cooldown
  // AlertCount lock is based on candle periods and is more accurate
  isRecentlyProcessed(alertId, currentTimestamp) {
    // Disabled: AlertCount lock already handles cooldown properly
    // No need for additional 1 minute wait
    return false; // Always allow processing, rely on alertCount lock only
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
    }, 30000); // Clean every 30 seconds
  }

  cleanup() {
    const now = Date.now();
    const oldThreshold = 300000; // 5 minutes

    // Clean old processed alerts
    let cleanedProcessed = 0;
    for (const [alertId, data] of this.processedAlerts.entries()) {
      if (now - data.timestamp > oldThreshold) {
        this.processedAlerts.delete(alertId);
        cleanedProcessed++;
      }
    }

    // Clean old processing locks
    let cleanedLocks = 0;
    for (const [alertId, lock] of this.processingLocks.entries()) {
      if (now - lock.timestamp > oldThreshold) {
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
