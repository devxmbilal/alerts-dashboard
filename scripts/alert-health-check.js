#!/usr/bin/env node
import Redis from "ioredis";
import WebSocket from "ws";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
dotenv.config();

class AlertSystemHealthCheck {
  constructor() {
    this.redis = null;
    this.healthStatus = {
      redis: false,
      websocket: false,
      alertProcessor: false,
      memoryUsage: 0,
      lastCheck: Date.now()
    };
    
    this.thresholds = {
      memoryWarning: 0.8, // 80%
      memoryCritical: 0.9, // 90%
      responseTimeWarning: 1000, // 1 second
      responseTimeCritical: 5000 // 5 seconds
    };
  }

  async runHealthCheck() {
    console.log("🏥 Running Alert System Health Check...");
    
    try {
      // Check Redis connection
      await this.checkRedis();
      
      // Check WebSocket connectivity
      await this.checkWebSocket();
      
      // Check Alert Processor status
      await this.checkAlertProcessor();
      
      // Check system memory
      this.checkSystemMemory();
      
      // Generate health report
      this.generateHealthReport();
      
      // Take corrective actions if needed
      await this.takeCorrectiveActions();
      
    } catch (error) {
      console.error("❌ Health check failed:", error);
      this.healthStatus.lastError = error.message;
    } finally {
      if (this.redis) {
        await this.redis.quit();
      }
    }
  }

  async checkRedis() {
    console.log("🔍 Checking Redis connection...");
    
    try {
      const startTime = Date.now();
      
      this.redis = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT || 6379,
        lazyConnect: true,
        connectTimeout: 5000,
        commandTimeout: 3000,
      });
      
      // Test basic operations
      await this.redis.ping();
      const responseTime = Date.now() - startTime;
      
      // Test set/get operations
      const testKey = `health:check:${Date.now()}`;
      await this.redis.set(testKey, "test", "EX", 10);
      const testValue = await this.redis.get(testKey);
      await this.redis.del(testKey);
      
