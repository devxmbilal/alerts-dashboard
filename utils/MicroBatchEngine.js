// Micro-Batch Execution Engine for Ultra-High Performance Alert Processing
import pLimit from "p-limit";
import { performance } from "perf_hooks";

export class MicroBatchExecutionEngine {
  constructor(options = {}) {
    // Configuration
    this.batchSize = options.batchSize || 100; // Process 100 symbols per batch
    this.batchInterval = options.batchInterval || 30; // 🔥 Conservative Fix: 30ms (was 50ms) for better spike detection
    this.maxConcurrentBatches = options.maxConcurrentBatches || 20; // 20 parallel batches
    this.targetThroughput = options.targetThroughput || 50000; // 50k alerts per minute

    // Active symbols cache (only symbols with alerts)
    this.activeSymbolsSet = new Set();
    this.symbolAlertCount = new Map(); // symbol -> alert count for prioritization
    this.lastActiveSymbolsUpdate = 0;
    this.activeSymbolsUpdateInterval = 30000; // Update every 30 seconds

    // Batch processing queues
    this.pendingSymbols = new Map(); // symbol -> latest price data
    this.processingQueue = [];
    this.batchTimer = null;

    // Performance metrics
    this.metrics = {
      totalProcessed: 0,
      batchesProcessed: 0,
      avgBatchSize: 0,
      avgProcessingTime: 0,
      throughputPerMinute: 0,
      cpuEfficiency: 0, // percentage of relevant processing
      duplicatesFiltered: 0,
      lastResetTime: Date.now(),
    };

    // Concurrency control
    this.batchProcessor = pLimit(this.maxConcurrentBatches);

    // Real-time throughput tracking
    this.throughputTracker = {
      processedInLastMinute: [],
      startTime: Date.now(),
    };

    console.log(
      `🚀 Micro-Batch Engine initialized: ${this.batchSize} batch size, ${this.maxConcurrentBatches} concurrent batches`
    );
  }

  // Update active symbols cache (called when alerts are created/deleted)
  updateActiveSymbols(alerts) {
    const newActiveSymbols = new Set();
    const newSymbolAlertCount = new Map();

    // Extract unique symbols from alerts
    for (const alert of alerts) {
      if (alert.symbol) {
        newActiveSymbols.add(alert.symbol);
        newSymbolAlertCount.set(
          alert.symbol,
          (newSymbolAlertCount.get(alert.symbol) || 0) + 1
        );
      }
    }

    // Update cache
    this.activeSymbolsSet = newActiveSymbols;
    this.symbolAlertCount = newSymbolAlertCount;
    this.lastActiveSymbolsUpdate = Date.now();

    console.log(
      `📊 Active symbols updated: ${this.activeSymbolsSet.size} symbols with alerts`
    );
    console.log(
      `📈 Top symbols by alert count:`,
      Array.from(newSymbolAlertCount.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
    );
  }

  // Ultra-fast symbol filtering (O(1) lookup)
  filterRelevantSymbols(binanceTickerArray) {
    const startTime = performance.now();
    const relevantUpdates = new Map();
    let totalReceived = 0;
    let relevantFound = 0;

    // Process all tickers in the message
    for (const ticker of binanceTickerArray) {
      totalReceived++;

      // O(1) lookup - only process if we have alerts for this symbol
      if (this.activeSymbolsSet.has(ticker.s)) {
        relevantFound++;

        // Store latest price data for batching
        relevantUpdates.set(ticker.s, {
          symbol: ticker.s,
          price: parseFloat(ticker.c), // Current price
          change: parseFloat(ticker.P), // Price change percent
          priceChangePercent: parseFloat(ticker.P), // 24-hour price change percent from Binance
          priceChange: parseFloat(ticker.p), // 24-hour price change amount
          // ✅ FIX: Use ticker.q (quote volume in USDT) instead of ticker.v (base volume)
          volume: parseFloat(ticker.q),      // Quote volume (USDT) - CORRECT!
          volume24h: parseFloat(ticker.q),   // Quote volume (USDT)
          high: parseFloat(ticker.h), // 24h high
          low: parseFloat(ticker.l), // 24h low
          open: parseFloat(ticker.o), // 24h open
          close: parseFloat(ticker.c), // 24h close (current price)
          timestamp: Date.now(),
          rawTicker: ticker,
        });
      }
    }

    const processingTime = performance.now() - startTime;

    // Update efficiency metrics
    const efficiency =
      totalReceived > 0 ? (relevantFound / totalReceived) * 100 : 0;
    this.metrics.cpuEfficiency = efficiency;

    console.log(
      `⚡ Symbol Filter: ${relevantFound}/${totalReceived} relevant (${efficiency.toFixed(
        1
      )}% efficiency) in ${processingTime.toFixed(2)}ms`
    );

    return relevantUpdates;
  }

  // Add symbols to micro-batch queue
  addToBatch(relevantUpdates) {
    // Add to pending symbols (overwrites old price data for same symbol)
    for (const [symbol, priceData] of relevantUpdates) {
      this.pendingSymbols.set(symbol, priceData);
    }

    // Start batch timer if not running
    if (!this.batchTimer && this.pendingSymbols.size > 0) {
      this.scheduleBatchProcessing();
    }

    // Force process if batch is full
    if (this.pendingSymbols.size >= this.batchSize) {
      this.processBatchNow();
    }
  }

  // Schedule batch processing
  scheduleBatchProcessing() {
    this.batchTimer = setTimeout(() => {
      this.processBatchNow();
    }, this.batchInterval);
  }

  // Process current batch immediately
  processBatchNow() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.pendingSymbols.size === 0) {
      return;
    }

