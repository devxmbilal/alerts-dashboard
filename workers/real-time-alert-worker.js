import { connectToMongoDB } from "../utils/mongodb.js";
import WebSocketService from "../services/WebSocketService.js";
import RealTimeAlertProcessor from "../services/RealTimeAlertProcessor.js";

class RealTimeAlertWorker {
  constructor() {
    this.isRunning = false;
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

      // Connect to WebSocket for real-time data
      await WebSocketService.connect();
      console.log("✅ Connected to Binance WebSocket");

      // Subscribe to all price updates
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
