import { connectToMongoDB } from "../utils/mongodb.js";
import Alert from "../models/Alert.js";
import AlertHistory from "../models/AlertHistory.js";
import User from "../models/User.js";
import { resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

async function setupDatabase() {
  try {
    console.log("🚀 Setting up database...");

    // Connect to MongoDB
    await connectToMongoDB();

    // Create indexes for better performance
    console.log("📊 Creating indexes from schemas...");
    await Alert.createIndexes();
    await AlertHistory.createIndexes();
    await User.createIndexes();

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
const isMainModule =
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
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

export default setupDatabase;