    // Create batch from pending symbols
    const currentBatch = new Map(this.pendingSymbols);
    this.pendingSymbols.clear();

    // Process batch with concurrency control
    this.batchProcessor(async () => {
      await this.executeBatch(currentBatch);
    });

    // Schedule next batch if there are pending symbols
    if (this.pendingSymbols.size > 0) {
      this.scheduleBatchProcessing();
    }
  }

  // Execute a single micro-batch
  async executeBatch(batch) {
    const batchStartTime = performance.now();
    const batchId = Date.now() + Math.random();
    const batchSize = batch.size;

    try {
      console.log(`🔥 Processing batch ${batchId}: ${batchSize} symbols`);

      // Sort symbols by priority (more alerts = higher priority)
      const sortedSymbols = Array.from(batch.entries()).sort(
        ([symbolA], [symbolB]) => {
          const countA = this.symbolAlertCount.get(symbolA) || 0;
          const countB = this.symbolAlertCount.get(symbolB) || 0;
          return countB - countA;
        }
      );

      // Process all symbols in parallel (within this batch)
      const batchPromises = sortedSymbols.map(([symbol, priceData]) =>
        this.processSingleSymbol(symbol, priceData, batchId)
      );

      const results = await Promise.allSettled(batchPromises);

      // Count successes and failures
      let successCount = 0;
      let errorCount = 0;

      for (const result of results) {
        if (result.status === "fulfilled") {
          successCount++;
        } else {
          errorCount++;
          console.error(
            `❌ Batch ${batchId} symbol error:`,
            result.reason?.message || result.reason
          );
        }
      }

      const batchTime = performance.now() - batchStartTime;

      // Update metrics
      this.updateMetrics(batchSize, batchTime, successCount);

      console.log(
        `✅ Batch ${batchId} completed: ${successCount}/${batchSize} success in ${batchTime.toFixed(
          2
        )}ms`
      );

      if (errorCount > 0) {
        console.log(`⚠️ Batch ${batchId} had ${errorCount} errors`);
      }
    } catch (error) {
      console.error(`❌ Batch ${batchId} failed:`, error);
    }
  }

  // Process a single symbol (to be implemented by caller)
  async processSingleSymbol(symbol, priceData, batchId) {
    // This will be overridden by the caller to provide actual processing logic
    throw new Error("processSingleSymbol must be implemented by caller");
  }

  // Update performance metrics
  updateMetrics(batchSize, processingTime, successCount) {
    this.metrics.totalProcessed += successCount;
    this.metrics.batchesProcessed++;

    // Update moving averages
    this.metrics.avgBatchSize =
      (this.metrics.avgBatchSize * (this.metrics.batchesProcessed - 1) +
        batchSize) /
      this.metrics.batchesProcessed;

    this.metrics.avgProcessingTime =
      (this.metrics.avgProcessingTime * (this.metrics.batchesProcessed - 1) +
        processingTime) /
      this.metrics.batchesProcessed;

    // Update throughput tracking
    const now = Date.now();
    this.throughputTracker.processedInLastMinute.push({
      count: successCount,
      timestamp: now,
    });

    // Remove entries older than 1 minute
    this.throughputTracker.processedInLastMinute =
      this.throughputTracker.processedInLastMinute.filter(
        (entry) => now - entry.timestamp <= 60000
      );

    // Calculate current throughput per minute
    this.metrics.throughputPerMinute =
      this.throughputTracker.processedInLastMinute.reduce(
        (sum, entry) => sum + entry.count,
        0
      );
  }

  // Get real-time performance statistics
  getPerformanceStats() {
    const runtime = Date.now() - this.throughputTracker.startTime;
    const runtimeMinutes = runtime / 60000;

    return {
      // Processing stats
      totalProcessed: this.metrics.totalProcessed,
      batchesProcessed: this.metrics.batchesProcessed,
      avgBatchSize: Math.round(this.metrics.avgBatchSize),
      avgProcessingTime: Math.round(this.metrics.avgProcessingTime),

      // Performance stats
      currentThroughputPerMinute: this.metrics.throughputPerMinute,
      targetThroughput: this.targetThroughput,
      throughputAchievement: Math.round(
        (this.metrics.throughputPerMinute / this.targetThroughput) * 100
      ),

      // Efficiency stats
      cpuEfficiency: Math.round(this.metrics.cpuEfficiency),
      duplicatesFiltered: this.metrics.duplicatesFiltered,

      // System stats
      activeSymbols: this.activeSymbolsSet.size,
      pendingSymbols: this.pendingSymbols.size,
      runtime: Math.round(runtime / 1000), // seconds

      // Health indicators
      isTargetMet: this.metrics.throughputPerMinute >= this.targetThroughput,
      systemHealth: this.calculateSystemHealth(),
    };
  }

  // Calculate overall system health score
  calculateSystemHealth() {
    let score = 100;

    // Throughput score (40% weight)
    const throughputScore = Math.min(
      (this.metrics.throughputPerMinute / this.targetThroughput) * 40,
      40
    );

    // Efficiency score (30% weight)
    const efficiencyScore = (this.metrics.cpuEfficiency / 100) * 30;

    // Processing time score (20% weight)
    const timeScore =
      this.metrics.avgProcessingTime <= 100
        ? 20
        : Math.max(0, 20 - (this.metrics.avgProcessingTime - 100) / 10);

    // Error rate score (10% weight)
    const errorRate =
      this.metrics.batchesProcessed > 0
        ? (this.metrics.totalProcessed /
          (this.metrics.batchesProcessed * this.metrics.avgBatchSize)) *
        10
        : 10;

    score = Math.round(
      throughputScore + efficiencyScore + timeScore + errorRate
    );

    return {
      overall: Math.max(0, Math.min(100, score)),
      throughput: Math.round(throughputScore),
      efficiency: Math.round(efficiencyScore),
      speed: Math.round(timeScore),
      reliability: Math.round(errorRate),
    };
  }

  // Reset metrics (for testing or periodic reset)
  resetMetrics() {
    this.metrics = {
      totalProcessed: 0,
      batchesProcessed: 0,
      avgBatchSize: 0,
      avgProcessingTime: 0,
      throughputPerMinute: 0,
      cpuEfficiency: 0,
      duplicatesFiltered: 0,
      lastResetTime: Date.now(),
    };

    this.throughputTracker = {
      processedInLastMinute: [],
      startTime: Date.now(),
    };

    console.log("📊 Metrics reset");
  }

  // Shutdown the engine
  shutdown() {
    console.log("🛑 Shutting down Micro-Batch Engine...");

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Process any remaining symbols
    if (this.pendingSymbols.size > 0) {
      console.log(
        `📤 Processing ${this.pendingSymbols.size} remaining symbols...`
      );
      this.processBatchNow();
    }

    console.log("✅ Micro-Batch Engine shutdown complete");
  }
}

export default MicroBatchExecutionEngine;
