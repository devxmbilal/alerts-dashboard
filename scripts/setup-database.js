const { connectToMongoDB } = require("../utils/mongodb");
const Alert = require("../models/Alert");
const AlertHistory = require("../models/AlertHistory");
const User = require("../models/User");

async function setupDatabase() {
  try {
    console.log("🚀 Setting up database...");

    // Connect to MongoDB
    await connectToMongoDB();

    // Create indexes for better performance
    console.log("📊 Creating indexes...");

    // Alert indexes
    await Alert.collection.createIndex({ symbol: 1, status: 1 });
    await Alert.collection.createIndex({ userId: 1, status: 1 });
    await Alert.collection.createIndex({ createdAt: -1 });
    await Alert.collection.createIndex({ triggeredAt: -1 });

    // AlertHistory indexes
    await AlertHistory.collection.createIndex({ userId: 1, createdAt: -1 });
    await AlertHistory.collection.createIndex({ symbol: 1, createdAt: -1 });
    await AlertHistory.collection.createIndex({ alertId: 1 });
    await AlertHistory.collection.createIndex({ status: 1, createdAt: -1 });

    // User indexes
    await User.collection.createIndex({ username: 1 });
    await User.collection.createIndex({ email: 1 });
    await User.collection.createIndex({ isActive: 1 });

    console.log("✅ Database setup completed successfully");

    // Show some stats
    const alertCount = await Alert.countDocuments();
    const alertHistoryCount = await AlertHistory.countDocuments();
    const userCount = await User.countDocuments();
    console.log(`📈 Total alerts in database: ${alertCount}`);
    console.log(`📝 Total alert history records: ${alertHistoryCount}`);
    console.log(`👥 Total users in database: ${userCount}`);
  } catch (error) {
    console.error("❌ Database setup failed:", error);
    process.exit(1);
  }
}

// Run setup if called directly
if (require.main === module) {
  setupDatabase()
    .then(() => {
      console.log("✅ Setup completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Setup failed:", error);
      process.exit(1);
    });
}

module.exports = setupDatabase;
