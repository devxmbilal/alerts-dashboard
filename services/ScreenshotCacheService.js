import ChartScreenshotService from "../utils/chartScreenshot.js";

class ScreenshotCacheService {
  constructor() {
    this.cache = new Map(); // symbol_timeframe -> { screenshot, timestamp }
    this.cacheTTL = 30000; // 30 seconds cache
    this.isWarming = false;
    this.popularSymbols = []; // Will be updated dynamically
  }

  /**
   * Get screenshot from cache or generate new one
   */
  async getScreenshot(symbol, timeframe = "5m") {
    const key = `${symbol}_${timeframe}`;
    const cached = this.cache.get(key);

    // Return cached if fresh (< 30s old)
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log(`✅ Cache HIT for ${symbol} (${timeframe})`);
      return cached.screenshot;
    }

    // Generate new screenshot
    console.log(`⚡ Cache MISS for ${symbol} (${timeframe}), generating...`);
    const screenshot = await ChartScreenshotService.captureChart(
      symbol,
      timeframe
    );

    // Cache it
    if (screenshot) {
      this.cache.set(key, {
        screenshot,
        timestamp: Date.now(),
      });
    }

    return screenshot;
  }

  /**
   * Pre-warm cache for popular symbols
   */
  async prewarmCache(symbols, timeframe = "5m") {
    if (this.isWarming) {
      console.log("⏳ Cache warming already in progress");
      return;
    }

    this.isWarming = true;
    console.log(`🔥 Pre-warming cache for ${symbols.length} symbols...`);

    try {
      // Generate screenshots in parallel (max 5 at once)
      const batchSize = 5;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (symbol) => {
            try {
              await this.getScreenshot(symbol, timeframe);
            } catch (error) {
              console.error(`❌ Failed to prewarm ${symbol}:`, error.message);
            }
          })
        );
      }

      console.log(`✅ Cache pre-warming completed`);
    } finally {
      this.isWarming = false;
    }
  }

  /**
   * Update popular symbols list
   */
  updatePopularSymbols(symbols) {
    this.popularSymbols = symbols;
    console.log(`📊 Updated popular symbols: ${symbols.join(", ")}`);
  }

  /**
   * Auto-refresh cache for popular symbols
   */
  startAutoRefresh(intervalMs = 25000) {
    // Refresh every 25s (before 30s TTL)
    setInterval(async () => {
      if (this.popularSymbols.length > 0) {
        console.log(`🔄 Auto-refreshing cache for popular symbols...`);
        await this.prewarmCache(this.popularSymbols);
      }
    }, intervalMs);
  }

  /**
   * Clear old cache entries
   */
  cleanup() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTTL) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache stats
   */
  getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
      isWarming: this.isWarming,
      popularSymbols: this.popularSymbols,
    };
  }
}

export default new ScreenshotCacheService();
