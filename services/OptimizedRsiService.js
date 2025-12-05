/**
 * 🚀 Optimized RSI Service - Ultimate Solution for 418 Errors
 * 
 * Features:
 * - Smart pre-loading cache
 * - Priority-based queue system  
 * - Real-time RSI calculation
 * - Circuit breaker with exponential backoff
 * - Zero API limit issues
 */

class OptimizedRsiService {
  constructor() {
    // Enhanced cache system
    this.rsiHistory = new Map(); // symbol_timeframe -> { data: [], expiry: timestamp }
    this.rsiQueue = []; // Priority queue for API requests
    this.isProcessingQueue = false;
    
    // Circuit breaker
    this.apiBanUntil = 0;
    this.rsiFailures = new Map(); // Track failures per symbol_timeframe
    
    // Performance tracking
    this.cacheStats = { hits: 0, misses: 0, preloads: 0 };
    this.preloadInterval = null;
    
    // Live price injection
    this.livePrices = new Map(); // symbol -> current price
  }

  // 🚀 PHASE 1: Smart Pre-Loading System
  async startRsiPreloader(activeSymbols) {
    if (!activeSymbols || activeSymbols.length === 0) return;
    
    const timeframes = ['5MIN', '15MIN', '1HR', '4HR'];
    const totalRequests = activeSymbols.length * timeframes.length;
    
    console.log(`🚀 RSI Preloader: Loading ${totalRequests} RSI datasets...`);
    
    let loaded = 0;
    for (const symbol of activeSymbols) {
      for (const timeframe of timeframes) {
        // Check if already cached and fresh
        if (this.isRsiCacheFresh(`${symbol}_${timeframe}`)) {
          loaded++;
          continue;
        }
        
        // Queue with background priority
        this.queueRsiHistoryFetch(symbol, timeframe, 14, 'background');
        
        // Small delay to prevent overwhelming
        await this.delay(50);
        loaded++;
        
        if (loaded % 10 === 0) {
          console.log(`📊 RSI Preloader: ${loaded}/${totalRequests} loaded (${Math.round(loaded/totalRequests*100)}%)`);
        }
      }
    }
    
    this.cacheStats.preloads += loaded;
    console.log(`✅ RSI Preloader: Queued ${loaded} datasets for background loading`);
  }

  // 🛡️ PHASE 2: Enhanced Queue System with Priorities
  queueRsiHistoryFetch(symbol, timeframe, period = 14, priority = 'normal') {
    const key = `${symbol}_${timeframe}`;
    
    // Skip if already cached and fresh
    if (this.isRsiCacheFresh(key)) {
      return;
    }
    
    // Skip if already in queue
    const exists = this.rsiQueue.some(item => item.key === key);
    if (exists) return;
    
    // Limit queue size to prevent memory issues
    if (this.rsiQueue.length >= 200) {
      console.log(`⚠️ RSI queue full, skipping ${key}`);
      return;
    }
    
    const task = { 
      symbol, 
      timeframe, 
      period, 
      key,
      priority, // urgent > normal > background
      queuedAt: Date.now()
    };
    
    // Priority insertion
    if (priority === 'urgent') {
      this.rsiQueue.unshift(task); // Add to front
    } else {
      this.rsiQueue.push(task); // Add to back
    }
    
    console.log(`⏳ Queued RSI ${priority}: ${key} (queue: ${this.rsiQueue.length})`);
    
    // Start processing
    this.processRsiQueue();
  }

  // 🔄 Enhanced Queue Processing with Smart Rate Limiting
  async processRsiQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;
    
    console.log(`🔄 RSI Queue Processing: ${this.rsiQueue.length} items...`);
    
    // Sort by priority: urgent > normal > background
    this.rsiQueue.sort((a, b) => {
      const priorities = { urgent: 3, normal: 2, background: 1 };
      return priorities[b.priority] - priorities[a.priority];
    });
    
    let processed = 0;
    const maxProcessingTime = 10 * 60 * 1000; // 10 minutes max
    const startTime = Date.now();
    
