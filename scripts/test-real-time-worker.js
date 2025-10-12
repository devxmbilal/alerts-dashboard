import { connectToMongoDB } from "../utils/mongodb.js";
import WebSocketService from "../services/WebSocketService.js";
import RealTimeAlertProcessor from "../services/RealTimeAlertProcessor.js";

async function testRealTimeWorker() {
  console.log("🧪 Testing Real-Time Alert Worker...");

  try {
    // Connect to MongoDB
    await connectToMongoDB();
    console.log("✅ Connected to MongoDB");

    // Load alerts
    await RealTimeAlertProcessor.loadAllActiveAlerts();
    console.log("✅ Loaded alerts");

    // Connect to WebSocket
    await WebSocketService.connect();
    console.log("✅ Connected to WebSocket");

    // Subscribe to price updates
    WebSocketService.subscribeToAll((priceData) => {
      console.log(
        `📊 Price Update: ${priceData.symbol} - $${priceData.price} (${priceData.priceChangePercent}%)`
      );
    });

    console.log("🔥 Real-Time Worker is running! Press Ctrl+C to stop.");
    console.log("📈 Monitoring live market data...");

    // Keep the process running
    process.on("SIGINT", async () => {
      console.log("\n🛑 Stopping test...");
      WebSocketService.disconnect();
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

testRealTimeWorker();
