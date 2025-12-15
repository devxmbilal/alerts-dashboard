import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

/**
 * Create a Redis client with standard configuration
 * @returns {Redis} Configured Redis client
 */
export function createRedisClient() {
    const redis = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT || 6379,
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
        lazyConnect: true,
    });

    redis.on("error", (err) => {
        console.error("❌ Redis connection error:", err.message);
    });

    redis.on("connect", () => {
        console.log("✅ Redis connected");
    });

    redis.on("close", () => {
        console.log("🔌 Redis disconnected");
    });

    return redis;
}

/**
 * Setup graceful shutdown handlers for a worker
 * @param {object} worker - Worker instance with stop() method
 * @param {string} workerName - Name of the worker for logging
 */
export function setupGracefulShutdown(worker, workerName = "Worker") {
    process.on("SIGINT", async () => {
        console.log(`🛑 Received SIGINT, shutting down ${workerName} gracefully...`);
        if (worker && typeof worker.stop === "function") {
            await worker.stop();
        }
        process.exit(0);
    });

    process.on("SIGTERM", async () => {
        console.log(`🛑 Received SIGTERM, shutting down ${workerName} gracefully...`);
        if (worker && typeof worker.stop === "function") {
            await worker.stop();
        }
        process.exit(0);
    });

    process.on("uncaughtException", (err) => {
        console.error(`❌ ${workerName} uncaught exception:`, err);
    });

    process.on("unhandledRejection", (reason, promise) => {
        console.error(`❌ ${workerName} unhandled rejection at:`, promise, "reason:", reason);
    });
}

/**
 * Sleep utility function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default {
    createRedisClient,
    setupGracefulShutdown,
    sleep,
};
