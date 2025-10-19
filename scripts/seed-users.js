import { connectToMongoDB } from "../utils/mongodb.js";
import UserService from "../services/UserService.js";

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
      email: "admin@alerts.com",
      telegramChatId: "", // Add your Telegram chat ID here
      notificationPreferences: {
        email: true,
        telegram: false, // Enable after adding telegramChatId
      },
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

    // Create a test user
    const testUser = {
      username: "testuser",
      password: "test123",
      name: "Test User",
      email: "test@alerts.com",
      telegramChatId: "", // Add your Telegram chat ID here
      notificationPreferences: {
        email: true,
        telegram: false, // Enable after adding telegramChatId
      },
    };

    const existingTest = await UserService.findByUsername("testuser");
    if (!existingTest) {
      const testUserCreated = await UserService.createUser(testUser);
      console.log("✅ Test user created:", {
        username: testUserCreated.username,
        name: testUserCreated.name,
        email: testUserCreated.email,
      });
    } else {
      console.log("✅ Test user already exists");
    }

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
if (import.meta.url === `file://${process.argv[1]}`) {
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
