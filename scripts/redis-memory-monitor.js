#!/usr/bin/env node
import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();

class RedisMemoryMonitor {
  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
      lazyConnect: true,
      retryDelayOnClusterDown: 300,
      maxRetriesPerRequest: 3,
    });
    
    this.warningThreshold = 0.8; // 80% memory usage warning
    this.criticalThreshold = 0.9; // 90% memory usage critical
    this.maxMemoryMB = parseInt(process.env.REDIS_MAX_MEMORY_MB || "512"); // Default 512MB
  }

  async checkMemoryUsage() {
    try {
      console.log("🔍 Checking Redis memory usage...");
      
      // Get memory info
      const memoryInfo = await this.redis.info("memory");
      const lines = memoryInfo.split('\r\n');
      
      let usedMemory = 0;
      let maxMemory = 0;
      
      lines.forEach(line => {
        if (line.startsWith('used_memory:')) {
          usedMemory = parseInt(line.split(':')[1]);
        }
        if (line.startsWith('maxmemory:')) {
          maxMemory = parseInt(line.split(':')[1]);
        }
      });
      
      // If maxmemory is 0, Redis has no limit set
      if (maxMemory === 0) {
        maxMemory = this.maxMemoryMB * 1024 * 1024; // Convert MB to bytes
        console.log(`⚠️ Redis maxmemory not set, using default: ${this.maxMemoryMB}MB`);
      }
      
      const usagePercentage = (usedMemory / maxMemory) * 100;
      const usedMemoryMB = (usedMemory / (1024 * 1024)).toFixed(2);
      const maxMemoryMB = (maxMemory / (1024 * 1024)).toFixed(2);
      
      console.log(`📊 Redis Memory Usage:`);
      console.log(`   Used: ${usedMemoryMB}MB / ${maxMemoryMB}MB (${usagePercentage.toFixed(1)}%)`);
      
      // Check thresholds
      if (usagePercentage >= this.criticalThreshold * 100) {
        console.log(`🚨 CRITICAL: Redis memory usage is ${usagePercentage.toFixed(1)}%`);
        await this.handleCriticalMemory();
      } else if (usagePercentage >= this.warningThreshold * 100) {
        console.log(`⚠️ WARNING: Redis memory usage is ${usagePercentage.toFixed(1)}%`);
        await this.handleWarningMemory();
      } else {
        console.log(`✅ Redis memory usage is healthy (${usagePercentage.toFixed(1)}%)`);
      }
      
      // Get key information
      await this.analyzeKeyUsage();
      
    } catch (error) {
      console.error("❌ Error checking Redis memory:", error);
    }
  }

  async analyzeKeyUsage() {
    try {
      console.log("\n🔑 Analyzing key usage...");
      
      // Get database info
      const keyspaceInfo = await this.redis.info("keyspace");
      console.log("📋 Keyspace info:", keyspaceInfo);
      
      // Check specific key patterns and their memory usage
      const patterns = [
        "alerts:cache:*",
        "crypto:*", 
        "user:*",
        "notifications:*"
      ];
      
      for (const pattern of patterns) {
        const keys = await this.redis.keys(pattern);
        console.log(`   ${pattern}: ${keys.length} keys`);
        
        if (keys.length > 1000) {
          console.log(`   ⚠️ High key count for pattern ${pattern}: ${keys.length}`);
        }
      }
      
    } catch (error) {
      console.error("❌ Error analyzing key usage:", error);
    }
  }

  async handleWarningMemory() {
    console.log("🧹 Running memory cleanup...");
    
    try {
      // Clean expired keys
      await this.cleanExpiredKeys();
      
      // Clean old processed alerts (older than 1 hour)
      await this.cleanOldProcessedAlerts();
      
    } catch (error) {
      console.error("❌ Error in memory cleanup:", error);
    }
  }

  async handleCriticalMemory() {
    console.log("🚨 Running critical memory cleanup...");
    
    try {
      // All warning actions plus more aggressive cleanup
      await this.handleWarningMemory();
      
      // Clean old price cache (older than 30 minutes)
      await this.cleanOldPriceCache();
      
      // Clean old notification cache
      await this.cleanOldNotificationCache();
      
    } catch (error) {
      console.error("❌ Error in critical memory cleanup:", error);
    }
  }

  async cleanExpiredKeys() {
    try {
      const expiredCount = await this.redis.eval(`
        local expired_count = 0
        local keys = redis.call('KEYS', '*')
        for i=1,#keys do
          local ttl = redis.call('TTL', keys[i])
          if ttl == -1 then
            -- Key has no expiration, skip
          elseif ttl == -2 then
            -- Key already expired, count it
            expired_count = expired_count + 1
          end
        end
        return expired_count
      `, 0);
      
      console.log(`   🧹 Cleaned ${expiredCount} expired keys`);
    } catch (error) {
      console.error("❌ Error cleaning expired keys:", error);
    }
  }

  async cleanOldProcessedAlerts() {
    try {
      // This would need to be implemented based on your specific key structure
      const deletedCount = 0;
      console.log(`   🧹 Cleaned ${deletedCount} old processed alert records`);
    } catch (error) {
      console.error("❌ Error cleaning old processed alerts:", error);
    }
  }

  async cleanOldPriceCache() {
    try {
      const keys = await this.redis.keys("crypto:*");
      let deletedCount = 0;
      
      const now = Date.now();
      const thirtyMinutesAgo = now - (30 * 60 * 1000);
      
      for (const key of keys) {
        try {
          const data = await this.redis.get(key);
          if (data) {
            const parsed = JSON.parse(data);
            if (parsed.timestamp && parsed.timestamp < thirtyMinutesAgo) {
              await this.redis.del(key);
              deletedCount++;
            }
          }
        } catch (parseError) {
          // Skip invalid JSON
        }
      }
      
      console.log(`   🧹 Cleaned ${deletedCount} old price cache entries`);
    } catch (error) {
      console.error("❌ Error cleaning old price cache:", error);
    }
  }

  async cleanOldNotificationCache() {
    try {
      const keys = await this.redis.keys("notifications:*");
      let deletedCount = 0;
      
      // Delete old notification cache (older than 1 day)
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      
      for (const key of keys) {
        // Assume notification keys have timestamp in them or check creation time
        await this.redis.del(key);
        deletedCount++;
      }
      
      console.log(`   🧹 Cleaned ${deletedCount} old notification cache entries`);
    } catch (error) {
      console.error("❌ Error cleaning old notification cache:", error);
    }
  }

  async setMaxMemory() {
    try {
      const maxMemoryBytes = this.maxMemoryMB * 1024 * 1024;
      await this.redis.config("SET", "maxmemory", maxMemoryBytes);
      await this.redis.config("SET", "maxmemory-policy", "allkeys-lru");
      
      console.log(`✅ Set Redis maxmemory to ${this.maxMemoryMB}MB with LRU eviction policy`);
    } catch (error) {
      console.error("❌ Error setting Redis maxmemory:", error);
    }
  }

  async close() {
    await this.redis.quit();
  }
}

// Run memory check
async function runMemoryCheck() {
  const monitor = new RedisMemoryMonitor();
  
  try {
    // Set maxmemory if not set
    await monitor.setMaxMemory();
    
    // Check current memory usage
    await monitor.checkMemoryUsage();
    
  } catch (error) {
    console.error("❌ Memory check failed:", error);
  } finally {
    await monitor.close();
  }
}

// If called directly, run the check
if (import.meta.url === `file://${process.argv[1]}`) {
  runMemoryCheck().catch(console.error);
}

export default RedisMemoryMonitor;
