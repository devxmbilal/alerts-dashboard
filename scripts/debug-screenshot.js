import ScreenshotCacheService from "../services/ScreenshotCacheService.js";
import ChartScreenshotService from "../utils/chartScreenshot.js";
import { connectToMongoDB } from "../utils/mongodb.js";
import dotenv from "dotenv";

dotenv.config();

// Connect to MongoDB
await connectToMongoDB();
console.log("✅ MongoDB connected\n");

console.log("🔍 DEBUGGING SCREENSHOT ISSUE\n");
console.log("=".repeat(60));

// Test symbol from your alert
const symbol = "WLFIUSDT";
const timeframe = "5m";

console.log(`\n📊 Testing screenshot for ${symbol}...`);
console.log("-".repeat(60));

// Test 1: Direct ChartScreenshotService
console.log("\n🧪 TEST 1: Direct ChartScreenshotService.captureChart()");
try {
  const start = Date.now();
  const screenshot = await ChartScreenshotService.captureChart(symbol, timeframe);
  const time = Date.now() - start;
  
  console.log(`✅ Screenshot generated: ${screenshot ? screenshot.length : 0} bytes`);
  console.log(`⏱️  Time taken: ${time}ms`);
  console.log(`📸 Is Buffer: ${Buffer.isBuffer(screenshot)}`);
  console.log(`📸 Buffer length > 0: ${screenshot && screenshot.length > 0}`);
  
  // Check PNG signature
  if (screenshot && screenshot.length > 0) {
    const isPNG = screenshot[0] === 0x89 && screenshot[1] === 0x50;
    const isJPEG = screenshot[0] === 0xff && screenshot[1] === 0xd8;
    console.log(`📸 Is PNG: ${isPNG}`);
    console.log(`📸 Is JPEG: ${isJPEG}`);
  }
} catch (error) {
  console.error(`❌ Direct screenshot failed:`, error.message);
}

// Test 2: ScreenshotCacheService
console.log("\n🧪 TEST 2: ScreenshotCacheService.getScreenshot()");
try {
  const start = Date.now();
  const screenshot = await ScreenshotCacheService.getScreenshot(symbol, timeframe);
  const time = Date.now() - start;
  
  console.log(`✅ Screenshot from cache: ${screenshot ? screenshot.length : 0} bytes`);
  console.log(`⏱️  Time taken: ${time}ms`);
  console.log(`📸 Is Buffer: ${Buffer.isBuffer(screenshot)}`);
  console.log(`📸 Buffer length > 0: ${screenshot && screenshot.length > 0}`);
} catch (error) {
  console.error(`❌ Cache screenshot failed:`, error.message);
}

// Test 3: Check cache stats
console.log("\n🧪 TEST 3: Cache Statistics");
const stats = ScreenshotCacheService.getStats();
console.log(`Fresh Cache Size: ${stats.freshCacheSize}`);
console.log(`Backup Cache Size: ${stats.backupCacheSize}`);
console.log(`Active Symbols: ${stats.activeSymbolsCount}`);
console.log(`Cached Keys: ${stats.freshKeys.join(", ")}`);

// Test 4: Simulate notify-worker logic
console.log("\n🧪 TEST 4: Simulating Notify-Worker Logic");
console.log("-".repeat(60));

const alertData = {
  symbol: "WLFIUSDT",
  actualValue: 0.000,
  triggeredPrice: 0.144500,
  baselinePrice: 0.143800,
  changeFromBaselinePercent: 0.487,
  volume: 531780176.9,
  triggeredAt: new Date(),
};

console.log(`📸 Getting screenshot for ${alertData.symbol}...`);

try {
  const screenshotPromise = ScreenshotCacheService.getScreenshot(
    alertData.symbol,
    timeframe
  ).catch(err => {
    console.error(`❌ Screenshot failed:`, err.message);
    return null;
  });

  const timeoutPromise = new Promise(resolve => 
    setTimeout(() => {
      console.log("⏰ 2 second timeout reached");
      resolve(null);
    }, 2000)
  );

  const chartScreenshot = await Promise.race([screenshotPromise, timeoutPromise]);

  console.log(`\n📊 RESULT:`);
  console.log(`Screenshot exists: ${!!chartScreenshot}`);
  console.log(`Is Buffer: ${Buffer.isBuffer(chartScreenshot)}`);
  console.log(`Buffer length: ${chartScreenshot ? chartScreenshot.length : 0}`);
  console.log(`Buffer length > 0: ${chartScreenshot && chartScreenshot.length > 0}`);

  if (chartScreenshot && Buffer.isBuffer(chartScreenshot) && chartScreenshot.length > 0) {
    console.log(`\n✅ SCREENSHOT VALID - Would send photo alert`);
  } else {
    console.log(`\n❌ SCREENSHOT INVALID - Would send text-only alert`);
    console.log(`\nReasons:`);
    console.log(`  - Screenshot is null: ${chartScreenshot === null}`);
    console.log(`  - Not a Buffer: ${!Buffer.isBuffer(chartScreenshot)}`);
    console.log(`  - Empty buffer: ${chartScreenshot && chartScreenshot.length === 0}`);
  }
} catch (error) {
  console.error(`❌ Simulation failed:`, error.message);
}

console.log("\n" + "=".repeat(60));
console.log("✅ Debug completed!");

process.exit(0);