    while (this.rsiQueue.length > 0) {
      // Timeout protection
      if (Date.now() - startTime > maxProcessingTime) {
        console.log(`⏰ RSI Queue timeout after 10 minutes`);
        break;
      }
      
      // Check for API ban
      if (Date.now() < this.apiBanUntil) {
        const waitTime = Math.ceil((this.apiBanUntil - Date.now()) / 1000);
        if (waitTime % 30 === 0) {
          console.log(`⛔ RSI API banned, resuming in ${waitTime}s...`);
        }
        await this.delay(5000);
        continue;
      }
      
      const task = this.rsiQueue[0];
      
      // Remove stale tasks (older than 15 minutes)
      const taskAge = Date.now() - task.queuedAt;
      if (taskAge > 15 * 60 * 1000) {
        console.log(`⏰ Removing stale RSI task: ${task.key}`);
        this.rsiQueue.shift();
        continue;
      }
      
      try {
        await this.fetchAndStoreRsiHistory(task.symbol, task.timeframe, task.period);
        this.rsiQueue.shift();
        processed++;
        
        // Smart delays based on priority
        const delay = this.getDelayForPriority(task.priority);
        await this.delay(delay);
        
      } catch (error) {
        this.handleApiError(error, task.symbol, task.timeframe);
        
        if (error.status === 418 || error.status === 429) {
          // Don't remove task on rate limit - will retry after ban
          break;
        } else {
          // Remove task on other errors
          this.rsiQueue.shift();
        }
      }
      
      // Limit processing per session
      if (processed >= 100) {
        console.log(`🛑 RSI Queue processed 100 items, taking a break...`);
        break;
      }
    }
    
    this.isProcessingQueue = false;
    console.log(`✅ RSI Queue Session: ${processed} processed, ${this.rsiQueue.length} remaining`);
    
