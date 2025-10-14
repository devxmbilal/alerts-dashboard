#!/usr/bin/env node

/**
 * 🌐 Network Connectivity Test Script
 * This script tests connectivity to Binance API endpoints
 */

import fetch from "node-fetch";

const BINANCE_ENDPOINTS = [
  "https://api.binance.com/api/v3/ping",
  "https://api1.binance.com/api/v3/ping",
  "https://api2.binance.com/api/v3/ping",
  "https://api3.binance.com/api/v3/ping",
];

async function testEndpoint(url) {
  try {
    console.log(`🔄 Testing: ${url}`);
    const response = await fetch(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AlertsDashboard/1.0)",
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`✅ ${url}: ${JSON.stringify(data)}`);
      return true;
    } else {
      console.log(`❌ ${url}: HTTP ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ ${url}: ${error.message}`);
    return false;
  }
}

async function testConnectivity() {
  console.log("🌐 Testing Binance API connectivity...");
  console.log("=" * 50);

  let successCount = 0;

  for (const endpoint of BINANCE_ENDPOINTS) {
    const success = await testEndpoint(endpoint);
    if (success) successCount++;
    console.log(""); // Empty line for readability
  }

  console.log("=" * 50);
  console.log(
    `📊 Results: ${successCount}/${BINANCE_ENDPOINTS.length} endpoints working`
  );

  if (successCount > 0) {
    console.log("✅ Network connectivity is working!");
    console.log("💡 Your Binance worker should be able to connect");
  } else {
    console.log("❌ Network connectivity issues detected");
    console.log("💡 Try running: sudo ./fix-network-connectivity.sh");
  }
}

// Run the test
testConnectivity()
  .then(() => {
    console.log("🎉 Network test completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Network test failed:", error);
    process.exit(1);
  });
