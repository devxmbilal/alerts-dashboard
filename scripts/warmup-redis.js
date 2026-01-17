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
 * 4. 🔥 NEW: Handles IP ban (418) gracefully with fallback
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

// Fallback API endpoints
const BINANCE_ENDPOINTS = [
    "https://api.binance.com/api/v3",
    "https://api1.binance.com/api/v3",
    "https://api3.binance.com/api/v3",
];

// Fallback pairs list (top 200+ pairs) - used when API is blocked
const FALLBACK_PAIRS = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT",
    "AVAXUSDT", "DOTUSDT", "LINKUSDT", "MATICUSDT", "SHIBUSDT", "LTCUSDT", "ATOMUSDT",
    "UNIUSDT", "ETCUSDT", "XLMUSDT", "BCHUSDT", "NEARUSDT", "APTUSDT", "FILUSDT",
    "ARBUSDT", "OPUSDT", "MKRUSDT", "AAVEUSDT", "GRTUSDT", "SANDUSDT", "MANAUSDT",
    "AXSUSDT", "FTMUSDT", "ALGOUSDT", "FLOWUSDT", "VETUSDT", "ICPUSDT", "THETAUSDT",
    "EOSUSDT", "XTZUSDT", "CHZUSDT", "APEUSDT", "LRCUSDT", "CRVUSDT", "DYDXUSDT",
    "ENJUSDT", "GALAUSDT", "GMTUSDT", "IMXUSDT", "LDOUSDT", "QNTUSDT", "RNDRUSDT",
    "RUNEUSDT", "SNXUSDT", "STXUSDT", "SUIUSDT", "WOOUSDT", "ZECUSDT", "ZILUSDT",
    "1INCHUSDT", "COMPUSDT", "DASHUSDT", "KAVAUSDT", "KSMUSDT", "MINAUSDT",
    "NEOUSDT", "OCEANUSDT", "ONTUSDT", "PENDDLEUSDT", "SEIUSDT", "TIAUSDT",
    "WLDUSDT", "CELOUSDT", "CFXUSDT", "COTIUSDT", "HBARUSDT", "HOTUSDT",
    "IOSTUSDT", "IOTAUSDT", "JSTUSDT", "KNCUSDT", "MASKUSDT", "NKNUSDT",
    "OMGUSDT", "ONEUSDT", "RVNUSDT", "SKLUSDT", "STORJUSDT", "SXPUSDT",
    "TRXUSDT", "WAVESUSDT", "ZENUSDT", "GLMRUSDT", "JUVUSDT", "PHAUSDT"
];

async function fetchWithFallback(endpoint, options = {}) {
    for (const baseUrl of BINANCE_ENDPOINTS) {
        try {
            const url = `${baseUrl}${endpoint}`;
            console.log(`🔄 Trying: ${url}`);

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                },
                ...options,
            });

            if (response.status === 418) {
                console.warn(`⚠️ IP banned on ${baseUrl}, trying next endpoint...`);
                continue;
            }

            if (!response.ok) {
                console.warn(`⚠️ ${baseUrl} returned ${response.status}`);
                continue;
            }

            return await response.json();
        } catch (error) {
            console.warn(`⚠️ ${baseUrl} failed: ${error.message}`);
        }
    }
    return null;
}

async function warmupRedis() {
    console.log("🔥 Starting Redis Warmup...");
    const startTime = Date.now();

    try {
        let validPairs = new Set();
        let tickers = null;

        // Step 1: Try to fetch exchangeInfo
        console.log("📡 Fetching exchangeInfo from Binance...");
        const exchangeInfo = await fetchWithFallback("/exchangeInfo");

        if (exchangeInfo && exchangeInfo.symbols) {
            // Filter for USDT spot pairs
            validPairs = new Set(
                exchangeInfo.symbols
                    .filter((symbol) => {
                        return (
                            symbol.status === "TRADING" &&
                            symbol.symbol.endsWith("USDT") &&
                            symbol.isSpotTradingAllowed === true &&
                            !symbol.symbol.includes("_") &&
                            !symbol.symbol.includes("BULL") &&
                            !symbol.symbol.includes("BEAR") &&
                            !symbol.symbol.includes("3L") &&
                            !symbol.symbol.includes("3S") &&
                            !symbol.symbol.includes("5L") &&
                            !symbol.symbol.includes("5S") &&
                            symbol.baseAsset !== "BUSD" &&
                            symbol.quoteAsset === "USDT"
                        );
                    })
                    .map((symbol) => symbol.symbol)
            );
            console.log(`📊 Found ${validPairs.size} valid USDT pairs from API`);
        } else {
            // 🔥 Fallback: Use cached pairs from Redis or hardcoded list
            console.warn("⚠️ Binance API blocked (418), using fallback...");

            const cachedPairs = await redis.get("crypto:usdt_pairs");
            if (cachedPairs) {
                const parsed = JSON.parse(cachedPairs);
                validPairs = new Set(parsed.map(p => p.toUpperCase()));
                console.log(`📊 Using ${validPairs.size} cached pairs from Redis`);
            } else {
                validPairs = new Set(FALLBACK_PAIRS);
                console.log(`📊 Using ${validPairs.size} fallback pairs`);
            }
        }

        // Step 2: Try to fetch ticker data
        console.log("📡 Fetching ticker data...");
        tickers = await fetchWithFallback("/ticker/24hr");

        if (!tickers || tickers.length === 0) {
            console.warn("⚠️ Could not fetch tickers, warmup skipped");
            console.log("ℹ️  WebSocket will populate data when binance-worker starts");
            await redis.quit();
            process.exit(0);
            return;
        }

        console.log(`📊 Received ${tickers.length} tickers from Binance`);

        // Step 3: Filter tickers
        const filteredTickers = tickers.filter(t => validPairs.has(t.symbol));
        console.log(`📊 Filtered to ${filteredTickers.length} valid trading pairs`);

        // Step 4: Cache ALL NEW data using Redis pipeline
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

            pipeline.setex(`crypto:${t.symbol}`, 86400, JSON.stringify(processedData));
            pairsList.push(t.symbol.toLowerCase());
        }

        // Also cache the pairs list
        pipeline.setex("crypto:usdt_pairs", 86400, JSON.stringify(pairsList));

        await pipeline.exec();

        const duration = Date.now() - startTime;
        console.log(`\n✅ ========================================`);
        console.log(`✅ Redis Warmup Complete!`);
        console.log(`✅ Cached ${filteredTickers.length} pairs in ${duration}ms`);
        console.log(`✅ Dashboard will now load ALL pairs instantly!`);
        console.log(`✅ ========================================\n`);

        const keys = await redis.keys("crypto:*");
        console.log(`📊 Total crypto keys in Redis: ${keys.length}`);

        await redis.quit();
        process.exit(0);

    } catch (error) {
        console.error("❌ Warmup failed:", error.message);
        console.log("\n💡 TIP: If IP is banned, wait 10 minutes or restart binance-worker");
        console.log("   WebSocket connection is not affected by IP ban");
        await redis.quit();
        process.exit(1);
    }
}

warmupRedis();

