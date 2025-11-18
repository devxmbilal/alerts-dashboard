import { connectToMongoDB } from "../utils/mongodb.js";
import UserService from "../services/UserService.js";
import dotenv from "dotenv";
import { resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

// Load .env file from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const projectRoot = resolve(__dirname, "..");
dotenv.config({ path: resolve(projectRoot, ".env") });

async function seedUsers() {
  try {
    console.log("🌱 Seeding users...");

    // Connect to MongoDB
    await connectToMongoDB();

    // Default admin user
    const adminUser = {
      username: "admin",
      password: "admin123",
      name: "Admin User",
      email: "wiclauuk@gnail.com",
      // telegramChatId: "5630545835", // Add your Telegram chat ID here
      telegramChatId: "5550226808",
      notificationPreferences: {
        email: false,
        telegram: true, // Enable after adding telegramChatId
      },
      preferredTimeframe: "5m",
      isActive: true,
      lastLogin: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      favorites: [],
    };

    // Check if admin user already exists
    const existingAdmin = await UserService.findByUsername("admin");
    if (existingAdmin) {
      console.log("✅ Admin user already exists");
      return;
    }

    // Create admin user
    const user = await UserService.createUser(adminUser);
    console.log("✅ Admin user created:", {
      username: user.username,
      name: user.name,
      email: user.email,
    });

    // Show user statistics
    const stats = await UserService.getUserStats();
    console.log("📊 User statistics:", stats);

    console.log("🎉 User seeding completed successfully!");
  } catch (error) {
    console.error("❌ User seeding failed:", error);
    process.exit(1);
  }
}

// Run seeding if called directly
const isMainModule =
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  seedUsers()
    .then(() => {
      console.log("✅ Seeding completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Seeding failed:", error);
      process.exit(1);
    });
}

export default seedUsers;
