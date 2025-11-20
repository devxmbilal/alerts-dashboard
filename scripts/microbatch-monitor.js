#!/usr/bin/env node
import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();

class MicroBatchMonitor {
  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: process.env.REDIS_PORT || 6379,
      lazyConnect: true,
      retryDelayOnClusterDown: 300,
      maxRetriesPerRequest: 3,
    });
  }

  async getStats() {
    try {
      console.log("🚀 Fetching Micro-Batch Performance Stats...\n");
      
      // Get micro-batch stats
      await this.redis.publish("system:control", JSON.stringify({
        command: "get_microbatch_stats",
        timestamp: Date.now()
      }));
      
      // Subscribe to stats response
      const subscriber = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT || 6379,
      });
      
      await subscriber.subscribe("system:microbatch:stats");
      
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.log("❌ Timeout waiting for stats");
          subscriber.quit();
          resolve(null);
        }, 5000);
        
        subscriber.on("message", (channel, message) => {
          if (channel === "system:microbatch:stats") {
            clearTimeout(timeout);
            try {
              const stats = JSON.parse(message);
              this.displayStats(stats);
              subscriber.quit();
              resolve(stats);
            } catch (error) {
              console.error("❌ Error parsing stats:", error);
              subscriber.quit();
              resolve(null);
            }
          }
        });
      });
      
    } catch (error) {
      console.error("❌ Error getting stats:", error);
    }
  }

  displayStats(stats) {
    console.log("📊 =============== MICRO-BATCH PERFORMANCE ===============");
    
    // Processing Stats
    console.log("\n🔥 PROCESSING PERFORMANCE:");
    console.log(`   Total Processed: ${stats.totalProcessed.toLocaleString()} alerts`);
    console.log(`   Batches Processed: ${stats.batchesProcessed.toLocaleString()}`);
    console.log(`   Average Batch Size: ${stats.avgBatchSize} symbols`);
    console.log(`   Average Processing Time: ${stats.avgProcessingTime}ms per batch`);
    
    // Throughput Stats
    console.log("\n⚡ THROUGHPUT ANALYSIS:");
    console.log(`   Current Throughput: ${stats.currentThroughputPerMinute.toLocaleString()}/min`);
    console.log(`   Target Throughput: ${stats.targetThroughput.toLocaleString()}/min`);
    console.log(`   Achievement Rate: ${stats.throughputAchievement}% ${stats.isTargetMet ? '✅' : '❌'}`);
    
    // Efficiency Stats  
    console.log("\n🎯 EFFICIENCY METRICS:");
    console.log(`   CPU Efficiency: ${stats.cpuEfficiency}% (relevant symbols processed)`);
    console.log(`   Active Symbols: ${stats.activeSymbols} (out of ~1000 total tickers)`);
    console.log(`   Pending Symbols: ${stats.pendingSymbols} (in queue)`);
    console.log(`   Duplicates Filtered: ${stats.duplicatesFiltered.toLocaleString()}`);
    
    // System Health
    console.log("\n🏥 SYSTEM HEALTH:");
    const health = stats.systemHealth;
    console.log(`   Overall Score: ${health.overall}/100 ${this.getHealthEmoji(health.overall)}`);
    console.log(`   Throughput Score: ${health.throughput}/40`);
    console.log(`   Efficiency Score: ${health.efficiency}/30`);
    console.log(`   Speed Score: ${health.speed}/20`);
    console.log(`   Reliability Score: ${health.reliability}/10`);
    
    // Performance Analysis
    console.log("\n📈 PERFORMANCE ANALYSIS:");
    this.analyzePerformance(stats);
    
    // Runtime Stats
    console.log("\n⏱️ RUNTIME INFO:");
    console.log(`   System Runtime: ${stats.runtime} seconds`);
    console.log(`   Last Updated: ${new Date().toISOString()}`);
    
    console.log("\n====================================================");
  }

  getHealthEmoji(score) {
    if (score >= 90) return "🟢 EXCELLENT";
    if (score >= 80) return "🟡 GOOD";
    if (score >= 70) return "🟠 FAIR";
    return "🔴 NEEDS ATTENTION";
  }

  analyzePerformance(stats) {
    const recommendations = [];
    
    // Throughput analysis
    if (stats.throughputAchievement < 50) {
      recommendations.push("⚠️ Throughput is below 50% of target - consider increasing batch size or concurrency");
    } else if (stats.throughputAchievement > 120) {
      recommendations.push("🚀 Throughput exceeds target by 20% - excellent performance!");
    }
    
    // Efficiency analysis
    if (stats.cpuEfficiency < 5) {
      recommendations.push("💡 Very low efficiency - most tickers are irrelevant. Consider reducing Binance stream scope.");
    } else if (stats.cpuEfficiency > 20) {
      recommendations.push("✨ High efficiency - good symbol filtering performance!");
    }
    
    // Speed analysis
    if (stats.avgProcessingTime > 200) {
      recommendations.push("⏰ High processing time - consider optimizing alert condition logic");
    } else if (stats.avgProcessingTime < 50) {
      recommendations.push("⚡ Ultra-fast processing - optimal performance!");
    }
    
    // Batch analysis
    if (stats.avgBatchSize < 10) {
      recommendations.push("📦 Small batch sizes - consider increasing batch interval for better efficiency");
    } else if (stats.avgBatchSize > 200) {
      recommendations.push("📦 Large batch sizes - consider reducing batch size to improve responsiveness");
    }
    
    if (recommendations.length === 0) {
      console.log("   ✅ Performance is optimal - no recommendations needed!");
    } else {
      recommendations.forEach(rec => console.log(`   ${rec}`));
    }
  }

  async resetMetrics() {
    try {
      console.log("🔄 Resetting micro-batch metrics...");
      
      await this.redis.publish("system:control", JSON.stringify({
        command: "reset_microbatch_metrics",
        timestamp: Date.now()
      }));
      
      console.log("✅ Metrics reset command sent");
    } catch (error) {
      console.error("❌ Error resetting metrics:", error);
    }
  }

  async monitorContinuous(interval = 10000) {
    console.log(`🔄 Starting continuous monitoring (${interval/1000}s interval)...\n`);
    
    const monitor = async () => {
      console.clear();
      console.log(`🚀 MICRO-BATCH REAL-TIME MONITOR - ${new Date().toLocaleString()}\n`);
      
      await this.getStats();
      
      console.log(`\n⏰ Next update in ${interval/1000} seconds... (Press Ctrl+C to stop)`);
    };
    
    // Initial run
    await monitor();
    
    // Set interval
    const intervalId = setInterval(monitor, interval);
    
    // Handle cleanup
    process.on('SIGINT', () => {
      clearInterval(intervalId);
      console.log('\n👋 Monitoring stopped');
      process.exit(0);
    });
  }

  async close() {
    await this.redis.quit();
  }
}

