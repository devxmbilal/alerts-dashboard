#!/usr/bin/env node

// 🧪 System Test Script
// Tests all components of the alerts dashboard system

import mongoose from "mongoose";
import Redis from "ioredis";
import { WebSocket } from "ws";
import axios from "axios";

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

async function testDatabase() {
  log("\n🔍 Testing Database Connection...", "blue");

  try {
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/crypto-alerts";
    await mongoose.connect(mongoUri);
    log("✅ MongoDB connected successfully", "green");

    // Test database operations
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    log(`📊 Found ${collections.length} collections`, "blue");

    return true;
  } catch (error) {
    log(`❌ MongoDB connection failed: ${error.message}`, "red");
    return false;
  }
}

async function testRedis() {
  log("\n🔍 Testing Redis Connection...", "blue");

  try {
    const redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
    });

    await redis.ping();
    log("✅ Redis connected successfully", "green");

    // Test Redis operations
    await redis.set("test:system", "working");
    const value = await redis.get("test:system");
    await redis.del("test:system");

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
  log("\n🔍 Testing Binance API Connection...", "blue");

  try {
    const response = await axios.get(
      "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"
    );

    if (response.data && response.data.symbol === "BTCUSDT") {
      log("✅ Binance API accessible", "green");
      log(
        `📊 BTC Price: $${parseFloat(response.data.lastPrice).toFixed(2)}`,
        "blue"
      );
      return true;
    } else {
      log("❌ Binance API returned unexpected data", "red");
      return false;
    }
  } catch (error) {
    log(`❌ Binance API connection failed: ${error.message}`, "red");
    return false;
  }
}

async function testWebSocket() {
  log("\n🔍 Testing Binance WebSocket...", "blue");

  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(
        "wss://stream.binance.com:9443/ws/btcusdt@ticker"
      );

      const timeout = setTimeout(() => {
        ws.close();
        log("❌ WebSocket connection timeout", "red");
        resolve(false);
      }, 10000);

      ws.on("open", () => {
        log("✅ Binance WebSocket connected", "green");
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      });

      ws.on("error", (error) => {
        log(`❌ WebSocket connection failed: ${error.message}`, "red");
        clearTimeout(timeout);
        resolve(false);
      });

      ws.on("message", (data) => {
        try {
          const ticker = JSON.parse(data);
          if (ticker.s === "BTCUSDT") {
            log(
              `📊 Received BTC data: $${parseFloat(ticker.c).toFixed(2)}`,
              "blue"
            );
            clearTimeout(timeout);
            ws.close();
            resolve(true);
          }
        } catch (e) {
          // Ignore parsing errors
        }
      });
    } catch (error) {
      log(`❌ WebSocket test failed: ${error.message}`, "red");
      resolve(false);
    }
  });
}

async function testApplicationFiles() {
  log("\n🔍 Testing Application Files...", "blue");

  const requiredFiles = [
    "app/api/alerts/bulk/route.js",
    "services/RealTimeAlertProcessor.js",
    "workers/binance-worker.js",
    "workers/alert-worker.js",
    "models/Alert.js",
    "models/User.js",
    "ecosystem.config.cjs",
  ];

  const fs = await import("fs");
  let allFilesExist = true;

  for (const file of requiredFiles) {
    try {
      await fs.promises.access(file);
      log(`✅ ${file}`, "green");
    } catch (error) {
      log(`❌ ${file} - Missing`, "red");
      allFilesExist = false;
    }
  }

  return allFilesExist;
}

async function testEnvironmentVariables() {
  log("\n🔍 Testing Environment Variables...", "blue");

  const requiredVars = ["MONGODB_URI", "JWT_SECRET"];

  let allVarsPresent = true;

  for (const varName of requiredVars) {
    if (process.env[varName]) {
      log(`✅ ${varName}`, "green");
    } else {
      log(`❌ ${varName} - Missing`, "red");
      allVarsPresent = false;
    }
  }

  return allVarsPresent;
}

async function runSystemTest() {
  log("🧪 ALERTS DASHBOARD SYSTEM TEST", "bold");
  log("================================", "bold");

  const results = {
    database: await testDatabase(),
    redis: await testRedis(),
    binanceAPI: await testBinanceAPI(),
    websocket: await testWebSocket(),
    files: await testApplicationFiles(),
    environment: await testEnvironmentVariables(),
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
    log("\n🚀 SYSTEM IS READY FOR PRODUCTION!", "green");
    log("All components are working correctly.", "green");
  } else {
    log("\n⚠️  SYSTEM NEEDS ATTENTION", "yellow");
    log("Some components failed. Check the errors above.", "yellow");
  }

  // Close database connection
  if (results.database) {
    await mongoose.disconnect();
  }

  process.exit(passed === total ? 0 : 1);
}

// Run the test
runSystemTest().catch((error) => {
  log(`\n💥 System test failed: ${error.message}`, "red");
  process.exit(1);
});
