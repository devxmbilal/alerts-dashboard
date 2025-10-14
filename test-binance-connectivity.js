#!/usr/bin/env node

// 🔍 Binance API Connectivity Test
// Run this script to test if your server can connect to Binance APIs

import fetch from "node-fetch";

const BINANCE_REST_APIS = [
  "https://api.binance.com/api/v3",
  "https://api1.binance.com/api/v3",
  "https://api2.binance.com/api/v3",
  "https://api3.binance.com/api/v3",
];

async function testConnectivity() {
  console.log("🔍 Testing Binance API connectivity...\n");

  for (const baseUrl of BINANCE_REST_APIS) {
    try {
      console.log(`🔄 Testing: ${baseUrl}/ping`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${baseUrl}/ping`, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        console.log(
          `✅ ${baseUrl} - Status: ${
            response.status
          } - Response: ${JSON.stringify(data)}`
        );
      } else {
        console.log(
          `❌ ${baseUrl} - Status: ${response.status} - ${response.statusText}`
        );
      }
    } catch (error) {
      console.log(`❌ ${baseUrl} - Error: ${error.message}`);
    }
  }

  console.log("\n🔍 Testing exchangeInfo endpoint...\n");

  for (const baseUrl of BINANCE_REST_APIS) {
    try {
      console.log(`🔄 Testing: ${baseUrl}/exchangeInfo`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${baseUrl}/exchangeInfo`, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        console.log(
          `✅ ${baseUrl} - Status: ${response.status} - Symbols: ${
            data.symbols?.length || 0
          }`
        );
      } else {
        console.log(
          `❌ ${baseUrl} - Status: ${response.status} - ${response.statusText}`
        );
      }
    } catch (error) {
      console.log(`❌ ${baseUrl} - Error: ${error.message}`);
    }
  }

  console.log("\n🔍 Testing 24hr ticker endpoint...\n");

  for (const baseUrl of BINANCE_REST_APIS) {
    try {
      console.log(`🔄 Testing: ${baseUrl}/ticker/24hr`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${baseUrl}/ticker/24hr`, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        console.log(
          `✅ ${baseUrl} - Status: ${response.status} - Tickers: ${
            data.length || 0
          }`
        );
      } else {
        console.log(
          `❌ ${baseUrl} - Status: ${response.status} - ${response.statusText}`
        );
      }
    } catch (error) {
      console.log(`❌ ${baseUrl} - Error: ${error.message}`);
    }
  }

  console.log("\n🎯 Connectivity test completed!");
}

// Run the test
testConnectivity().catch(console.error);
