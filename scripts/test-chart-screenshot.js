import dotenv from "dotenv";
import ChartScreenshotService from "../utils/chartScreenshot.js";
import TelegramService from "../services/TelegramService.js";

dotenv.config();

/**
 * Test script for chart screenshot and Telegram integration
 */
async function testChartScreenshot() {
  try {
    console.log("🚀 Starting Chart Screenshot Test...\n");

    // Test 1: Initialize chart screenshot service
    console.log("📸 Test 1: Initializing Puppeteer...");
    await ChartScreenshotService.initialize();
    console.log("✅ Puppeteer initialized successfully\n");

    // Test 2: Capture a chart screenshot
    console.log("📊 Test 2: Capturing BTCUSDT chart screenshot...");
    const symbol = "BTCUSDT";
    const timeframe = "5m";
    
    const screenshot = await ChartScreenshotService.captureChart(symbol, timeframe);
    console.log(`✅ Screenshot captured: ${screenshot.length} bytes\n`);

    // Test 3: Save screenshot locally (optional)
    console.log("💾 Test 3: Saving screenshot locally...");
    const filename = `${symbol}_${timeframe}_${Date.now()}.jpg`;
    await ChartScreenshotService.saveScreenshot(screenshot, filename);
    console.log("✅ Screenshot saved successfully\n");

    // Test 4: Send Telegram photo alert
    const telegramChatId = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_BOT_TOKEN?.split(":")[0];
    
    if (telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
      console.log("📱 Test 4: Sending Telegram photo alert...");
      
      const alertData = {
        symbol: symbol,
        targetValue: 1,
        actualValue: 2.175,
        direction: "Increase",
        timeframe: timeframe.toUpperCase(),
        triggeredPrice: 45227.50,
        baselinePrice: 45000.00,
        changeFromBaselinePercent: 0.505,
        volume: 15234567890,
        triggeredAt: new Date(),
      };

      const sent = await TelegramService.sendPhotoAlert(
        telegramChatId,
        screenshot,
        alertData
      );

      if (sent) {
        console.log("✅ Telegram photo alert sent successfully\n");
      } else {
        console.log("⚠️ Telegram photo alert failed\n");
      }
    } else {
      console.log("⚠️ Test 4: Skipped - TELEGRAM_CHAT_ID or TELEGRAM_BOT_TOKEN not configured\n");
      console.log("To test Telegram integration, set these environment variables:");
      console.log("  - TELEGRAM_BOT_TOKEN");
      console.log("  - TELEGRAM_CHAT_ID\n");
    }

    // Test 5: Capture multiple charts concurrently
    console.log("📊 Test 5: Capturing multiple charts concurrently...");
    const chartRequests = [
      { symbol: "ETHUSDT", timeframe: "5m" },
      { symbol: "BNBUSDT", timeframe: "15m" },
      { symbol: "SOLUSDT", timeframe: "1h" },
    ];

    const results = await ChartScreenshotService.captureMultipleCharts(chartRequests);
    
    const successCount = results.filter((r) => r.success).length;
    console.log(`✅ Captured ${successCount}/${results.length} charts successfully\n`);

    // Test 6: Health check
    console.log("🏥 Test 6: Running health check...");
    const isHealthy = await ChartScreenshotService.healthCheck();
    console.log(`✅ Browser health check: ${isHealthy ? "PASSED" : "FAILED"}\n`);

    // Cleanup
    console.log("🧹 Cleaning up...");
    await ChartScreenshotService.shutdown();
    console.log("✅ Puppeteer browser closed\n");

    console.log("🎉 All tests completed successfully!");
    
    // Small delay to ensure cleanup completes
    await new Promise(resolve => setTimeout(resolve, 500));
    process.exit(0);
  } catch (error) {
    console.error("❌ Test failed:", error);
    console.error("Stack trace:", error.stack);
    
    // Cleanup on error
    try {
      await ChartScreenshotService.shutdown();
    } catch (cleanupError) {
      console.error("❌ Cleanup failed:", cleanupError);
    }
    
    process.exit(1);
  }
}

// Run tests
testChartScreenshot();
