/**
 * Check user Telegram settings in database
 */
import dotenv from "dotenv";
dotenv.config();

import { connectToMongoDB } from "./utils/mongodb.js";
import User from "./models/User.js";

async function checkUsers() {
    try {
        await connectToMongoDB();
        console.log("✅ Connected to MongoDB\n");

        // Get all users
        const users = await User.find({}).select("email telegramChatId notificationPreferences preferredTimeframe").lean();

        console.log(`Found ${users.length} users:\n`);

        users.forEach((user, i) => {
            console.log(`User ${i + 1}:`);
            console.log(`  ID: ${user._id}`);
            console.log(`  Email: ${user.email || "N/A"}`);
            console.log(`  Telegram Chat ID: ${user.telegramChatId || "❌ NOT SET"}`);
            console.log(`  Notification Prefs:`, user.notificationPreferences || "NOT SET");
            console.log(`  Telegram Enabled: ${user.notificationPreferences?.telegram ? "✅ YES" : "❌ NO"}`);
            console.log("");
        });

        process.exit(0);
    } catch (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
}

checkUsers();
