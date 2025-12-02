/**
 * 🚀 DEMO TELEGRAM ALERT WITH SCREENSHOT TEST
 * 
 * This script will:
 * 1. Initialize FastScreenshotService
 * 2. Generate a screenshot for BTCUSDT
 * 3. Send Telegram alert with screenshot
 * 4. Show complete flow working
 */

import dotenv from "dotenv";
dotenv.config();

import FastScreenshotService from "./services/FastScreenshotService.js";
import ImprovedNotificationService from "./services/ImprovedNotificationService.js";
import TelegramService from "./services/TelegramService.js";
import { connectToMongoDB } from "./utils/mongodb.js";

console.log("\n🚀 ========================================");
console.log("   TELEGRAM SCREENSHOT ALERT DEMO TEST");
console.log("========================================\n");

// Check Telegram configuration
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error("❌ TELEGRAM_BOT_TOKEN not found in .env file!");
    console.log("💡 Please add TELEGRAM_BOT_TOKEN to your .env file");
    process.exit(1);
}

console.log("✅ Telegram Bot Token found");
console.log(`📱 Bot Token: ${process.env.TELEGRAM_BOT_TOKEN.substring(0, 20)}...`);

// Get chat ID from arguments or use a test chat ID
const chatId = process.argv[2] || process.env.TELEGRAM_CHAT_ID;

if (!chatId) {
    console.error("\n❌ No Telegram Chat ID provided!");
    console.log("\n💡 Usage:");
    console.log("   node demo-telegram-alert.js YOUR_CHAT_ID");
    console.log("\n💡 To get your Chat ID:");
    console.log("   1. Message your bot on Telegram");
    console.log("   2. Visit: https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates");
    console.log("   3. Look for 'chat': { 'id': YOUR_CHAT_ID }");
    console.log("\n💡 Or add to .env:");
    console.log("   TELEGRAM_CHAT_ID=your_chat_id\n");
    process.exit(1);
}

console.log(`✅ Chat ID: ${chatId}\n`);

