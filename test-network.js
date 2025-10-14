#!/usr/bin/env node

// 🌐 Network Diagnostic Script
// Tests connectivity to Binance APIs and other services

import { WebSocket } from "ws";

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

async function testBinanceAPI() {
  log("\n🔍 Testing Binance API Connectivity...", "blue");

  const endpoints = [
    "https://api.binance.com/api/v3/ping",
    "https://api1.binance.com/api/v3/ping",
    "https://api2.binance.com/api/v3/ping",
    "https://api3.binance.com/api/v3/ping",
  ];

  const results = [];

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
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        log(`✅ ${endpoint} - OK (${response.status})`, "green");
        results.push({ endpoint, status: "success", responseTime: Date.now() });
      } else {
        log(`❌ ${endpoint} - HTTP ${response.status}`, "red");
        results.push({ endpoint, status: "error", code: response.status });
      }
    } catch (error) {
      log(`❌ ${endpoint} - ${error.message}`, "red");
      results.push({ endpoint, status: "error", message: error.message });
    }
  }

  return results;
}

async function testBinanceWebSocket() {
  log("\n🔍 Testing Binance WebSocket Connectivity...", "blue");

  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(
        "wss://stream.binance.com:9443/ws/btcusdt@ticker"
      );

      const timeout = setTimeout(() => {
        ws.close();
        log("❌ WebSocket connection timeout", "red");
        resolve({ status: "timeout" });
      }, 15000);

      ws.on("open", () => {
        log("✅ Binance WebSocket connected", "green");
        clearTimeout(timeout);
        ws.close();
        resolve({ status: "success" });
      });

      ws.on("error", (error) => {
        log(`❌ WebSocket connection failed: ${error.message}`, "red");
        clearTimeout(timeout);
        resolve({ status: "error", message: error.message });
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
            resolve({ status: "success", data: ticker });
          }
        } catch (e) {
          // Ignore parsing errors
        }
      });
    } catch (error) {
      log(`❌ WebSocket test failed: ${error.message}`, "red");
      resolve({ status: "error", message: error.message });
    }
  });
}

async function testDNSResolution() {
  log("\n🔍 Testing DNS Resolution...", "blue");

  const domains = [
    "api.binance.com",
    "api1.binance.com",
    "api2.binance.com",
    "api3.binance.com",
    "stream.binance.com",
  ];

  const results = [];

  for (const domain of domains) {
    try {
      // Use Node.js dns module for DNS resolution test
      const { lookup } = await import("dns/promises");
      const addresses = await lookup(domain);
      log(`✅ ${domain} resolves to ${addresses.address}`, "green");
      results.push({ domain, status: "success", address: addresses.address });
    } catch (error) {
      log(`❌ ${domain} DNS resolution failed: ${error.message}`, "red");
      results.push({ domain, status: "error", message: error.message });
    }
  }

  return results;
}

async function testNetworkConnectivity() {
  log("\n🔍 Testing Network Connectivity...", "blue");

  const tests = [
    { name: "Google DNS", url: "https://8.8.8.8" },
    { name: "Cloudflare DNS", url: "https://1.1.1.1" },
    { name: "Google", url: "https://www.google.com" },
  ];

  const results = [];

  for (const test of tests) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(test.url, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        log(`✅ ${test.name} - OK`, "green");
        results.push({ name: test.name, status: "success" });
      } else {
        log(`❌ ${test.name} - HTTP ${response.status}`, "red");
        results.push({
          name: test.name,
          status: "error",
          code: response.status,
        });
      }
    } catch (error) {
      log(`❌ ${test.name} - ${error.message}`, "red");
      results.push({
        name: test.name,
        status: "error",
        message: error.message,
      });
    }
  }

  return results;
}

async function runNetworkDiagnostic() {
  log("🌐 NETWORK DIAGNOSTIC REPORT", "bold");
  log("============================", "bold");

  const results = {
    dns: await testDNSResolution(),
    network: await testNetworkConnectivity(),
    binanceAPI: await testBinanceAPI(),
    binanceWS: await testBinanceWebSocket(),
  };

  log("\n📊 DIAGNOSTIC SUMMARY", "bold");
  log("======================", "bold");

  // DNS Results
  const dnsSuccess = results.dns.filter((r) => r.status === "success").length;
  log(
    `\n🌐 DNS Resolution: ${dnsSuccess}/${results.dns.length} domains resolved`,
    dnsSuccess === results.dns.length ? "green" : "yellow"
  );

  // Network Results
  const networkSuccess = results.network.filter(
    (r) => r.status === "success"
  ).length;
  log(
    `🌍 Network Connectivity: ${networkSuccess}/${results.network.length} tests passed`,
    networkSuccess === results.network.length ? "green" : "yellow"
  );

  // Binance API Results
  const apiSuccess = results.binanceAPI.filter(
    (r) => r.status === "success"
  ).length;
  log(
    `📡 Binance API: ${apiSuccess}/${results.binanceAPI.length} endpoints accessible`,
    apiSuccess > 0 ? "green" : "red"
  );

  // Binance WebSocket Results
  const wsSuccess = results.binanceWS.status === "success";
  log(
    `🔌 Binance WebSocket: ${wsSuccess ? "Connected" : "Failed"}`,
    wsSuccess ? "green" : "red"
  );

  // Overall Assessment
  const totalTests =
    results.dns.length + results.network.length + results.binanceAPI.length + 1;
  const totalSuccess =
    dnsSuccess + networkSuccess + apiSuccess + (wsSuccess ? 1 : 0);

  log(
    `\n🎯 Overall Score: ${totalSuccess}/${totalTests} tests passed`,
    totalSuccess === totalTests ? "green" : "yellow"
  );

  if (apiSuccess === 0) {
    log("\n⚠️  BINANCE API ISSUES DETECTED", "yellow");
    log("Possible solutions:", "blue");
    log("1. Check firewall settings", "blue");
    log("2. Verify DNS configuration", "blue");
    log("3. Check if server has internet access", "blue");
    log("4. Try using a VPN or different network", "blue");
  }

  if (wsSuccess === false) {
    log("\n⚠️  WEBSOCKET CONNECTION ISSUES", "yellow");
    log("Possible solutions:", "blue");
    log("1. Check if port 9443 is blocked", "blue");
    log("2. Verify WebSocket support", "blue");
    log("3. Check proxy settings", "blue");
  }

  if (totalSuccess === totalTests) {
    log("\n🚀 NETWORK IS FULLY FUNCTIONAL!", "green");
  } else {
    log("\n⚠️  NETWORK ISSUES DETECTED", "yellow");
    log("Some connectivity problems found. Check the details above.", "yellow");
  }
}

// Run the diagnostic
runNetworkDiagnostic().catch((error) => {
  log(`\n💥 Network diagnostic failed: ${error.message}`, "red");
  process.exit(1);
});
