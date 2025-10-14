#!/usr/bin/env node

/**
 * 🚀 Market Data Population Script
 * This script fetches all USDT pairs from Binance and populates Redis cache
 * Run this script to ensure all pairs are available in the dashboard
 */

import Redis from "ioredis";
import fetch from "node-fetch";

// Redis configuration
const redis = new Redis({
  host: "localhost",
  port: 6379,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryDelayOnClusterDown: 300,
  maxRetriesPerRequest: 3,
});

// Handle Redis connection errors
redis.on("error", (err) => {
  console.error("❌ Redis error:", err);
});

redis.on("connect", () => {
  console.log("✅ Redis connected");
});

const BINANCE_API = "https://api.binance.com/api/v3";

async function fetchAllUSDTSPairs() {
  try {
    console.log("📊 Fetching all USDT spot pairs from Binance...");

    // Get exchange info to get all trading pairs
    const response = await fetch(`${BINANCE_API}/exchangeInfo`);
    const exchangeInfo = await response.json();

    // Filter for USDT spot pairs (not futures, not delisted, not premium)
    const usdtPairs = exchangeInfo.symbols
      .filter((symbol) => {
        return (
          symbol.status === "TRADING" && // Only active trading pairs
          symbol.symbol.endsWith("USDT") && // Only USDT pairs
          symbol.isSpotTradingAllowed === true && // Only spot trading allowed
          !symbol.symbol.includes("_") && // Exclude premium pairs (usually have _)
          !symbol.symbol.includes("BULL") && // Exclude leveraged tokens
          !symbol.symbol.includes("BEAR") && // Exclude leveraged tokens
          !symbol.symbol.includes("UP") && // Exclude leveraged tokens
          !symbol.symbol.includes("DOWN") && // Exclude leveraged tokens
          !symbol.symbol.includes("3L") && // Exclude leveraged tokens
          !symbol.symbol.includes("3S") && // Exclude leveraged tokens
          !symbol.symbol.includes("5L") && // Exclude leveraged tokens
          !symbol.symbol.includes("5S") && // Exclude leveraged tokens
          symbol.baseAsset !== "BUSD" && // Exclude BUSD pairs
          symbol.quoteAsset === "USDT" // Only USDT as quote asset
        );
      })
      .map((symbol) => symbol.symbol.toLowerCase())
      .sort(); // Sort alphabetically

    console.log(`✅ Found ${usdtPairs.length} USDT spot pairs`);
    return usdtPairs;
  } catch (error) {
    console.error("❌ Error fetching USDT pairs:", error);
    throw error;
  }
}

async function fetchTickerData(symbol) {
  try {
    const response = await fetch(
      `${BINANCE_API}/ticker/24hr?symbol=${symbol.toUpperCase()}`
    );
    const ticker = await response.json();

    return {
      symbol: symbol.toLowerCase(),
      price: parseFloat(ticker.lastPrice),
      change: parseFloat(ticker.priceChange),
      changePercent: parseFloat(ticker.priceChangePercent),
      volume: parseFloat(ticker.volume),
      high: parseFloat(ticker.highPrice),
      low: parseFloat(ticker.lowPrice),
      open: parseFloat(ticker.openPrice),
      close: parseFloat(ticker.lastPrice),
      timestamp: Date.now(),
      isFavorite: false,
    };
  } catch (error) {
    console.error(`❌ Error fetching ticker for ${symbol}:`, error);
    return null;
  }
}

async function populateMarketData() {
  try {
    console.log("🚀 Starting market data population...");

    // Fetch all USDT pairs
    const usdtPairs = await fetchAllUSDTSPairs();

    // Cache the pairs list in Redis
    await redis.setex("crypto:usdt_pairs", 3600, JSON.stringify(usdtPairs));
    console.log("✅ Cached USDT pairs list");

    // Fetch ticker data for all pairs (in batches to avoid rate limits)
    const batchSize = 50;
    const batches = [];

    for (let i = 0; i < usdtPairs.length; i += batchSize) {
      batches.push(usdtPairs.slice(i, i + batchSize));
    }

    console.log(
      `📊 Processing ${batches.length} batches of ${batchSize} pairs each...`
    );

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(
        `📦 Processing batch ${i + 1}/${batches.length} (${
          batch.length
        } pairs)...`
      );

      const promises = batch.map(async (symbol) => {
        const tickerData = await fetchTickerData(symbol);
        if (tickerData) {
          const cacheKey = `crypto:${symbol}`;
          await redis.setex(cacheKey, 300, JSON.stringify(tickerData)); // 5 min cache
          successCount++;
        } else {
          errorCount++;
        }
      });

      await Promise.all(promises);

      // Add delay between batches to avoid rate limits
      if (i < batches.length - 1) {
        console.log("⏳ Waiting 1 second before next batch...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(`✅ Market data population completed!`);
    console.log(`📊 Successfully cached: ${successCount} pairs`);
    console.log(`❌ Failed to cache: ${errorCount} pairs`);
    console.log(`📈 Total pairs available: ${usdtPairs.length}`);

    // Test Redis cache
    const cachedPairs = await redis.get("crypto:usdt_pairs");
    const pairsList = JSON.parse(cachedPairs);
    console.log(`🔍 Redis cache test: ${pairsList.length} pairs cached`);

    // Test a few individual pairs
    const testPairs = pairsList.slice(0, 5);
    for (const pair of testPairs) {
      const cached = await redis.get(`crypto:${pair}`);
      if (cached) {
        const data = JSON.parse(cached);
        console.log(`✅ ${pair}: $${data.price} (${data.changePercent}%)`);
      }
    }
  } catch (error) {
    console.error("❌ Market data population failed:", error);
    process.exit(1);
  } finally {
    await redis.quit();
    console.log("🔌 Redis connection closed");
  }
}

// Run the script
populateMarketData()
  .then(() => {
    console.log("🎉 Market data population script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Script failed:", error);
    process.exit(1);
  });
