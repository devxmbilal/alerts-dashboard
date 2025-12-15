import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();

class AlertRedisService {
  constructor() {
    // Publisher connection (for publish operations)
    this.redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
      lazyConnect: false, // Connect immediately
      retryDelayOnClusterDown: 300,
      maxRetriesPerRequest: 3,
    });

    // Separate Subscriber connection (for subscribe operations)
    // Redis requires separate connections for pub/sub
    this.subscriber = null;
  }

  // Initialize subscriber connection
  async initSubscriber() {
    if (this.subscriber) {
      return this.subscriber;
    }

    this.subscriber = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
      lazyConnect: false,
      retryDelayOnClusterDown: 300,
      maxRetriesPerRequest: 3,
    });

    this.subscriber.on("error", (err) => {
      console.error("❌ AlertRedisService subscriber error:", err.message);
    });

    this.subscriber.on("connect", () => {
      console.log("✅ AlertRedisService subscriber connected");
    });

    return this.subscriber;
  }

  // Publish alert created event
  async publishAlertCreated(alertId, userId, symbol) {
    try {
      const message = {
        type: "alert_created",
        alertId,
        userId,
        symbol,
        timestamp: Date.now(),
      };

      await this.redis.publish("alert:management", JSON.stringify(message));
      console.log(`📢 Published alert created: ${alertId} for ${symbol}`);
    } catch (error) {
      console.error("❌ Error publishing alert created:", error);
    }
  }

  // Publish alert removed event
  async publishAlertRemoved(alertId, userId, symbol) {
    try {
      const message = {
        type: "alert_removed",
        alertId,
        userId,
        symbol,
        timestamp: Date.now(),
      };

      await this.redis.publish("alert:management", JSON.stringify(message));
      console.log(`📢 Published alert removed: ${alertId} for ${symbol}`);
    } catch (error) {
      console.error("❌ Error publishing alert removed:", error);
    }
  }

  // Publish bulk alerts created event
  async publishBulkAlertsCreated(alertIds, userId, symbols) {
    try {
      const message = {
        type: "bulk_alerts_created",
        alertIds,
        userId,
        symbols,
        timestamp: Date.now(),
      };

      await this.redis.publish("alert:management", JSON.stringify(message));
      console.log(
        `📢 Published bulk alerts created: ${alertIds.length} alerts for ${symbols.length} symbols`
      );
    } catch (error) {
      console.error("❌ Error publishing bulk alerts created:", error);
    }
  }

  // Publish alerts cleared event
  async publishAlertsCleared(userId) {
    try {
      const message = {
        type: "alerts_cleared",
        userId,
        timestamp: Date.now(),
      };

      await this.redis.publish("alert:management", JSON.stringify(message));
      console.log(`📢 Published alerts cleared for user: ${userId}`);
    } catch (error) {
      console.error("❌ Error publishing alerts cleared:", error);
    }
  }

  // Publish alerts removed for symbol event
  async publishAlertsRemovedForSymbol(userId, symbol) {
    try {
      const message = {
        type: "alerts_removed_for_symbol",
        userId,
        symbol,
        timestamp: Date.now(),
      };

      await this.redis.publish("alert:management", JSON.stringify(message));
      console.log(`📢 Published alerts removed for symbol: ${symbol}`);
    } catch (error) {
      console.error("❌ Error publishing alerts removed for symbol:", error);
    }
  }

  // Subscribe to alert management events (uses SEPARATE subscriber connection)
  async subscribeToAlertManagement(callback) {
    try {
      // Initialize separate subscriber connection
      const subscriber = await this.initSubscriber();

      await subscriber.subscribe("alert:management");
      console.log("✅ Subscribed to alert:management channel");

      subscriber.on("message", (channel, message) => {
        if (channel === "alert:management") {
          try {
            const data = JSON.parse(message);
            console.log(`📨 Received alert management event: ${data.type}`);
            callback(data);
          } catch (error) {
            console.error("❌ Error parsing alert management message:", error);
          }
        }
      });
    } catch (error) {
      console.error("❌ Error subscribing to alert management:", error);
    }
  }

  // Unsubscribe from alert management events
  async unsubscribeFromAlertManagement() {
    try {
      if (this.subscriber) {
        await this.subscriber.unsubscribe("alert:management");
        console.log("✅ Unsubscribed from alert:management channel");
      }
    } catch (error) {
      console.error("❌ Error unsubscribing from alert management:", error);
    }
  }

  // Close Redis connections
  async close() {
    try {
      await this.redis.disconnect();
      if (this.subscriber) {
        await this.subscriber.disconnect();
      }
      console.log("✅ AlertRedisService connections closed");
    } catch (error) {
      console.error("❌ Error closing AlertRedisService:", error);
    }
  }
}

export default new AlertRedisService();
