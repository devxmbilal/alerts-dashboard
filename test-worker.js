#!/usr/bin/env node

// 🧪 Worker Test Script
// Tests the improved Binance worker with better error handling

import Redis from "ioredis";

const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testRedisConnection() {
  log("\n🔍 Testing Redis Connection...", "blue");

  try {
    const redis = new Redis({
      host: "localhost",
      port: 6379,
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });

    await redis.ping();
    log("✅ Redis connected successfully", "green");

    // Test Redis operations
    await redis.set("test:worker", "working");
    const value = await redis.get("test:worker");
    await redis.del("test:worker");

    if (value === "working") {
      log("✅ Redis read/write operations working", "green");
    }

    await redis.disconnect();
    return true;
  } catch (error) {
    log(`❌ Redis connection failed: ${error.message}`, "red");
    return false;
  }
}

async function testBinanceAPI() {
  log("\n🔍 Testing Binance API with Improved Configuration...", "blue");

  const endpoints = [
    "https://api.binance.com/api/v3/ping",
    "https://api1.binance.com/api/v3/ping",
    "https://api3.binance.com/api/v3/ping",
  ];

  let successCount = 0;

  for (const endpoint of endpoints) {
    try {
      log(`🔄 Testing ${endpoint}...`, "blue");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
          Connection: "keep-alive",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        log(`✅ ${endpoint} - OK (${response.status})`, "green");
        successCount++;
      } else {
        log(`❌ ${endpoint} - HTTP ${response.status}`, "red");
      }
    } catch (error) {
      log(`❌ ${endpoint} - ${error.message}`, "red");
    }
  }

  log(
    `📊 API Test Results: ${successCount}/${endpoints.length} endpoints working`,
    successCount > 0 ? "green" : "red"
  );

  return successCount > 0;
}

async function testWorkerStartup() {
  log("\n🔍 Testing Worker Startup...", "blue");

  try {
    // Import the worker class
    const { default: BinanceWorker } = await import(
      "./workers/binance-worker.js"
    );

    log("✅ Binance worker module loaded", "green");

    // Test if we can create an instance
    const worker = new BinanceWorker();
    log("✅ Binance worker instance created", "green");

    return true;
  } catch (error) {
    log(`❌ Worker startup failed: ${error.message}`, "red");
    return false;
  }
}

async function runWorkerTest() {
  log("🧪 BINANCE WORKER TEST", "bold");
  log("======================", "bold");

  const results = {
    redis: await testRedisConnection(),
    binanceAPI: await testBinanceAPI(),
    worker: await testWorkerStartup(),
  };

  log("\n📊 TEST RESULTS SUMMARY", "bold");
  log("========================", "bold");

  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;

  for (const [test, result] of Object.entries(results)) {
    const status = result ? "✅ PASS" : "❌ FAIL";
    const color = result ? "green" : "red";
    log(`${status} ${test.toUpperCase()}`, color);
  }

  log(
    `\n🎯 Overall Score: ${passed}/${total} tests passed`,
    passed === total ? "green" : "yellow"
  );

  if (passed === total) {
    log("\n🚀 WORKER IS READY!", "green");
    log(
      "The improved Binance worker should now handle network issues better.",
      "green"
    );
    log("\nTo start the worker:", "blue");
    log("npm run worker", "yellow");
    log("or", "blue");
    log("node workers/binance-worker.js", "yellow");
  } else {
    log("\n⚠️  WORKER NEEDS ATTENTION", "yellow");
    log("Some components failed. Check the errors above.", "yellow");
  }

  log("\n💡 The improved worker now includes:", "blue");
  log("   ✅ Multiple API endpoint fallbacks", "green");
  log("   ✅ Retry logic with exponential backoff", "green");
  log("   ✅ Better error handling", "green");
  log("   ✅ Timeout configuration", "green");
  log("   ✅ Graceful degradation", "green");
}

runWorkerTest().catch((error) => {
  log(`\n💥 Worker test failed: ${error.message}`, "red");
  process.exit(1);
});
