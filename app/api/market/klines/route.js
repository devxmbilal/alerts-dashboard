import { NextResponse } from "next/server";
import Redis from "ioredis";

// Binance API base URL
const BINANCE_API = "https://api.binance.com/api/v3";

// Redis client (lazy initialization)
let redis = null;

const getRedis = () => {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
    });
    redis.on("error", (err) => {
      console.error("Redis klines cache error:", err.message);
    });
  }
  return redis;
};

// Map timeframes to Binance intervals
const getBinanceInterval = (timeframe) => {
  switch (timeframe) {
    case "1m": return "1m";
    case "5m": return "5m";
    case "15m": return "15m";
    case "1h": return "1h";
    case "4h": return "4h";
    case "1d": return "1d";
    default: return "1h";
  }
};

// Cache TTL (in seconds) based on timeframe
const getCacheTTL = (timeframe) => {
  switch (timeframe) {
    case "1m": return 30;    // 30 seconds for 1m
    case "5m": return 60;    // 1 minute for 5m
    case "15m": return 120;  // 2 minutes for 15m
    case "1h": return 300;   // 5 minutes for 1h
    case "4h": return 600;   // 10 minutes for 4h
    case "1d": return 1800;  // 30 minutes for 1d
    default: return 60;
  }
};

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol")?.toUpperCase();
    const timeframe = searchParams.get("timeframe") || "1h";
    const limit = parseInt(searchParams.get("limit")) || 100;

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: "Symbol is required" },
        { status: 400 }
      );
    }

    const interval = getBinanceInterval(timeframe);
    const cacheKey = `klines:${symbol}:${interval}:${limit}`;

    // 🔥 TRY REDIS CACHE FIRST
    try {
      const redisClient = getRedis();
      const cached = await redisClient.get(cacheKey);

      if (cached) {
        const candlestickData = JSON.parse(cached);
        console.log(`📊 Klines cache HIT: ${symbol} ${timeframe}`);
        return NextResponse.json({
          success: true,
          symbol,
          timeframe,
          interval,
          data: candlestickData,
          count: candlestickData.length,
          cached: true,
        });
      }
    } catch (cacheError) {
      console.warn("Redis cache read error:", cacheError.message);
    }

    // 🌐 FALLBACK TO BINANCE API
    console.log(`📊 Klines cache MISS: ${symbol} ${timeframe} - fetching from Binance`);

    const response = await fetch(
      `${BINANCE_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const klines = await response.json();

    // Transform Binance klines data to our format
    const candlestickData = klines.map((kline) => ({
      time: Math.floor(kline[0] / 1000), // Convert to seconds
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
    }));

    // 🔥 CACHE THE RESULT
    try {
      const redisClient = getRedis();
      const ttl = getCacheTTL(timeframe);
      await redisClient.setex(cacheKey, ttl, JSON.stringify(candlestickData));
      console.log(`💾 Klines cached: ${symbol} ${timeframe} for ${ttl}s`);
    } catch (cacheError) {
      console.warn("Redis cache write error:", cacheError.message);
    }

    return NextResponse.json({
      success: true,
      symbol,
      timeframe,
      interval,
      data: candlestickData,
      count: candlestickData.length,
      cached: false,
    });
  } catch (error) {
    console.error("Error fetching klines data:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to fetch candlestick data"
      },
      { status: 500 }
    );
  }
}
