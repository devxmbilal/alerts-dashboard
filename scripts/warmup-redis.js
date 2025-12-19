/**
 * Redis Warmup Script
 * 
 * Run this script after deployment to ensure all market data is cached
 * BEFORE users access the dashboard.
 * 
 * Usage: node scripts/warmup-redis.js
 * 
 * This script:
 * 1. Fetches ALL USDT pairs from Binance in ONE API call
 * 2. Caches them ALL to Redis instantly
 * 3. Ensures dashboard loads with ALL 437+ pairs immediately
 */

import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();

const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    retryDelayOnFailover: 100,
    enableReadyCheck: false,
    maxRetriesPerRequest: 3,
});

redis.on("error", (err) => {
    console.error("❌ Redis error:", err.message);
});

async function warmupRedis() {
    console.log("🔥 Starting Redis Warmup...");
    const startTime = Date.now();

    try {
        // Step 1: Fetch ALL pairs from Binance BULK API (one request)
        console.log("📡 Fetching all USDT pairs from Binance...");

        const response = await fetch("https://api.binance.com/api/v3/ticker/24hr", {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Binance API returned ${response.status}`);
        }

        const tickers = await response.json();
        console.log(`📊 Received ${tickers.length} tickers from Binance`);

        // Step 2: Filter for USDT spot pairs only
        const leveragedTokens = ['BULL', 'BEAR', '3L', '3S', '5L', '5S', '2L', '2S'];

        const usdtPairs = tickers.filter(t => {
            if (!t.symbol.endsWith("USDT")) return false;
            if (t.symbol.includes("_")) return false;
            if (leveragedTokens.some(token => t.symbol.includes(token))) return false;
            if (t.symbol.startsWith("BUSD")) return false;
            if (!t.lastPrice || parseFloat(t.lastPrice) === 0) return false;
            return true;
        });

        console.log(`📊 Filtered to ${usdtPairs.length} USDT spot pairs`);

        // Step 3: Cache ALL data using Redis pipeline (super fast)
        const pipeline = redis.pipeline();
        const pairsList = [];

        for (const t of usdtPairs) {
            const processedData = {
                symbol: t.symbol,
                price: parseFloat(t.lastPrice),
                priceChange: parseFloat(t.priceChange),
                priceChangePercent: parseFloat(t.priceChangePercent),
                change: parseFloat(t.priceChangePercent),
                changeAmount: parseFloat(t.priceChange),
                volume24h: parseFloat(t.quoteVolume),
                high: parseFloat(t.highPrice),
                low: parseFloat(t.lowPrice),
                high24h: parseFloat(t.highPrice),
                low24h: parseFloat(t.lowPrice),
                open: parseFloat(t.openPrice),
                close: parseFloat(t.lastPrice),
                openPrice: parseFloat(t.openPrice),
                closePrice: parseFloat(t.lastPrice),
                timestamp: Date.now(),
                isFavorite: false,
            };

            // Cache with 24h TTL
            pipeline.setex(`crypto:${t.symbol}`, 86400, JSON.stringify(processedData));
            pairsList.push(t.symbol.toLowerCase());
        }

        // Also cache the pairs list
        pipeline.setex("crypto:usdt_pairs", 86400, JSON.stringify(pairsList));

        // Execute all Redis commands at once
        await pipeline.exec();

        const duration = Date.now() - startTime;
        console.log(`\n✅ ========================================`);
        console.log(`✅ Redis Warmup Complete!`);
        console.log(`✅ Cached ${usdtPairs.length} pairs in ${duration}ms`);
        console.log(`✅ Dashboard will now load ALL pairs instantly!`);
        console.log(`✅ ========================================\n`);

        // Verify by counting keys
        const keys = await redis.keys("crypto:*");
        console.log(`📊 Total crypto keys in Redis: ${keys.length}`);

        await redis.quit();
        process.exit(0);

    } catch (error) {
        console.error("❌ Warmup failed:", error.message);
        await redis.quit();
        process.exit(1);
    }
}

warmupRedis();
