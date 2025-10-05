const Redis = require("ioredis");
const { connectToMongoDB } = require("../utils/mongodb");
const AlertService = require("../services/AlertService");
const AlertHistoryService = require("../services/AlertHistoryService");

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
    console.log("🚀 Starting Alert Worker...");

    try {
      // Connect to MongoDB
      await connectToMongoDB();

      // Connect to Redis
      await this.redis.ping();
      console.log("✅ Connected to Redis");

      // Subscribe to price updates
      await this.subscribeToPriceUpdates();

      this.isRunning = true;
      console.log("✅ Alert Worker started successfully");
    } catch (error) {
      console.error("❌ Alert Worker startup failed:", error);
      throw error;
    }
  }

  async subscribeToPriceUpdates() {
    // Subscribe to market updates channel
    this.redis.subscribe("market:updates", (err, count) => {
      if (err) {
        console.error("❌ Redis subscription error:", err);
        return;
      }
      console.log(`✅ Subscribed to market:updates (${count} channels)`);
    });

    // Listen for messages
    this.redis.on("message", async (channel, message) => {
      if (channel === "market:updates") {
        try {
          const data = JSON.parse(message);
          if (data.type === "market_update" && data.symbol) {
            await this.processPriceUpdate(data);
          }
        } catch (error) {
          console.error("❌ Error processing price update:", error);
        }
      }
    });

    // Handle Redis connection events
    this.redis.on("error", (err) => {
      console.error("❌ Redis error:", err);
    });

    this.redis.on("connect", () => {
      console.log("✅ Redis connected");
    });

    this.redis.on("close", () => {
      console.log("⚠️ Redis connection closed");
    });
  }

  async processPriceUpdate(marketData) {
    const { symbol, price, volume, priceChangePercent } = marketData;

    if (!symbol || !price || !volume) {
      return; // Skip invalid data
    }

    try {
      // Get all active alerts for this symbol
      const alerts = await AlertService.getActiveAlertsForSymbol(symbol);

      if (alerts.length === 0) {
        return; // No alerts for this symbol
      }

      console.log(`📊 Processing ${alerts.length} alerts for ${symbol}`);

      // Evaluate each alert
      for (const alert of alerts) {
        const alertKey = `${alert._id}_${symbol}`;

        // Skip if already processed recently (avoid duplicates)
        if (this.processedAlerts.has(alertKey)) {
          continue;
        }

        const shouldTrigger = await this.evaluateAlertConditions(
          alert,
          marketData
        );

        if (shouldTrigger) {
          await this.triggerAlert(alert, marketData);
          this.processedAlerts.add(alertKey);

          // Remove from processed set after 5 minutes to allow re-triggering
          setTimeout(() => {
            this.processedAlerts.delete(alertKey);
          }, 5 * 60 * 1000);
        }
      }
    } catch (error) {
      console.error(`❌ Error processing alerts for ${symbol}:`, error);
    }
  }

  async evaluateAlertConditions(alert, marketData) {
    const { conditions } = alert;

    try {
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
        conditions.percentage &&
        marketData.priceChangePercent
      ) {
        const requiredChange = parseFloat(conditions.percentage);
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

      // Check EMA conditions (optional)
      if (
        conditions.ema &&
        conditions.ema.timeframes &&
        conditions.ema.timeframes.length > 0
      ) {
        const emaMatch = await this.evaluateEMAConditions(
          conditions.ema,
          marketData
        );
        if (!emaMatch) {
          return false;
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

  // Evaluate EMA conditions
  async evaluateEMAConditions(emaConditions, marketData) {
    try {
      // TODO: Implement EMA calculation and crossover detection
      // This would require historical price data to calculate EMAs
      console.log(`📉 Evaluating EMA conditions for ${marketData.symbol}`);
      return true; // Placeholder - implement actual EMA logic
    } catch (error) {
      console.error("❌ Error evaluating EMA conditions:", error);
      return false;
    }
  }

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

    if (this.redis) {
      await this.redis.unsubscribe();
      await this.redis.disconnect();
    }

    console.log("✅ Alert Worker stopped");
  }
}

// Start worker if run directly
if (require.main === module) {
  const worker = new AlertWorker();

  worker.start().catch((error) => {
    console.error("❌ Alert Worker failed to start:", error);
    process.exit(1);
  });

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

module.exports = AlertWorker;