// Command line interface
async function main() {
  const monitor = new MicroBatchMonitor();
  const command = process.argv[2];
  
  try {
    switch (command) {
      case 'stats':
        await monitor.getStats();
        break;
        
      case 'reset':
        await monitor.resetMetrics();
        break;
        
      case 'monitor':
        const interval = parseInt(process.argv[3]) || 10000;
        await monitor.monitorContinuous(interval);
        break;
        
      case 'health':
        const stats = await monitor.getStats();
        if (stats && stats.systemHealth) {
          process.exit(stats.systemHealth.overall >= 80 ? 0 : 1);
        } else {
          process.exit(1);
        }
        break;
        
      default:
        console.log("🚀 Micro-Batch Performance Monitor");
        console.log("\nUsage:");
        console.log("  node microbatch-monitor.js stats                    - Get current stats");
        console.log("  node microbatch-monitor.js reset                    - Reset metrics");
        console.log("  node microbatch-monitor.js monitor [interval_ms]    - Continuous monitoring");
        console.log("  node microbatch-monitor.js health                   - Health check (exit code)");
        console.log("\nExamples:");
        console.log("  node microbatch-monitor.js monitor 5000            - Monitor every 5 seconds");
        console.log("  node microbatch-monitor.js stats                    - One-time stats check");
        break;
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    await monitor.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default MicroBatchMonitor;
