import { connectToMongoDB } from "../utils/mongodb.js";
import AlertHistoryService from "../services/AlertHistoryService.js";
import Alert from "../models/Alert.js";

async function testAlertHistory() {
  console.log("🧪 Testing Alert History System...");

  try {
    // Connect to MongoDB
    await connectToMongoDB();
    console.log("✅ Connected to MongoDB");

    // Create a test alert history entry
    const testAlertHistory = {
      alertId: "507f1f77bcf86cd799439011", // Mock ObjectId
      userId: "test-user-123",
      symbol: "BTCUSDT",
      alertConditions: {
        minDaily: "1000000",
        changePercent: {
          timeframe: "5MIN",
          percentage: "2",
        },
        alertCount: {
          timeframe: "1HR",
          lockUntil: new Date(Date.now() + 60 * 60 * 1000),
          lastTriggered: new Date(),
        },
      },
      conditions: "Min Daily: 1000000, Change: 2% (5MIN), Alert Count: 1HR",
      triggerData: {
        price: 45000.5,
        priceChange: 1250.75,
        priceChangePercent: 2.85,
        volume: 1500000.25,
        high: 45500.0,
        low: 44000.0,
        open: 43750.0,
        close: 45000.5,
        timestamp: Date.now(),
      },
      triggeredAt: new Date(),
    };

    // Test creating alert history
    console.log("📝 Creating test alert history...");
    const createdHistory = await AlertHistoryService.createAlertHistory(
      testAlertHistory
    );
    console.log("✅ Alert history created:", createdHistory._id);

    // Test getting user alert history
    console.log("📊 Fetching user alert history...");
    const userHistory = await AlertHistoryService.getUserAlertHistory(
      "test-user-123",
      10,
      0
    );
    console.log(`✅ Found ${userHistory.length} alert history entries`);

    // Test getting alert history stats
    console.log("📈 Fetching alert history stats...");
    const stats = await AlertHistoryService.getAlertHistoryStats(
      "test-user-123"
    );
    console.log("✅ Alert history stats:", stats);

    // Test getting recent alert history
    console.log("🕐 Fetching recent alert history...");
    const recentHistory = await AlertHistoryService.getRecentAlertHistory(
      "test-user-123",
      24
    );
    console.log(
      `✅ Found ${recentHistory.length} recent alert history entries`
    );

    // Test pagination
    console.log("📄 Testing pagination...");
    const paginatedHistory =
      await AlertHistoryService.getAlertHistoryWithPagination(
        "test-user-123",
        1,
        5
      );
    console.log(
      `✅ Paginated results: ${paginatedHistory.data.length} entries, ${paginatedHistory.pagination.totalCount} total`
    );

    console.log("🎉 All Alert History tests passed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    process.exit(0);
  }
}

testAlertHistory();
