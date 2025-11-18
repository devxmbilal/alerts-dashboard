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

      // NEW: Use WebSocket-based real-time processing (much faster than round-based)
      await RealTimeAlertProcessor.startWebSocketProcessing();
      console.log("✅ Started WebSocket-based real-time processing");

      // OLD: Keep round-based processing as backup (optional - can be disabled)
      // await RealTimeAlertProcessor.startRoundBasedProcessing();
      // console.log("✅ Started round-based alert processing");

      // Subscribe to alert management events (for alert creation/removal)
      await RealTimeAlertProcessor.subscribeToAlertManagement();
      console.log("✅ Subscribed to alert management events");

      this.isRunning = true;
      console.log("✅ Real-Time Alert Worker started successfully");
      console.log(
        "🔥 Monitoring live market data via WebSocket for instant alerts..."
      );
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
      // Stop WebSocket connection
      RealTimeAlertProcessor.stopWebSocketPriceFeed();
      console.log("✅ WebSocket connection closed");

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
