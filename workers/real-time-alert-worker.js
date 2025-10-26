import { connectToMongoDB } from "../utils/mongodb.js";
import WebSocketService from "../services/WebSocketService.js";
import RealTimeAlertProcessor from "../services/RealTimeAlertProcessor.js";
import Redis from "ioredis";

class RealTimeAlertWorker {
  constructor() {
    this.isRunning = false;
    this.redis = null;
  }

  async start() {
    console.log("🚀 Starting Real-Time Alert Worker...");

    try {
      // Connect to MongoDB
      await connectToMongoDB();
      console.log("✅ Connected to MongoDB");

      // Load all active alerts into memory
      await RealTimeAlertProcessor.loadAllActiveAlerts();
      console.log("✅ Loaded active alerts into memory");

      // Connect to Redis for SSE data (same as MarketPanel)
      this.redis = new Redis({
        host: "localhost",
        port: 6379,
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
        lazyConnect: true,
        retryDelayOnClusterDown: 300,
        maxRetriesPerRequest: 3,
        keepAlive: 30000,
        connectTimeout: 10000,
        commandTimeout: 5000,
      });

      await this.redis.ping();
      console.log("✅ Connected to Redis");

      // Handle Redis connection errors
      this.redis.on("error", (err) => {
        console.error("❌ Redis connection error:", err);
      });

      // Subscribe to market updates channel (same as SSE)
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
      // Process the price update in real-time
      await RealTimeAlertProcessor.processPriceUpdate(priceData);
    } catch (error) {
      console.error(
        `❌ Error handling price update for ${priceData.symbol}:`,
        error
      );
    }
  }

  async stop() {
    console.log("🛑 Stopping Real-Time Alert Worker...");

    try {
      if (this.redis) {
        await this.redis.unsubscribe("market:updates");
        await this.redis.quit();
        console.log("✅ Redis connection closed");
      }

      WebSocketService.disconnect();
      this.isRunning = false;
      console.log("✅ Real-Time Alert Worker stopped");
    } catch (error) {
      console.error("❌ Error stopping Alert Worker:", error);
    }
  }

  isRunning() {
    return this.isRunning;
  }

  async refreshAlerts() {
    console.log("🔄 Refreshing alerts...");
    await RealTimeAlertProcessor.refreshAlerts();
    console.log("✅ Alerts refreshed");
  }
}

// Create and export worker instance
const worker = new RealTimeAlertWorker();

// Handle graceful shutdown
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

// Start the worker
if (import.meta.url === `file://${process.argv[1]}`) {
  worker.start().catch(console.error);
}

export default worker;
