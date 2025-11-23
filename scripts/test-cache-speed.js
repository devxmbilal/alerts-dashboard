import ScreenshotCacheService from "../services/ScreenshotCacheService.js";
import { connectToMongoDB } from "../utils/mongodb.js";
import dotenv from "dotenv";

dotenv.config();

// Connect to MongoDB
await connectToMongoDB();
console.log("✅ MongoDB connected\n");

console.log("🚀 Testing Ultra-Fast Screenshot Cache\n");
console.log("=" .repeat(60));

// Test 1: Cold start (no cache)
console.log("\n📊 TEST 1: Cold Start (No Cache)");
console.log("-".repeat(60));
const symbol1 = "BTCUSDT";
const start1 = Date.now();
const screenshot1 = await ScreenshotCacheService.getScreenshot(symbol1, "5m");
const time1 = Date.now() - start1;
console.log(`⏱️  Time taken: ${time1}ms`);
console.log(`📸 Screenshot size: ${screenshot1 ? screenshot1.length : 0} bytes`);

// Test 2: Immediate retry (fresh cache hit - should be instant)
console.log("\n📊 TEST 2: Immediate Retry (Fresh Cache)");
console.log("-".repeat(60));
const start2 = Date.now();
const screenshot2 = await ScreenshotCacheService.getScreenshot(symbol1, "5m");
const time2 = Date.now() - start2;
console.log(`⏱️  Time taken: ${time2}ms (should be ~0ms)`);
console.log(`📸 Screenshot size: ${screenshot2 ? screenshot2.length : 0} bytes`);

// Test 3: Wait 6 seconds (cache expires, backup cache hit)
console.log("\n📊 TEST 3: After 6 Seconds (Backup Cache)");
console.log("-".repeat(60));
console.log("⏳ Waiting 6 seconds for fresh cache to expire...");
await new Promise(resolve => setTimeout(resolve, 6000));
const start3 = Date.now();
const screenshot3 = await ScreenshotCacheService.getScreenshot(symbol1, "5m");
const time3 = Date.now() - start3;
console.log(`⏱️  Time taken: ${time3}ms (should be ~0ms from backup)`);
console.log(`📸 Screenshot size: ${screenshot3 ? screenshot3.length : 0} bytes`);

// Test 4: Multiple symbols in parallel (simulate 5 alerts/sec)
console.log("\n📊 TEST 4: Multiple Symbols (5 alerts/sec simulation)");
console.log("-".repeat(60));
const symbols = ["ETHUSDT", "BNBUSDT", "SOLUSDT", "ADAUSDT", "XRPUSDT"];
console.log(`🔥 Pre-warming cache for ${symbols.length} symbols...`);
await ScreenshotCacheService.prewarmCache(symbols, "5m");

console.log("\n⚡ Testing parallel requests (simulating 5 alerts at once)...");
const startParallel = Date.now();
const results = await Promise.all(
  symbols.map(async (symbol) => {
    const start = Date.now();
    const screenshot = await ScreenshotCacheService.getScreenshot(symbol, "5m");
    const time = Date.now() - start;
    return { symbol, time, size: screenshot ? screenshot.length : 0 };
  })
);
const totalTime = Date.now() - startParallel;

console.log("\n📈 Results:");
results.forEach(({ symbol, time, size }) => {
  console.log(`  ${symbol}: ${time}ms (${(size / 1024).toFixed(1)}KB)`);
});
console.log(`\n⏱️  Total time for 5 parallel requests: ${totalTime}ms`);
console.log(`📊 Average time per request: ${(totalTime / symbols.length).toFixed(1)}ms`);

// Test 5: Cache stats
console.log("\n📊 TEST 5: Cache Statistics");
console.log("-".repeat(60));
const stats = ScreenshotCacheService.getStats();
console.log(`Fresh Cache Size: ${stats.freshCacheSize}`);
console.log(`Backup Cache Size: ${stats.backupCacheSize}`);
console.log(`Active Symbols: ${stats.activeSymbolsCount}`);
console.log(`Cache TTL: ${stats.cacheTTL}`);
console.log(`Backup TTL: ${stats.backupTTL}`);
console.log(`\nCached Symbols: ${stats.freshKeys.join(", ")}`);

console.log("\n" + "=".repeat(60));
console.log("✅ Cache speed test completed!");
console.log("\n💡 Expected Results:");
console.log("  - Cold start: 1000-2000ms (API call)");
console.log("  - Fresh cache: 0-5ms (instant)");
console.log("  - Backup cache: 0-5ms (instant)");
console.log("  - Parallel requests: 0-10ms total (all from cache)");
console.log("\n🚀 With 4s auto-refresh, 99% of alerts will be instant!");

process.exit(0);
