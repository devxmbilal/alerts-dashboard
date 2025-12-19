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
        // Step 1: Fetch exchangeInfo to get VALID trading pairs (like binance-worker does)
        console.log("📡 Fetching exchangeInfo from Binance...");

        const exchangeResponse = await fetch("https://api.binance.com/api/v3/exchangeInfo", {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
            },
        });

        if (!exchangeResponse.ok) {
            throw new Error(`Binance exchangeInfo returned ${exchangeResponse.status}`);
        }

        const exchangeInfo = await exchangeResponse.json();

        // Filter for USDT spot pairs EXACTLY like binance-worker.js does
        const validPairs = new Set(
            exchangeInfo.symbols
                .filter((symbol) => {
                    return (
                        symbol.status === "TRADING" && // Only active trading pairs
                        symbol.symbol.endsWith("USDT") && // Only USDT pairs
                        symbol.isSpotTradingAllowed === true && // Only spot trading allowed
                        !symbol.symbol.includes("_") && // Exclude premium pairs
                        !symbol.symbol.includes("BULL") && // Exclude leveraged tokens
                        !symbol.symbol.includes("BEAR") && // Exclude leveraged tokens
                        !symbol.symbol.includes("3L") && // Exclude leveraged tokens
                        !symbol.symbol.includes("3S") && // Exclude leveraged tokens
                        !symbol.symbol.includes("5L") && // Exclude leveraged tokens
                        !symbol.symbol.includes("5S") && // Exclude leveraged tokens
                        symbol.baseAsset !== "BUSD" && // Exclude BUSD pairs
                        symbol.quoteAsset === "USDT" // Only USDT as quote asset
                    );
                })
                .map((symbol) => symbol.symbol)
        );

        console.log(`📊 Found ${validPairs.size} valid USDT spot pairs from exchangeInfo`);

        // Step 2: Now fetch ticker data
        console.log("📡 Fetching ticker data from Binance...");

        const tickerResponse = await fetch("https://api.binance.com/api/v3/ticker/24hr", {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
            },
        });

        if (!tickerResponse.ok) {
            throw new Error(`Binance ticker API returned ${tickerResponse.status}`);
        }

        const tickers = await tickerResponse.json();
        console.log(`📊 Received ${tickers.length} tickers from Binance`);

        // Step 3: Filter tickers to only include valid pairs from exchangeInfo
        const filteredTickers = tickers.filter(t => validPairs.has(t.symbol));
        console.log(`📊 Filtered to ${filteredTickers.length} valid trading pairs`);

        // Step 4: Cache ALL data using Redis pipeline (super fast)
        const pipeline = redis.pipeline();
        const pairsList = [];

        for (const t of filteredTickers) {
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
        console.log(`✅ Cached ${filteredTickers.length} pairs in ${duration}ms`);
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
