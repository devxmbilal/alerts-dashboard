import { NextResponse } from "next/server";
import Redis from "ioredis";

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
  console.error("❌ Redis pairs API error:", err);
});

export async function GET() {
  try {
    // Try to get cached pairs from Redis
    const cachedPairs = await redis.get("crypto:usdt_pairs");

    if (cachedPairs) {
      const pairs = JSON.parse(cachedPairs);
      return NextResponse.json({
        success: true,
        count: pairs.length,
        pairs: pairs,
      });
    }

    // If not cached, fetch from Binance API
    const response = await fetch("https://api.binance.com/api/v3/exchangeInfo");
    const exchangeInfo = await response.json();

    // Filter for USDT spot pairs
    const usdtPairs = exchangeInfo.symbols
      .filter((symbol) => {
        return (
          symbol.status === "TRADING" && // Only active trading pairs
          symbol.symbol.endsWith("USDT") && // Only USDT pairs
          symbol.isSpotTradingAllowed === true && // Only spot trading allowed
          !symbol.symbol.includes("_") && // Exclude premium pairs
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
      .sort();

    // Cache the result for 1 hour
    await redis.setex("crypto:usdt_pairs", 3600, JSON.stringify(usdtPairs));

    return NextResponse.json({
      success: true,
      count: usdtPairs.length,
      pairs: usdtPairs,
    });
  } catch (error) {
    console.error("❌ Error fetching USDT pairs:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch USDT pairs",
        count: 0,
        pairs: [],
      },
      { status: 500 }
    );
  }
}