      if (testValue === "test") {
        this.healthStatus.redis = true;
        this.healthStatus.redisResponseTime = responseTime;
        console.log(`✅ Redis OK (${responseTime}ms)`);
        
        if (responseTime > this.thresholds.responseTimeWarning) {
          console.log(`⚠️ Redis response time is high: ${responseTime}ms`);
        }
      } else {
        throw new Error("Redis test operation failed");
      }
      
    } catch (error) {
      this.healthStatus.redis = false;
      this.healthStatus.redisError = error.message;
      console.log(`❌ Redis connection failed: ${error.message}`);
    }
  }

  async checkWebSocket() {
    console.log("🔍 Checking WebSocket connectivity...");
    
    return new Promise((resolve) => {
      try {
        const startTime = Date.now();
        const ws = new WebSocket("wss://stream.binance.com:9443/ws/!ticker@arr");
        
        const timeout = setTimeout(() => {
          ws.close();
          this.healthStatus.websocket = false;
          this.healthStatus.websocketError = "Connection timeout";
          console.log("❌ WebSocket connection timeout");
          resolve();
        }, 10000); // 10 second timeout
        
        ws.on("open", () => {
          const responseTime = Date.now() - startTime;
          this.healthStatus.websocket = true;
          this.healthStatus.websocketResponseTime = responseTime;
          console.log(`✅ WebSocket OK (${responseTime}ms)`);
          
          clearTimeout(timeout);
          ws.close();
          resolve();
        });
        
        ws.on("error", (error) => {
          this.healthStatus.websocket = false;
          this.healthStatus.websocketError = error.message;
          console.log(`❌ WebSocket error: ${error.message}`);
          
          clearTimeout(timeout);
          resolve();
        });
        
      } catch (error) {
        this.healthStatus.websocket = false;
        this.healthStatus.websocketError = error.message;
        console.log(`❌ WebSocket check failed: ${error.message}`);
        resolve();
      }
    });
  }

  async checkAlertProcessor() {
    console.log("🔍 Checking Alert Processor status...");
    
    try {
      if (!this.redis) {
        throw new Error("Redis not available for Alert Processor check");
      }
      
      // Check if alert processor is running by looking for heartbeat
      const heartbeatKey = "alert:processor:heartbeat";
      const lastHeartbeat = await this.redis.get(heartbeatKey);
      
      if (lastHeartbeat) {
        const lastHeartbeatTime = parseInt(lastHeartbeat);
        const timeSinceHeartbeat = Date.now() - lastHeartbeatTime;
        
        // Consider processor healthy if heartbeat is within last 2 minutes
        if (timeSinceHeartbeat < 120000) {
          this.healthStatus.alertProcessor = true;
          this.healthStatus.processorLastSeen = timeSinceHeartbeat;
          console.log(`✅ Alert Processor OK (last seen ${Math.round(timeSinceHeartbeat/1000)}s ago)`);
        } else {
          this.healthStatus.alertProcessor = false;
          this.healthStatus.processorError = `Last heartbeat too old: ${Math.round(timeSinceHeartbeat/1000)}s`;
          console.log(`⚠️ Alert Processor heartbeat is old: ${Math.round(timeSinceHeartbeat/1000)}s`);
        }
      } else {
        this.healthStatus.alertProcessor = false;
        this.healthStatus.processorError = "No heartbeat found";
        console.log("❌ Alert Processor heartbeat not found");
      }
      
      // Check active alerts count
      const alertsPattern = "alerts:cache:*";
      const alertKeys = await this.redis.keys(alertsPattern);
      this.healthStatus.activeAlertCaches = alertKeys.length;
      console.log(`📊 Active alert caches: ${alertKeys.length}`);
      
    } catch (error) {
      this.healthStatus.alertProcessor = false;
      this.healthStatus.processorError = error.message;
      console.log(`❌ Alert Processor check failed: ${error.message}`);
    }
  }

  checkSystemMemory() {
    console.log("🔍 Checking system memory...");
    
    try {
      const memoryUsage = process.memoryUsage();
      const totalMem = memoryUsage.rss + memoryUsage.heapUsed + memoryUsage.external;
      
      // Get system memory (approximate)
      const osTotalMem = 1024 * 1024 * 1024; // Assume 1GB for now (you might want to get actual system memory)
      const memoryUsagePercent = totalMem / osTotalMem;
      
      this.healthStatus.memoryUsage = memoryUsagePercent;
      this.healthStatus.memoryDetails = {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
        total: Math.round(totalMem / 1024 / 1024)
      };
      
      console.log(`📊 Memory usage: ${Math.round(memoryUsagePercent * 100)}%`);
      console.log(`   RSS: ${this.healthStatus.memoryDetails.rss}MB`);
      console.log(`   Heap: ${this.healthStatus.memoryDetails.heapUsed}MB`);
      
      if (memoryUsagePercent > this.thresholds.memoryCritical) {
        console.log(`🚨 CRITICAL: Memory usage is very high (${Math.round(memoryUsagePercent * 100)}%)`);
      } else if (memoryUsagePercent > this.thresholds.memoryWarning) {
        console.log(`⚠️ WARNING: Memory usage is high (${Math.round(memoryUsagePercent * 100)}%)`);
      }
      
    } catch (error) {
      console.log(`❌ Memory check failed: ${error.message}`);
      this.healthStatus.memoryError = error.message;
    }
  }

  generateHealthReport() {
    console.log("\n📊 =============  HEALTH REPORT  =============");
    
    const overallHealth = this.healthStatus.redis && 
                         this.healthStatus.websocket && 
                         this.healthStatus.alertProcessor;
    
    console.log(`🏥 Overall Status: ${overallHealth ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
    console.log(`📅 Check Time: ${new Date().toISOString()}`);
    
    console.log("\n🔧 Component Status:");
    console.log(`   Redis: ${this.healthStatus.redis ? '✅' : '❌'} ${this.healthStatus.redisResponseTime ? `(${this.healthStatus.redisResponseTime}ms)` : ''}`);
    console.log(`   WebSocket: ${this.healthStatus.websocket ? '✅' : '❌'} ${this.healthStatus.websocketResponseTime ? `(${this.healthStatus.websocketResponseTime}ms)` : ''}`);
    console.log(`   Alert Processor: ${this.healthStatus.alertProcessor ? '✅' : '❌'} ${this.healthStatus.processorLastSeen ? `(${Math.round(this.healthStatus.processorLastSeen/1000)}s ago)` : ''}`);
    
    if (this.healthStatus.memoryDetails) {
      console.log(`   Memory: ${Math.round(this.healthStatus.memoryUsage * 100)}% (${this.healthStatus.memoryDetails.total}MB)`);
    }
    
    console.log(`   Active Alert Caches: ${this.healthStatus.activeAlertCaches || 'Unknown'}`);
    
    // Show errors if any
    if (this.healthStatus.redisError) {
      console.log(`❌ Redis Error: ${this.healthStatus.redisError}`);
    }
    if (this.healthStatus.websocketError) {
      console.log(`❌ WebSocket Error: ${this.healthStatus.websocketError}`);
    }
    if (this.healthStatus.processorError) {
      console.log(`❌ Processor Error: ${this.healthStatus.processorError}`);
    }
    
    console.log("==========================================\n");
    
    // Write health status to file
    this.writeHealthStatusFile();
  }

  writeHealthStatusFile() {
    try {
      const healthFile = path.join(process.cwd(), 'tmp', 'health-status.json');
      
      // Ensure tmp directory exists
      const tmpDir = path.dirname(healthFile);
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      
      const healthData = {
        ...this.healthStatus,
        timestamp: Date.now(),
        timestamp_iso: new Date().toISOString()
      };
      
      fs.writeFileSync(healthFile, JSON.stringify(healthData, null, 2));
      console.log(`📁 Health status written to: ${healthFile}`);
      
    } catch (error) {
      console.log(`⚠️ Could not write health status file: ${error.message}`);
    }
  }

  async takeCorrectiveActions() {
    console.log("🔧 Checking if corrective actions are needed...");
    
    let actionsTaken = [];
    
    // If Redis is down, try to restart it (if we have permission)
    if (!this.healthStatus.redis) {
      console.log("🚨 Redis is down - manual intervention required");
      actionsTaken.push("Redis down - manual restart required");
    }
    
    // If WebSocket is down, alert system will auto-reconnect
    if (!this.healthStatus.websocket) {
      console.log("⚠️ WebSocket connection failed - system should auto-reconnect");
      actionsTaken.push("WebSocket down - auto-reconnect expected");
    }
    
    // If Alert Processor is down, we might need to restart the worker
    if (!this.healthStatus.alertProcessor) {
      console.log("🚨 Alert Processor is not responding - check worker process");
      actionsTaken.push("Alert Processor down - check worker process");
      
      // Try to send restart signal via Redis if Redis is working
      if (this.healthStatus.redis && this.redis) {
        try {
          await this.redis.publish("system:control", JSON.stringify({
            command: "restart_alert_processor",
            timestamp: Date.now()
          }));
          console.log("📡 Sent restart signal to alert processor");
          actionsTaken.push("Sent restart signal via Redis");
        } catch (error) {
          console.log(`❌ Could not send restart signal: ${error.message}`);
        }
      }
    }
    
    // If memory usage is critical, trigger cleanup
    if (this.healthStatus.memoryUsage > this.thresholds.memoryCritical) {
      console.log("🧹 Triggering emergency memory cleanup");
      actionsTaken.push("Triggered memory cleanup");
      
      if (this.redis) {
        try {
          await this.redis.publish("system:control", JSON.stringify({
            command: "emergency_cleanup",
            timestamp: Date.now()
          }));
          console.log("📡 Sent emergency cleanup signal");
        } catch (error) {
          console.log(`❌ Could not send cleanup signal: ${error.message}`);
        }
      }
    }
    
    if (actionsTaken.length > 0) {
      console.log("🔧 Actions taken:");
      actionsTaken.forEach(action => console.log(`   • ${action}`));
    } else {
      console.log("✅ No corrective actions needed");
    }
  }
}

// Run health check
async function runHealthCheck() {
  const healthCheck = new AlertSystemHealthCheck();
  await healthCheck.runHealthCheck();
}

// If called directly, run the health check
if (import.meta.url === `file://${process.argv[1]}`) {
  runHealthCheck().catch(console.error);
}

export default AlertSystemHealthCheck;