async function runDemo() {
    try {
        // ========== STEP 1: Connect to MongoDB ==========
        console.log("📊 STEP 1: Connecting to MongoDB...");
        await connectToMongoDB();
        console.log("✅ MongoDB connected\n");

        // ========== STEP 2: Initialize Services ==========
        console.log("📊 STEP 2: Initializing Services...");
        TelegramService.initialize();
        console.log("✅ Services initialized\n");

        // ========== STEP 3: Prepare Test Alert Data ==========
        console.log("📊 STEP 3: Preparing test alert data...");

        const testSymbol = "BTCUSDT";
        const currentPrice = 45234.56;
        const baselinePrice = 44000.00;
        const change = ((currentPrice - baselinePrice) / baselinePrice) * 100;

        const alertData = {
            symbol: testSymbol,
            actualValue: 5.2,
            triggeredPrice: currentPrice,
            baselinePrice: baselinePrice,
            changeFromBaselinePercent: change,
            volume: 12345678900,
            triggeredAt: new Date(),
        };

        console.log(`   Symbol: ${alertData.symbol}`);
        console.log(`   Current Price: $${alertData.triggeredPrice.toFixed(2)}`);
        console.log(`   Baseline Price: $${alertData.baselinePrice.toFixed(2)}`);
        console.log(`   Change: ${alertData.changeFromBaselinePercent.toFixed(2)}%`);
        console.log(`   Volume: ${new Intl.NumberFormat("en-US").format(alertData.volume)}`);
        console.log("✅ Test data prepared\n");

        // ========== STEP 4: Generate Screenshot ==========
        console.log("📊 STEP 4: Generating screenshot...");
        console.log("   This may take 2-5 seconds for first time...");

        const startTime = Date.now();
        const screenshotResult = await FastScreenshotService.getScreenshot(
            testSymbol,
            "5m",
            { forceSync: true } // Force synchronous generation for demo
        );
        const duration = Date.now() - startTime;

        if (!screenshotResult || !screenshotResult.screenshot) {
            console.error("❌ Failed to generate screenshot!");
            throw new Error("Screenshot generation failed");
        }

        console.log(`✅ Screenshot generated in ${duration}ms`);
        console.log(`   Source: ${screenshotResult.source}`);
        console.log(`   Size: ${(screenshotResult.screenshot.length / 1024).toFixed(2)} KB\n`);

        // ========== STEP 5: Send Telegram Alert with Screenshot ==========
        console.log("📊 STEP 5: Sending Telegram alert with screenshot...");
        console.log(`   Sending to Chat ID: ${chatId}...`);

        const sendStartTime = Date.now();
        const sendResult = await TelegramService.sendPhotoAlert(
            chatId,
            screenshotResult.screenshot,
            alertData
        );
        const sendDuration = Date.now() - sendStartTime;

        if (sendResult) {
            console.log(`✅ Telegram alert sent successfully in ${sendDuration}ms!\n`);
        } else {
            console.error("❌ Failed to send Telegram alert!");
            throw new Error("Telegram send failed");
        }

        // ========== STEP 6: Show Statistics ==========
        console.log("📊 STEP 6: FastScreenshotService Statistics:");
        const stats = FastScreenshotService.getStats();
        console.log(JSON.stringify(stats, null, 2));
        console.log("");

        // ========== SUCCESS SUMMARY ==========
        console.log("🎉 ========================================");
        console.log("   DEMO COMPLETED SUCCESSFULLY!");
        console.log("========================================");
        console.log("");
        console.log("✅ Screenshot generated and cached");
        console.log("✅ Telegram alert sent with photo");
        console.log(`✅ Total time: ${Date.now() - startTime}ms`);
        console.log("");
        console.log("📱 Check your Telegram chat for the alert!");
        console.log("   You should see:");
        console.log("   • Chart screenshot");
        console.log("   • Alert details (price, change, volume)");
        console.log("   • Formatted message with emojis");
        console.log("");
        console.log("🚀 System is working perfectly!");
        console.log("========================================\n");

        // ========== BONUS: Test Cache Hit ==========
        console.log("🔥 BONUS TEST: Testing cache hit rate...");
        console.log("   Requesting same screenshot again...\n");

        const cacheTestStart = Date.now();
        const cachedResult = await FastScreenshotService.getScreenshot(testSymbol, "5m");
        const cacheTestDuration = Date.now() - cacheTestStart;

        if (cachedResult && cachedResult.screenshot) {
            console.log(`✅ Cache HIT! Retrieved in ${cacheTestDuration}ms`);
            console.log(`   Source: ${cachedResult.source} cache`);
            console.log(`   Age: ${cachedResult.age}s old`);
            console.log(`   Speed improvement: ${Math.round(duration / cacheTestDuration)}x faster!\n`);
        }

        // Final stats
        const finalStats = FastScreenshotService.getStats();
        console.log("📊 Final Statistics:");
        console.log(`   Cache Hit Rate: ${finalStats.hitRate}`);
        console.log(`   Total Requests: ${finalStats.totalRequests}`);
        console.log(`   Hot Cache Hits: ${finalStats.hotHits}`);
        console.log(`   Cache Size: ${finalStats.cacheSize.hot} hot / ${finalStats.cacheSize.warm} warm\n`);

        process.exit(0);
    } catch (error) {
        console.error("\n❌ ========================================");
        console.error("   DEMO FAILED!");
        console.error("========================================\n");
        console.error("Error:", error.message);
        console.error("\nStack:", error.stack);
        console.error("\n💡 Troubleshooting:");
        console.error("   1. Check MongoDB is running");
        console.error("   2. Check Redis is running");
        console.error("   3. Verify Telegram bot token is correct");
        console.error("   4. Verify chat ID is correct");
        console.error("   5. Make sure bot has permission to send messages\n");
        process.exit(1);
    }
}

// Run the demo
runDemo();
