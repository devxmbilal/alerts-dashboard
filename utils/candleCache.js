/**
 * Candle Cache Service
 * Stores candle data in Redis to avoid repeated Binance API calls
 * Prevents IP bans and ensures charts are always available
 */

import Redis from "ioredis";

class CandleCacheService {
    constructor() {
        this.redis = null;
        this.isConnected = false;
        this.localCache = new Map(); // In-memory fallback
        this.maxCandlesPerSymbol = 150; // Store 150 candles per symbol/timeframe
        this.cacheExpiry = 86400; // 24 hours in Redis
    }

    async connect() {
        if (this.isConnected && this.redis) return this.redis;

        try {
            this.redis = new Redis({
                host: process.env.REDIS_HOST || "localhost",
                port: parseInt(process.env.REDIS_PORT) || 6379,
                password: process.env.REDIS_PASSWORD || undefined,
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
                lazyConnect: false,
            });

            this.redis.on("connect", () => {
                this.isConnected = true;
                console.log("✅ CandleCache: Redis connected");
            });

            this.redis.on("error", (err) => {
                console.error("❌ CandleCache Redis error:", err.message);
                this.isConnected = false;
            });

            await this.redis.ping();
            this.isConnected = true;
            return this.redis;
        } catch (error) {
            console.error("❌ CandleCache: Failed to connect to Redis:", error.message);
            this.isConnected = false;
            return null;
        }
    }

    /**
     * Get cache key for a symbol/timeframe
     */
    getCacheKey(symbol, timeframe) {
        return `candles:${symbol}:${timeframe}`;
    }

    /**
     * Store candle data (called from WebSocket updates)
     * @param {string} symbol - Trading pair (e.g., BTCUSDT)
     * @param {string} timeframe - Timeframe (e.g., 5m, 15m, 1h)
     * @param {object} candle - Candle data {open, high, low, close, volume, timestamp}
     */
    async storeCandle(symbol, timeframe, candle) {
        const key = this.getCacheKey(symbol, timeframe);

        try {
            // Store in local cache first (always works)
            if (!this.localCache.has(key)) {
                this.localCache.set(key, []);
            }
            const localCandles = this.localCache.get(key);

            // Check if this candle already exists (update if same timestamp)
            const existingIndex = localCandles.findIndex(
                c => c.timestamp === candle.timestamp
            );

            if (existingIndex >= 0) {
                // 🔥 FIX: MERGE high/low instead of replacing entire candle
                // This preserves the high/low from all price updates in this candle period
                const existing = localCandles[existingIndex];
                localCandles[existingIndex] = {
                    ...existing,
                    high: Math.max(existing.high || candle.high, candle.high || candle.close),
                    low: Math.min(existing.low || candle.low, candle.low || candle.close),
                    close: candle.close,  // Always update close to latest
                    volume: candle.volume || existing.volume,
                };
            } else {
                // Add new candle
                localCandles.push(candle);
                // Keep only last N candles
                if (localCandles.length > this.maxCandlesPerSymbol) {
                    localCandles.shift();
                }
            }

            // Store in Redis (async, non-blocking)
            if (this.isConnected && this.redis) {
                const serialized = JSON.stringify(localCandles);
                await this.redis.setex(key, this.cacheExpiry, serialized);
            }
        } catch (error) {
            // Don't throw - caching is best-effort
            console.warn(`⚠️ CandleCache store error for ${symbol}:`, error.message);
        }
    }

    /**
     * Store multiple candles at once (from Binance API)
     */
    async storeCandles(symbol, timeframe, candles) {
        const key = this.getCacheKey(symbol, timeframe);

        try {
            // Store in local cache
            const sortedCandles = candles.sort((a, b) => a.timestamp - b.timestamp);
            const limitedCandles = sortedCandles.slice(-this.maxCandlesPerSymbol);
            this.localCache.set(key, limitedCandles);

            // Store in Redis
            if (this.isConnected && this.redis) {
                const serialized = JSON.stringify(limitedCandles);
                await this.redis.setex(key, this.cacheExpiry, serialized);
            }
        } catch (error) {
            console.warn(`⚠️ CandleCache bulk store error for ${symbol}:`, error.message);
        }
    }

    /**
     * Get cached candles for chart generation
     * @param {string} symbol - Trading pair
     * @param {string} timeframe - Timeframe
     * @param {number} limit - Number of candles to return (default 100)
     * @returns {Array|null} - Array of candles or null if not cached
     */
    async getCandles(symbol, timeframe, limit = 100) {
        const key = this.getCacheKey(symbol, timeframe);

        try {
            // Try local cache first (fastest)
            if (this.localCache.has(key)) {
                const candles = this.localCache.get(key);
                if (candles && candles.length >= limit * 0.5) { // At least 50% of requested
                    console.log(`📊 CandleCache: Using local cache for ${symbol} (${candles.length} candles)`);
                    return candles.slice(-limit);
                }
            }

            // Try Redis
            if (this.isConnected && this.redis) {
                const cached = await this.redis.get(key);
                if (cached) {
                    const candles = JSON.parse(cached);
                    // Update local cache
                    this.localCache.set(key, candles);
                    console.log(`📊 CandleCache: Using Redis cache for ${symbol} (${candles.length} candles)`);
                    return candles.slice(-limit);
                }
            }

            // No cache available
            console.log(`📊 CandleCache: No cache for ${symbol}/${timeframe}`);
            return null;
        } catch (error) {
            console.warn(`⚠️ CandleCache get error for ${symbol}:`, error.message);
            return null;
        }
    }

    /**
     * Check if we have enough cached data for a symbol
     */
    async hasSufficientCache(symbol, timeframe, minCandles = 50) {
        const candles = await this.getCandles(symbol, timeframe, minCandles);
        return candles && candles.length >= minCandles;
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            localCacheSize: this.localCache.size,
            isRedisConnected: this.isConnected,
            symbolsCached: Array.from(this.localCache.keys()).length,
        };
    }

    /**
     * Clear cache for a symbol
     */
    async clearCache(symbol, timeframe) {
        const key = this.getCacheKey(symbol, timeframe);
        this.localCache.delete(key);
        if (this.isConnected && this.redis) {
            await this.redis.del(key);
        }
    }
}

// Export singleton
const candleCache = new CandleCacheService();
export default candleCache;