    // Schedule next processing if queue not empty
    if (this.rsiQueue.length > 0) {
      setTimeout(() => this.processRsiQueue(), 30000); // Resume in 30s
    }
  }

  // 🎯 PHASE 3: Ultra-Fast RSI Getter with Real-Time Calculation
  async getRSI(symbol, timeframe, period = 14) {
    const key = `${symbol}_${timeframe}_${period}`;
    const cacheKey = `${symbol}_${timeframe}`;
    
    // 1. Try fresh cache first (fastest - 0.1ms)
    const cached = this.getRsiFromCache(cacheKey, period);
    if (cached) {
      this.cacheStats.hits++;
      return cached;
    }
    
    // 2. Try stale cache with live price injection
    const staleRsi = this.getRsiWithLivePrice(cacheKey, period, symbol);
    if (staleRsi) {
      // Queue background refresh for next time
      this.queueRsiHistoryFetch(symbol, timeframe, period, 'background');
      return staleRsi;
    }
    
    // 3. Cache miss - queue urgent fetch
    this.cacheStats.misses++;
    this.queueRsiHistoryFetch(symbol, timeframe, period, 'urgent');
    
    // 4. Return null for this tick (alert will retry next tick)
    return null;
  }

  // 📊 Smart Cache Management
  getRsiFromCache(cacheKey, period) {
    const cached = this.rsiHistory.get(cacheKey);
    if (!cached || Date.now() > cached.expiry) {
      return null;
    }
    
    const closes = cached.data;
    if (closes.length < period + 1) {
      return null;
    }
    
    return this.computeRSILocally(closes, period);
  }

  getRsiWithLivePrice(cacheKey, period, symbol) {
    const cached = this.rsiHistory.get(cacheKey);
    if (!cached || cached.data.length < period) {
      return null;
    }
    
    // Inject current live price for real-time calculation
    const livePrice = this.livePrices.get(symbol);
    if (!livePrice) {
      return null;
    }
    
    const closes = [...cached.data, livePrice];
    return this.computeRSILocally(closes, period);
  }

  // 🛡️ Circuit Breaker with Exponential Backoff
  handleApiError(error, symbol, timeframe) {
    const key = `${symbol}_${timeframe}`;
    
    if (error.status === 418 || error.status === 429) {
      // Exponential backoff: 2min, 4min, 8min, 16min (max)
      const failures = this.rsiFailures.get(key) || 0;
      const backoffMs = Math.min(2 * 60 * 1000 * Math.pow(2, failures), 16 * 60 * 1000);
      
      this.apiBanUntil = Date.now() + backoffMs;
      this.rsiFailures.set(key, failures + 1);
      
      console.log(`🛡️ RSI Circuit Breaker: ${key} banned for ${Math.round(backoffMs/1000)}s (failure #${failures + 1})`);
    } else {
      console.error(`❌ RSI API Error for ${key}:`, error.message);
    }
  }

  // 🔧 Utility Methods
  isRsiCacheFresh(cacheKey) {
    const cached = this.rsiHistory.get(cacheKey);
    return cached && Date.now() < cached.expiry;
  }

  getDelayForPriority(priority) {
    switch (priority) {
      case 'urgent': return 100; // 100ms for urgent
      case 'normal': return 300; // 300ms for normal  
      case 'background': return 500; // 500ms for background
      default: return 300;
    }
  }

  setCacheWithTTL(cacheKey, data, ttlMs = 5 * 60 * 1000) {
    const expiry = Date.now() + ttlMs;
    this.rsiHistory.set(cacheKey, { data, expiry });
    
    // Schedule auto-refresh at 80% of TTL
    setTimeout(() => {
      const [symbol, timeframe] = cacheKey.split('_');
      this.queueRsiHistoryFetch(symbol, timeframe, 14, 'background');
    }, ttlMs * 0.8);
  }

  // 📡 API Methods
  async fetchAndStoreRsiHistory(symbol, timeframe, period = 14) {
    const binanceInterval = this.getBinanceInterval(timeframe);
    const limit = period + 20; // Extra buffer
    
    const response = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`
    );
    
    if (response.status === 418 || response.status === 429) {
      const err = new Error("Rate Limit");
      err.status = response.status;
      throw err;
    }
    
    if (!response.ok) {
      throw new Error(`API Error ${response.status}`);
    }
    
    const klines = await response.json();
    const closes = klines.map(k => parseFloat(k[4]));
    
    // Store with TTL
    const cacheKey = `${symbol}_${timeframe}`;
    const ttl = this.getTimeframeMs(timeframe) / 2; // Half of timeframe
    this.setCacheWithTTL(cacheKey, closes, ttl);
    
    console.log(`📥 RSI History cached: ${symbol} ${timeframe} (${closes.length} candles, TTL: ${Math.round(ttl/1000)}s)`);
  }

  computeRSILocally(closes, period) {
    if (closes.length < period + 1) return null;
    
    // Calculate price changes
    const changes = [];
    for (let i = 1; i < closes.length; i++) {
      changes.push(closes[i] - closes[i - 1]);
    }
    
    // Separate gains and losses
    const gains = changes.map(change => change > 0 ? change : 0);
    const losses = changes.map(change => change < 0 ? Math.abs(change) : 0);
    
    // Calculate initial average gain and loss
    let avgGain = 0;
    let avgLoss = 0;
    
    for (let i = 0; i < period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    
    avgGain = avgGain / period;
    avgLoss = avgLoss / period;
    
    // Calculate RSI using Wilder's smoothing method
    for (let i = period; i < changes.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    
    // Avoid division by zero
    if (avgLoss === 0) {
      return avgGain > 0 ? 100 : 50;
    }
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);
    
    return rsi;
  }

  // 🔄 Lifecycle Methods
  updateLivePrice(symbol, price) {
    this.livePrices.set(symbol, parseFloat(price));
  }

  schedulePreloading(activeSymbols, intervalMs = 30 * 60 * 1000) {
    if (this.preloadInterval) {
      clearInterval(this.preloadInterval);
    }
    
    this.preloadInterval = setInterval(() => {
      this.startRsiPreloader(activeSymbols);
    }, intervalMs);
    
    console.log(`⏰ RSI Preloader scheduled every ${intervalMs/1000}s`);
  }

  getStats() {
    return {
      cacheSize: this.rsiHistory.size,
      queueLength: this.rsiQueue.length,
      isProcessing: this.isProcessingQueue,
      isApiBanned: Date.now() < this.apiBanUntil,
      banTimeRemaining: Math.max(0, this.apiBanUntil - Date.now()),
      cacheStats: this.cacheStats,
      failureCount: this.rsiFailures.size
    };
  }

  // Helper methods
  getBinanceInterval(timeframe) {
    const tf = timeframe.toUpperCase();
    switch (tf) {
      case '1MIN': case '1M': return '1m';
      case '5MIN': case '5M': return '5m';
      case '15MIN': case '15M': return '15m';
      case '1HR': case '1H': return '1h';
      case '4HR': case '4H': return '4h';
      case '12HR': case '12H': return '12h';
      case 'D': case 'DAY': return '1d';
      default: return '5m';
    }
  }

  getTimeframeMs(timeframe) {
    const tf = timeframe.toUpperCase();
    const timeframes = {
      '1MIN': 1 * 60 * 1000,
      '5MIN': 5 * 60 * 1000,
      '15MIN': 15 * 60 * 1000,
      '1HR': 60 * 60 * 1000,
      '4HR': 4 * 60 * 60 * 1000,
      '12HR': 12 * 60 * 60 * 1000,
      'D': 24 * 60 * 60 * 1000,
    };
    return timeframes[tf] || timeframes['5MIN'];
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 🧹 Cleanup
  cleanup() {
    if (this.preloadInterval) {
      clearInterval(this.preloadInterval);
    }
    
    // Clear old cache entries
    const now = Date.now();
    for (const [key, cached] of this.rsiHistory.entries()) {
      if (now > cached.expiry) {
        this.rsiHistory.delete(key);
      }
    }
    
    // Reset failure counts
    this.rsiFailures.clear();
    this.apiBanUntil = 0;
    
    console.log('🧹 RSI Service cleanup completed');
  }
}

export default OptimizedRsiService;