import dotenv from "dotenv";
import ChartScreenshotService from "../utils/chartScreenshot.js";
import TelegramService from "../services/TelegramService.js";

dotenv.config();

/**
 * Complete test: Screenshot + Telegram Photo Alert
 */
async function testFullTelegramAlert() {
  try {
    console.log("🚀 Testing Complete Telegram Alert System...\n");

    // Get chat ID from env or use default
    const chatId = process.env.TELEGRAM_CHAT_ID || "5550226808";
    
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.error("❌ TELEGRAM_BOT_TOKEN not set in .env");
      process.exit(1);
    }

    console.log(`📱 Chat ID: ${chatId}\n`);

    // Step 1: Initialize chart screenshot service
    console.log("📸 Step 1: Initializing screenshot service...");
    await ChartScreenshotService.initialize();
    console.log("✅ Screenshot service ready\n");

    // Step 2: Capture chart screenshot
    const symbol = "BTCUSDT";
    const timeframe = "5m";
    
    console.log(`📊 Step 2: Capturing ${symbol} chart (${timeframe})...`);
    const screenshot = await ChartScreenshotService.captureChart(symbol, timeframe);
    console.log(`✅ Screenshot captured: ${screenshot.length} bytes\n`);

    // Step 3: Prepare alert data
    const alertData = {
      symbol: symbol,
      targetValue: 1,
      actualValue: 17.175,
      direction: "Increase",
      timeframe: timeframe.toUpperCase(),
      triggeredPrice: 45227.50,
      baselinePrice: 44500.00,
      changeFromBaselinePercent: 1.635,
      volume: 1069122.18,
      triggeredAt: new Date(),
    };

    console.log("📝 Alert Data:");
    console.log(`   Symbol: ${alertData.symbol}`);
    console.log(`   Price: $${alertData.triggeredPrice}`);
    console.log(`   Change: ${alertData.changeFromBaselinePercent}%`);
    console.log(`   Volume: ${alertData.volume.toLocaleString()}\n`);

    // Step 4: Send to Telegram with photo
    console.log("📱 Step 4: Sending to Telegram...");
    const sent = await TelegramService.sendPhotoAlert(
      chatId,
      screenshot,
      alertData
    );

    if (sent) {
      console.log("\n✅ SUCCESS! Telegram alert sent with chart!");
      console.log(`📲 Check your Telegram app (Chat ID: ${chatId})`);
      console.log("🎨 You should see:");
      console.log("   - TradingView chart screenshot");
      console.log("   - Formatted alert message");
      console.log("   - All trading details");
    } else {
      console.log("\n⚠️ Failed to send Telegram alert");
    }

    // Cleanup
    console.log("\n🧹 Cleaning up...");
    await ChartScreenshotService.shutdown();
    
    console.log("\n🎉 Test Complete!");
    
    await new Promise(resolve => setTimeout(resolve, 500));
    process.exit(sent ? 0 : 1);
    
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    console.error("Stack:", error.stack);
    
    try {
      await ChartScreenshotService.shutdown();
    } catch (e) {
      // Ignore cleanup errors
    }
    
    process.exit(1);
  }
}

// Run test
testFullTelegramAlert();
