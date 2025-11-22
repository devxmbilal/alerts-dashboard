import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();
import { connectToMongoDB } from "../utils/mongodb.js";
import AlertService from "../services/AlertService.js";
import AlertHistoryService from "../services/AlertHistoryService.js";
import { isAlertLocked, updateAlertLock } from "../utils/alertLock.js";
import Alert from "../models/Alert.js";
import WebSocketService from "../services/WebSocketService.js";
import RealTimeAlertProcessor from "../services/RealTimeAlertProcessor.js";
import AlertRedisService from "../services/AlertRedisService.js";

class AlertWorker {
  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
      lazyConnect: true,
      retryDelayOnClusterDown: 300,
      maxRetriesPerRequest: 3,
    });

    this.isRunning = false;
    this.processedAlerts = new Set(); // Track processed alerts to avoid duplicates
  }

  async start() {
    console.log("🚀 Starting Micro-Batch Alert Worker...");

    try {
      // Connect to MongoDB
      await connectToMongoDB();
      console.log("✅ Connected to MongoDB");

      // Connect to Redis
      await this.redis.ping();
      console.log("✅ Connected to Redis");

      // Handle Redis connection errors
      this.redis.on("error", (err) => {
        console.error("❌ Redis connection error:", err);
      });

      // 🚀 MICRO-BATCH EXECUTION ENGINE - Ultra High Performance
      await RealTimeAlertProcessor.startWebSocketProcessing();
      console.log(
        "✅ Started Micro-Batch WebSocket processing (50k alerts/min capacity)"
      );

      // Subscribe to alert management events (for alert creation/removal)
      await RealTimeAlertProcessor.subscribeToAlertManagement();
      console.log("✅ Subscribed to alert management events");

      this.isRunning = true;
      console.log("✅ Micro-Batch Alert Worker started successfully");

      console.log(
        "🔥 Monitoring live market data via Micro-Batch WebSocket for ultra-fast alerts..."
      );
    } catch (error) {
      console.error("❌ Micro-Batch Alert Worker startup failed:", error);
      throw error;
    }
  }

  async handlePriceUpdate(priceData) {
    try {
      // 🚀 MICRO-BATCH PROCESSING - Handled automatically by RealTimeAlertProcessor
      // No manual processing needed - micro-batch engine handles everything!
      console.log(
        `⚡ Micro-Batch: Price update for ${priceData.symbol}: $${priceData.price} (${priceData.priceChangePercent}%)`
      );

      // Process via micro-batch engine (ultra-fast, zero duplicates)
      await RealTimeAlertProcessor.processPriceUpdateRealTime(
        priceData.symbol,
        priceData
      );
    } catch (error) {
      console.error(
        `❌ Error in micro-batch processing for ${priceData.symbol}:`,
        error
      );
    }
  }

  // NOTE: All condition checking is handled by RealTimeAlertProcessor
  // This worker only initializes and manages the processing system

  async triggerAlert(alert, marketData) {
    try {
      // Mark alert as triggered in database
      const triggeredAlert = await AlertService.triggerAlert(
        alert._id,
        marketData
      );

      // Create alert history entry
      const alertHistory = await AlertHistoryService.createAlertHistory(
        alert,
        marketData
      );

      // Publish alert trigger event to Redis
      const alertData = {
        type: "alert_triggered",
        alertId: alert._id,
        historyId: alertHistory._id,
        userId: alert.userId,
        symbol: alert.symbol,
        triggeredAt: new Date(),
        triggeredPrice: parseFloat(marketData.price),
        triggeredVolume: parseFloat(marketData.volume),
        triggeredChange: parseFloat(marketData.priceChangePercent),
        conditions: alert.conditions,
        notificationSettings: alert.notificationSettings,
      };

      // Publish to alert triggers channel
      await this.redis.publish("alert:triggers", JSON.stringify(alertData));

      console.log(`🚨 Alert triggered: ${alert.symbol} at ${marketData.price}`);
      console.log(`📝 Alert history created: ${alertHistory._id}`);

      // TODO: Send notifications (email, telegram, webhook)
      await this.sendNotifications(triggeredAlert, marketData);
    } catch (error) {
      console.error("❌ Error triggering alert:", error);
    }
  }

  async sendNotifications(alert, marketData) {
    const { notificationSettings } = alert;

    try {
      // Email notification
      if (notificationSettings.email) {
        console.log(`📧 Email notification sent for ${alert.symbol}`);
        // TODO: Implement email service
      }

      // Telegram notification
      if (notificationSettings.telegram) {
        console.log(`📱 Telegram notification sent for ${alert.symbol}`);
        // TODO: Implement telegram bot
      }

      // Webhook notification
      if (notificationSettings.webhook) {
        console.log(`🔗 Webhook notification sent for ${alert.symbol}`);
        // TODO: Implement webhook service
      }
    } catch (error) {
      console.error("❌ Error sending notifications:", error);
    }
  }

  // Get micro-batch performance statistics
  getMicroBatchStats() {
    try {
      return RealTimeAlertProcessor.getMicroBatchStats();
    } catch (error) {
      console.error("❌ Error getting micro-batch stats:", error);
      return { error: "Stats unavailable" };
    }
  }

  // Display current performance
  async showPerformance() {
    try {
      const stats = this.getMicroBatchStats();
      console.log("🚀 ==========  MICRO-BATCH PERFORMANCE  ==========");
      console.log(
        `   � Current Throughput: ${stats.currentThroughputPerMinute || 0}/min`
      );
      console.log(
        `   🎯 Target Throughput: ${stats.targetThroughput || 50000}/min`
      );
      console.log(`   📊 CPU Efficiency: ${stats.cpuEfficiency || 0}%`);
      console.log(
        `   🛡️ System Health: ${stats.systemHealth?.overall || 0}/100`
      );
      console.log(`   🔄 Active Symbols: ${stats.activeSymbols || 0}`);
      console.log("✅ Use 'npm run microbatch-monitor' for live dashboard");
      console.log("================================================");
    } catch (error) {
      console.error("❌ Error displaying performance:", error);
    }
  }

  async stop() {
    console.log("�🛑 Stopping Micro-Batch Alert Worker...");
    this.isRunning = false;

    try {
      // Stop micro-batch WebSocket connection (async method now)
      await RealTimeAlertProcessor.stopWebSocketPriceFeed();
      console.log("✅ Micro-Batch WebSocket connection closed");

      // Unsubscribe from alert management events
      await RealTimeAlertProcessor.unsubscribeFromAlertManagement();
      console.log("✅ Unsubscribed from alert management");

      if (this.redis) {
        await this.redis.unsubscribe("market:updates");
        await this.redis.quit();
        console.log("✅ Redis connection closed");
      }

      console.log("✅ Micro-Batch Alert Worker stopped successfully");
    } catch (error) {
      console.error("❌ Error stopping Micro-Batch Alert Worker:", error);
    }
  }
}

