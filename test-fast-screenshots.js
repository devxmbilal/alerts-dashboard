/**
 * 🚀 QUICK SETUP SCRIPT
 * 
 * This script demonstrates the fast screenshot system
 * Run: node test-fast-screenshots.js
 */

import FastScreenshotService from "./services/FastScreenshotService.js";
import ImprovedNotificationService from "./services/ImprovedNotificationService.js";
import { connectToMongoDB } from "./utils/mongodb.js";

console.log("🚀 Starting Fast Screenshot System Test...\n");

// Connect to MongoDB
await connectToMongoDB();

// ========== TEST 1: Initialize Auto-Refresh ==========
console.log("📊 TEST 1: Initialize Auto-Refresh");
FastScreenshotService.startAutoRefresh(2500); // Every 2.5 seconds
console.log("✅ Auto-refresh started (every 2.5 seconds)\n");

// Wait 3 seconds for initial cache warm-up
console.log("⏳ Waiting 3 seconds for initial cache warm-up...");
await new Promise(resolve => setTimeout(resolve, 3000));

// ========== TEST 2: Check Statistics ==========
console.log("\n📊 TEST 2: Check Statistics");
const initialStats = FastScreenshotService.getStats();
console.log(JSON.stringify(initialStats, null, 2));
console.log("");

// ========== TEST 3: Request Screenshots (Cache Performance) ==========
console.log("📊 TEST 3: Request 20 Screenshots");
const testSymbols = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
    "ADAUSDT", "DOGEUSDT", "MATICUSDT", "DOTUSDT", "AVAXUSDT",
    "LINKUSDT", "UNIUSDT", "LTCUSDT", "ATOMUSDT", "ETCUSDT",
    "XLMUSDT", "NEARUSDT", "ALGOUSDT", "VETUSDT", "ICPUSDT"
];

const start = Date.now();

for (const symbol of testSymbols) {
    const result = await FastScreenshotService.getScreenshot(symbol, "5m");

    if (result && result.screenshot) {
        console.log(`  ✅ ${symbol.padEnd(12)} - ${result.source.toUpperCase().padEnd(6)} cache (${result.age}s old)`);
    } else {
        console.log(`  ⏳ ${symbol.padEnd(12)} - Generating in background...`);
    }
}

const duration = Date.now() - start;
console.log(`\n⚡ 20 requests completed in ${duration}ms (${(duration / 20).toFixed(2)}ms avg per request)\n`);

// ========== TEST 4: Final Statistics ==========
console.log("📊 TEST 4: Final Statistics");
const finalStats = FastScreenshotService.getStats();
console.log(JSON.stringify(finalStats, null, 2));
console.log("");

// ========== TEST 5: Simulate High-Volume Alerts ==========
console.log("📊 TEST 5: Simulate 10 Simultaneous Alerts");

const userId = "test-user-id"; // Replace with real user ID for testing
const testAlerts = [];

for (let i = 0; i < 10; i++) {
    const symbol = testSymbols[i];

    const alertPromise = ImprovedNotificationService.sendAlertNotification(
        userId,
        {
            symbol: symbol,
            actualValue: (Math.random() * 10).toFixed(2),
            triggeredPrice: 1000 + Math.random() * 100,
            baselinePrice: 1000,
            changeFromBaselinePercent: (Math.random() * 5).toFixed(2),
            volume: Math.floor(Math.random() * 10000000),
            triggeredAt: new Date(),
            timeframe: "5m"
        },
        {
            telegram: false, // Set to true if testing with real Telegram
            email: false     // Set to true if testing with real Email
        }
    );

    testAlerts.push(alertPromise);
}

const alertStart = Date.now();
const results = await Promise.all(testAlerts);
const alertDuration = Date.now() - alertStart;

console.log(`✅ 10 alerts processed in ${alertDuration}ms (${(alertDuration / 10).toFixed(2)}ms avg per alert)`);
console.log(`   Success: ${results.filter(r => r).length}/10\n`);

// ========== SUMMARY ==========
console.log("═".repeat(60));
console.log("📊 PERFORMANCE SUMMARY");
console.log("═".repeat(60));

const summary = FastScreenshotService.getStats();
console.log(`Cache Hit Rate:        ${summary.hitRate}`);
console.log(`Total Requests:        ${summary.totalRequests}`);
console.log(`Hot Cache Hits:        ${summary.hotHits} (instant)`);
console.log(`Warm Cache Hits:       ${summary.warmHits} (instant + refresh)`);
console.log(`Cold Cache Hits:       ${summary.coldHits} (stale + refresh)`);
console.log(`Cache Misses:          ${summary.misses} (text first, photo later)`);
console.log(`Screenshots Generated: ${summary.generated}`);
console.log(`Generation Failures:   ${summary.failed}`);
console.log(`Active Symbols:        ${summary.activeSymbolsCount}`);
console.log(`Queue Length:          ${summary.queueLength}`);
console.log(`Pending Alerts:        ${summary.pendingAlerts}`);
console.log(`\nCache Sizes:`);
console.log(`  HOT (0-3s):          ${summary.cacheSize.hot} symbols`);
console.log(`  WARM (3-30s):        ${summary.cacheSize.warm} symbols`);
console.log(`  COLD (30s-5m):       ${summary.cacheSize.cold} symbols`);
console.log("═".repeat(60));

console.log("\n✅ Test completed! Auto-refresh will continue in background.");
console.log("💡 Press Ctrl+C to stop.\n");

// Keep process alive to show auto-refresh working
setInterval(() => {
    const liveStats = FastScreenshotService.getStats();
    console.log(`🔄 Live Stats | Hit Rate: ${liveStats.hitRate} | Cache: ${liveStats.cacheSize.hot}H/${liveStats.cacheSize.warm}W/${liveStats.cacheSize.cold}C | Queue: ${liveStats.queueLength}`);
}, 10000); // Update every 10 seconds
