#!/usr/bin/env node

// 🧹 Cleanup Worker
// Automatically cleans up old alert history entries (older than 24 hours)

import { connectToMongoDB } from "../utils/mongodb.js";
import AlertHistoryService from "../services/AlertHistoryService.js";

class CleanupWorker {
  constructor() {
    this.isRunning = false;
    this.cleanupInterval = null;
    this.cleanupIntervalMs = 60 * 60 * 1000; // Run every hour
  }

  async start() {
    if (this.isRunning) {
      console.log("⚠️ Cleanup worker is already running");
      return;
    }

    try {
      console.log("🧹 Starting Cleanup Worker...");

      // Connect to MongoDB
      console.log("🔌 Connecting to MongoDB...");
      await connectToMongoDB();
      console.log("✅ Connected to MongoDB successfully");

      this.isRunning = true;
      console.log("✅ Worker marked as running successfully");

      // Run cleanup immediately on start
      console.log("🧹 Running initial cleanup...");
      await this.runCleanup();

      // Schedule periodic cleanup
      console.log("⏰ Setting up periodic cleanup...");
      this.cleanupInterval = setInterval(async () => {
        console.log("⏰ Periodic cleanup triggered");
        await this.runCleanup();
      }, this.cleanupIntervalMs);

      console.log(
        `✅ Cleanup worker started - will run every ${
          this.cleanupIntervalMs / 1000 / 60
        } minutes`
      );

      // Handle graceful shutdown
      process.on("SIGINT", () => {
        console.log("🛑 Received SIGINT, stopping worker...");
        this.stop();
      });
      process.on("SIGTERM", () => {
        console.log("🛑 Received SIGTERM, stopping worker...");
        this.stop();
      });

      console.log("✅ Cleanup worker fully started and running");

      // Keep the process alive
      console.log("✅ Worker is running... Press Ctrl+C to stop");
    } catch (error) {
      console.error("❌ Error starting cleanup worker:", error);
      console.error("❌ Error details:", error.message);
      console.error("❌ Error stack:", error.stack);
      this.isRunning = false;
    }
  }

  async runCleanup() {
    try {
      console.log("🧹 Running alert history cleanup...");

      const deletedCount = await AlertHistoryService.cleanupOldAlerts();

      if (deletedCount > 0) {
        console.log(
          `✅ Cleanup completed - deleted ${deletedCount} old alert history entries`
        );
      } else {
        console.log("✅ Cleanup completed - no old entries to delete");
      }
    } catch (error) {
      console.error("❌ Error during cleanup:", error);
    }
  }

  async stop() {
    if (!this.isRunning) {
      console.log("⚠️ Cleanup worker is not running");
      return;
    }

    console.log("🛑 Stopping Cleanup Worker...");

    this.isRunning = false;

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    console.log("✅ Cleanup worker stopped");
  }
}

// Start the worker if this file is run directly
// Check if this is the main module by comparing the script name
const scriptName = process.argv[1];
const isMainModule = scriptName && scriptName.includes("cleanup-worker.js");

if (isMainModule) {
  console.log("🚀 Starting cleanup worker as main module...");
  const worker = new CleanupWorker();
  worker.start().catch((error) => {
    console.error("💥 Cleanup worker failed to start:", error);
    process.exit(1);
  });
} else {
  console.log("📦 Cleanup worker loaded as module");
}

export default CleanupWorker;
