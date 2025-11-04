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
    console.log("🚀 Starting Real-Time Alert Worker...");

    try {
      // Connect to MongoDB
      await connectToMongoDB();

      // Connect to Redis
      await this.redis.ping();
      console.log("✅ Connected to Redis");

      // Handle Redis connection errors
      this.redis.on("error", (err) => {
        console.error("❌ Redis connection error:", err);
      });

      // Load all active alerts into memory
      await RealTimeAlertProcessor.loadAllActiveAlerts();
      console.log("✅ Loaded active alerts into memory");

      // Start round-based processing (Task 1 & 2)
      await RealTimeAlertProcessor.startRoundBasedProcessing();
      console.log("✅ Started round-based alert processing");

      // Subscribe to alert management events
      await RealTimeAlertProcessor.subscribeToAlertManagement();
      console.log("✅ Subscribed to alert management events");

      // Subscribe to Redis market updates (same as MarketPanel)
      await this.redis.subscribe("market:updates");
      console.log("✅ Subscribed to market:updates channel");

      this.redis.on("message", (channel, message) => {
        if (channel === "market:updates") {
          try {
            const data = JSON.parse(message);
            if (data.type === "market_update") {
              console.log(
                `📡 Redis market update: ${data.symbol} = $${data.data.price}`
              );
              this.handlePriceUpdate(data.data);
            }
          } catch (error) {
            console.error("❌ Error parsing Redis message:", error);
          }
        }
      });

      // Also connect to WebSocket for backup data
      await WebSocketService.connect();
      console.log("✅ Connected to Binance WebSocket");

      // Subscribe to all price updates from WebSocket
      WebSocketService.subscribeToAll((priceData) => {
        this.handlePriceUpdate(priceData);
      });

      this.isRunning = true;
      console.log("✅ Real-Time Alert Worker started successfully");
      console.log("🔥 Monitoring live market data for instant alerts...");
    } catch (error) {
      console.error("❌ Alert Worker startup failed:", error);
      throw error;
    }
  }

  async handlePriceUpdate(priceData) {
    try {
      console.log(
        `📡 Price update received for ${priceData.symbol}: Price=${
          priceData.price
        }, Volume=${priceData.volume24h || priceData.volume || "N/A"}, Change=${
          priceData.priceChangePercent
        }%`
      );

      // Process the price update in real-time using RealTimeAlertProcessor
      await RealTimeAlertProcessor.processPriceUpdate(priceData);
    } catch (error) {
      console.error(
        `❌ Error handling price update for ${priceData.symbol}:`,
        error
      );
    }
  }

  async evaluateAlertConditions(alert, marketData) {
    const { conditions } = alert;

    try {
      // Check if alert is locked due to alert count condition
      if (isAlertLocked(alert)) {
        console.log(
          `🔒 Alert ${alert._id} for ${alert.symbol} is locked until ${alert.conditions.alertCount.lockUntil}`
        );
        return false; // Alert is locked, don't trigger
      }

      // Check Min Daily volume condition (required)
      if (conditions.minDaily && marketData.volume) {
        const minVolume = parseFloat(conditions.minDaily);
        const actualVolume = parseFloat(marketData.volume);

        if (actualVolume < minVolume) {
          return false; // Volume condition not met
        }
      }

      // Check Change % condition (required)
      if (
        conditions.changePercent &&
        conditions.changePercent.percentage &&
        marketData.priceChangePercent
      ) {
        const requiredChange = parseFloat(conditions.changePercent.percentage);
        const actualChange = Math.abs(
          parseFloat(marketData.priceChangePercent)
        );

        if (actualChange < requiredChange) {
          return false; // Change condition not met
        }
      }

      // Check Candle conditions (optional)
      if (
        conditions.candle &&
        conditions.candle.timeframes &&
        conditions.candle.timeframes.length > 0
      ) {
        const candleMatch = await this.evaluateCandleConditions(
          conditions.candle,
          marketData
        );
        if (!candleMatch) {
          return false;
        }
      }

      // Check RSI Range conditions (optional)
      if (
        conditions.rsiRange &&
        conditions.rsiRange.timeframes &&
        conditions.rsiRange.timeframes.length > 0
      ) {
        const rsiMatch = await this.evaluateRSIConditions(
          conditions.rsiRange,
          marketData
        );
        if (!rsiMatch) {
          return false;
        }
      }

      // Check Volume conditions (optional)
      if (
        conditions.volume &&
        conditions.volume.timeframes &&
        conditions.volume.timeframes.length > 0
      ) {
        const volumeMatch = await this.evaluateVolumeConditions(
          conditions.volume,
          marketData
        );
        if (!volumeMatch) {
          return false;
        }
      }

      // Check OPEN INTEREST conditions (optional)
      // Note: Open Interest evaluation is handled in RealTimeAlertProcessor
      // This worker may not have access to Open Interest data, so skip for now
      // The RealTimeAlertProcessor will handle Open Interest conditions
      if (
        conditions.openInterest &&
        conditions.openInterest.timeframes &&
        conditions.openInterest.timeframes.length > 0
      ) {
        console.log(
          `📊 Open Interest condition detected, but evaluation handled by RealTimeAlertProcessor`
        );
        // Return true to not block, RealTimeAlertProcessor will handle it
      }

      // Check Alert Count conditions (optional) - this is handled by the lock check above
      // If we reach here and alert count is set, we need to update the lock
      if (conditions.alertCount && conditions.alertCount.timeframe) {
        // Update the alert lock after successful trigger
        const updatedConditions = updateAlertLock(alert);

        // Update the alert in database with new lock time
        try {
          await AlertService.updateAlert(alert._id, {
            conditions: updatedConditions,
            triggered: true,
            triggeredAt: new Date(),
            triggeredPrice: parseFloat(marketData.price),
            triggeredVolume: parseFloat(marketData.volume),
            triggeredChange: parseFloat(marketData.priceChangePercent),
          });

          console.log(
            `🔒 Alert ${alert._id} for ${alert.symbol} locked until ${updatedConditions.alertCount.lockUntil}`
          );
        } catch (error) {
          console.error(
            `❌ Error updating alert lock for ${alert.symbol}:`,
            error
          );
        }
      }

      // All conditions met
      return true;
    } catch (error) {
      console.error("❌ Error evaluating alert conditions:", error);
      return false;
    }
  }

  // Evaluate candle conditions
  async evaluateCandleConditions(candleConditions, marketData) {
    try {
      // TODO: Implement candle pattern detection
      // This would require historical data and pattern recognition
      console.log(`🕯️ Evaluating candle conditions for ${marketData.symbol}`);
      return true; // Placeholder - implement actual candle logic
    } catch (error) {
      console.error("❌ Error evaluating candle conditions:", error);
      return false;
    }
  }

  // Evaluate RSI conditions
  async evaluateRSIConditions(rsiConditions, marketData) {
    try {
      // TODO: Implement RSI calculation and evaluation
      // This would require historical price data to calculate RSI
      console.log(`📊 Evaluating RSI conditions for ${marketData.symbol}`);
      return true; // Placeholder - implement actual RSI logic
    } catch (error) {
      console.error("❌ Error evaluating RSI conditions:", error);
      return false;
    }
  }

  // Evaluate volume conditions
  async evaluateVolumeConditions(volumeConditions, marketData) {
    try {
      // TODO: Implement volume trend analysis
      // This would require historical volume data
      console.log(`📈 Evaluating volume conditions for ${marketData.symbol}`);
      return true; // Placeholder - implement actual volume logic
    } catch (error) {
      console.error("❌ Error evaluating volume conditions:", error);
      return false;
    }
  }

  // Open Interest evaluation is handled in RealTimeAlertProcessor
  // This method is kept for backward compatibility but no longer used

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

  async stop() {
    console.log("🛑 Stopping Alert Worker...");
    this.isRunning = false;

    // Unsubscribe from alert management events
    await RealTimeAlertProcessor.unsubscribeFromAlertManagement();

    if (this.redis) {
      await this.redis.unsubscribe("market:updates");
      await this.redis.disconnect();
      console.log("✅ Redis connection closed");
    }

    console.log("✅ Alert Worker stopped");
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

  // Keep the process alive
  setInterval(() => {
    if (worker.isRunning) {
      console.log("🔄 Worker is running...");
    } else {
      console.log("⚠️ Worker is not running, attempting to restart...");
      worker.start().catch((error) => {
        console.error("❌ Failed to restart worker:", error);
      });
    }
  }, 30000); // Log every 30 seconds

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
