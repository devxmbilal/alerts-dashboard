import ChartScreenshotService from "../utils/chartScreenshot.js";
import Alert from "../models/Alert.js";

class ScreenshotCacheService {
  constructor() {
    this.cache = new Map(); // symbol_timeframe -> { screenshot, timestamp }
    this.backupCache = new Map(); // Backup cache for fallback (5min old)
    this.cacheTTL = 60000; // 60 seconds fresh cache (reduced API calls)
    this.backupTTL = 300000; // 5 minutes backup cache
    this.isWarming = false;
    this.activeSymbols = []; // Symbols with active alerts
    this.lastActiveSymbolsUpdate = 0;
    this.activeSymbolsUpdateInterval = 300000; // Update every 5 min (was 60s)
  }

  /**
   * Get screenshot from cache or generate new one
   * Priority: Fresh cache (5s) > Backup cache (30s) > Generate new
   */
  async getScreenshot(symbol, timeframe = "5m") {
    const key = `${symbol}_${timeframe}`;
    const now = Date.now();
    const cached = this.cache.get(key);

    // Return fresh cache if available (< 60s old)
    if (cached && now - cached.timestamp < this.cacheTTL) {
      console.log(`✅ FRESH Cache HIT for ${symbol} (${Math.round((now - cached.timestamp) / 1000)}s old)`);
      return cached.screenshot;
    }

    // Check backup cache (1-5min old)
    const backup = this.backupCache.get(key);
    if (backup && now - backup.timestamp < this.backupTTL) {
      console.log(`⚡ BACKUP Cache HIT for ${symbol} (${Math.round((now - backup.timestamp) / 1000)}s old)`);
      return backup.screenshot; // Don't refresh in background to reduce API calls
    }

    // Generate new screenshot (blocking)
    console.log(`❌ Cache MISS for ${symbol}, generating new screenshot...`);
    const screenshot = await ChartScreenshotService.captureChart(
      symbol,
      timeframe
    );

    // Cache it in both fresh and backup
    if (screenshot) {
      const cacheEntry = { screenshot, timestamp: now };
      this.cache.set(key, cacheEntry);
      this.backupCache.set(key, cacheEntry);
      console.log(`✅ Screenshot cached for ${symbol}`);
    }

    return screenshot;
  }

  /**
   * Refresh screenshot in background (non-blocking)
   */
  async refreshScreenshotInBackground(symbol, timeframe) {
    const key = `${symbol}_${timeframe}`;

    try {
      const screenshot = await ChartScreenshotService.captureChart(symbol, timeframe);
      if (screenshot) {
        const now = Date.now();
        const cacheEntry = { screenshot, timestamp: now };
        this.cache.set(key, cacheEntry);
        this.backupCache.set(key, cacheEntry);
        console.log(`🔄 Background refresh completed for ${symbol}`);
      }
    } catch (error) {
      console.error(`❌ Background refresh failed for ${symbol}:`, error.message);
    }
  }

  /**
   * Get active alert symbols from database
   */
  async updateActiveSymbols() {
    const now = Date.now();

    // Skip if updated recently (< 60s ago)
    if (now - this.lastActiveSymbolsUpdate < this.activeSymbolsUpdateInterval) {
      return this.activeSymbols;
    }

    try {
      // Get all active alerts from database
      const activeAlerts = await Alert.find({ status: "active" })
        .select("symbol")
        .lean();

      // Extract unique symbols
      const symbols = [...new Set(activeAlerts.map(alert => alert.symbol))];

      this.activeSymbols = symbols;
      this.lastActiveSymbolsUpdate = now;

      console.log(`📊 Updated active symbols: ${symbols.length} unique symbols`);
      return symbols;
    } catch (error) {
      console.error(`❌ Failed to update active symbols:`, error.message);
      return this.activeSymbols; // Return cached list
    }
  }

  /**
   * Pre-warm cache for active alert symbols
   */
  async prewarmCache(symbols = null, timeframe = "5m") {
    if (this.isWarming) {
      console.log("⏳ Cache warming already in progress");
      return;
    }

    this.isWarming = true;

    try {
      // If no symbols provided, get active alert symbols
      const symbolsToWarm = symbols || await this.updateActiveSymbols();

      if (symbolsToWarm.length === 0) {
        console.log("⚠️ No symbols to pre-warm");
        return;
      }

      console.log(`🔥 Pre-warming cache for ${symbolsToWarm.length} symbols...`);

      // Generate screenshots in batches (max 3 at once to avoid rate limits)
      const batchSize = 3;
      for (let i = 0; i < symbolsToWarm.length; i += batchSize) {
        const batch = symbolsToWarm.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (symbol) => {
            try {
              await this.getScreenshot(symbol, timeframe);
            } catch (error) {
              // Skip on IP ban, don't keep trying
              if (error.message === "BINANCE_IP_BANNED") {
                console.log(`🚫 IP banned, stopping prewarm...`);
                return;
              }
              console.error(`❌ Failed to prewarm ${symbol}:`, error.message);
            }
          })
        );

        // Rate limiting: wait 2s between batches
        if (i + batchSize < symbolsToWarm.length) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      console.log(`✅ Cache pre-warming completed for ${symbolsToWarm.length} symbols`);
    } finally {
      this.isWarming = false;
    }
  }

  /**
   * Auto-refresh cache for active alert symbols
   * Runs every 4 seconds (before 5s TTL expires)
   */
  startAutoRefresh(intervalMs = 4000) {
    console.log(`🚀 Starting auto-refresh every ${intervalMs}ms`);

    setInterval(async () => {
      // Update active symbols list every minute
      const symbols = await this.updateActiveSymbols();

      if (symbols.length > 0) {
        console.log(`🔄 Auto-refreshing cache for ${symbols.length} active symbols...`);
        await this.prewarmCache(symbols);
      } else {
        console.log(`⚠️ No active alerts, skipping cache refresh`);
      }
    }, intervalMs);
  }

  /**
   * Clear old cache entries
   */
  cleanup() {
    const now = Date.now();

    // Clean fresh cache (> 5s old)
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTTL) {
        this.cache.delete(key);
      }
    }

    // Clean backup cache (> 30s old)
    for (const [key, value] of this.backupCache.entries()) {
      if (now - value.timestamp > this.backupTTL) {
        this.backupCache.delete(key);
      }
    }

    console.log(`🧹 Cache cleanup: ${this.cache.size} fresh, ${this.backupCache.size} backup`);
  }

  /**
   * Get cache stats
   */
  getStats() {
    return {
      freshCacheSize: this.cache.size,
      backupCacheSize: this.backupCache.size,
      freshKeys: Array.from(this.cache.keys()),
      backupKeys: Array.from(this.backupCache.keys()),
      isWarming: this.isWarming,
      activeSymbols: this.activeSymbols,
      activeSymbolsCount: this.activeSymbols.length,
      cacheTTL: `${this.cacheTTL}ms`,
      backupTTL: `${this.backupTTL}ms`,
    };
  }
}

export default new ScreenshotCacheService();