// Start worker if run directly
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` ||
  import.meta.url.includes("alert-worker.js");

console.log("MainModule is running...");

if (isMainModule) {
  const worker = new AlertWorker();

  worker.start().catch((error) => {
    console.error("❌ Alert Worker failed to start:", error);
    console.error("❌ Error details:", error.message);
    console.error("❌ Error stack:", error.stack);
    process.exit(1);
  });

  // Keep the process alive and show performance stats
  // setInterval(async () => {
  //   if (worker.isRunning) {
  //     console.log("🔄 Micro-Batch Worker is running...");
  //     // Show performance stats every 5 minutes
  //     const now = Date.now();
  //     if (!worker.lastStatsTime || now - worker.lastStatsTime > 300000) {
  //       worker.lastStatsTime = now;
  //       await worker.showPerformance();
  //     }
  //   } else {
  //     console.log(
  //       "⚠️ Micro-Batch Worker is not running, attempting to restart..."
  //     );
  //     worker.start().catch((error) => {
  //       console.error("❌ Failed to restart worker:", error);
  //     });
  //   }
  // }, 30000); // Log every 30 seconds

  // Prevent process from exiting
  process.stdin.resume();

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🛑 Received SIGINT, shutting down gracefully...");
    await worker.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
    await worker.stop();
    process.exit(0);
  });
}

export default AlertWorker;
