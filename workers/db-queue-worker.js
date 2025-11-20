import Redis from "ioredis";
import { connectToMongoDB } from "../utils/mongodb.js";
import Alert from "../models/Alert.js";
import dotenv from "dotenv";
import pLimit from "p-limit";

dotenv.config();

// Connect to MongoDB
connectToMongoDB()
  .then(() => {
    console.log("✅ MongoDB connected for db-queue-worker");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  });

const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
});

const QUEUE_NAME = "db:operations:queue";
const BATCH_SIZE = 10; // Process 10 operations at once
const CONCURRENCY_LIMIT = 5; // Process 5 operations in parallel
const processLimit = pLimit(CONCURRENCY_LIMIT);

// Global flag to track if we're using Streams or Lists
let useStreams = false;

// Check Redis version and capabilities
async function checkRedisCapabilities() {
  try {
    // Try to check Redis version
    const info = await redis.info("server");
    const versionMatch = info.match(/redis_version:(\d+\.\d+)/);
    if (versionMatch) {
      const version = parseFloat(versionMatch[1]);
      if (version >= 5.0) {
        // Try to use Streams
        try {
          await redis.xgroup(
            "CREATE",
            QUEUE_NAME,
            "db-queue-processors",
            "0",
            "MKSTREAM"
          );
          useStreams = true;
          console.log("✅ Using Redis Streams (Redis 5.0+)");
          return;
        } catch (err) {
          if (err.message.includes("BUSYGROUP")) {
            useStreams = true;
            console.log("✅ Using Redis Streams (consumer group exists)");
            return;
          }
        }
      }
    }
  } catch (error) {
    // If we can't check or Streams don't work, fall back to Lists
  }

  // Fallback to Redis Lists (works on all Redis versions)
  useStreams = false;
  console.log("✅ Using Redis Lists (compatible with all Redis versions)");
}

// Process a single database operation
async function processDbOperation(operationData) {
  const { type, alertId, data, priority } = operationData;

  try {
    switch (type) {
      case "update_alert":
        await Alert.findByIdAndUpdate(alertId, data, { new: false });
        break;

      case "update_baseline":
        await Alert.findByIdAndUpdate(alertId, data, { new: false });
        break;

      default:
        console.warn(`⚠️ Unknown operation type: ${type}`);
    }

    return { success: true, operationId: alertId };
  } catch (error) {
    console.error(
      `❌ Error processing DB operation ${type} for alert ${alertId}:`,
      error.message
    );
    return { success: false, operationId: alertId, error: error.message };
  }
}

// Process batch of operations from Redis Queue
async function processBatch() {
  try {
    if (useStreams) {
      // Use Redis Streams (Redis 5.0+)
      const CONSUMER_GROUP = "db-queue-processors";
      const CONSUMER_NAME = `processor-${process.pid}`;

      const messages = await redis.xreadgroup(
        "GROUP",
        CONSUMER_GROUP,
        CONSUMER_NAME,
        "COUNT",
        BATCH_SIZE,
        "BLOCK",
        1000,
        "STREAMS",
        QUEUE_NAME,
        ">"
      );

      if (!messages || messages.length === 0) {
        return;
      }

      const streamMessages = messages[0][1];
      if (!streamMessages || streamMessages.length === 0) {
        return;
      }

      const operationPromises = streamMessages.map(([messageId, fields]) =>
        processLimit(async () => {
          try {
            const operationField = fields.find(
              ([field]) => field === "operation"
            );
            if (!operationField) {
              await redis.xack(QUEUE_NAME, CONSUMER_GROUP, messageId);
              return;
            }

            const operationData = JSON.parse(operationField[1]);
            const result = await processDbOperation(operationData);

            if (result.success) {
              await redis.xack(QUEUE_NAME, CONSUMER_GROUP, messageId);
            }
          } catch (error) {
            console.error(`❌ Error processing message:`, error.message);
          }
        })
      );

      await Promise.all(operationPromises);
    } else {
      // Use Redis Lists (compatible with all Redis versions)
      const operations = [];

      // Pop multiple operations from list (non-blocking)
      for (let i = 0; i < BATCH_SIZE; i++) {
        const operationJson = await redis.rpop(QUEUE_NAME);
        if (!operationJson) break;

        try {
          const operationData = JSON.parse(operationJson);
          operations.push(operationData);
        } catch (error) {
          console.error(`❌ Error parsing operation:`, error.message);
        }
      }

      if (operations.length === 0) {
        return; // No operations to process
      }

      // Process operations in parallel with concurrency limit
      const operationPromises = operations.map((operationData) =>
        processLimit(async () => {
          try {
            await processDbOperation(operationData);
          } catch (error) {
            console.error(
              `❌ Error processing operation ${operationData.type}:`,
              error.message
            );
            // Re-queue failed operations for retry
            await redis.lpush(QUEUE_NAME, JSON.stringify(operationData));
          }
        })
      );

      await Promise.all(operationPromises);
    }
  } catch (error) {
    console.error("❌ Error processing batch:", error.message);
  }
}

// Handle pending messages (only for Streams)
async function processPendingMessages() {
  if (!useStreams) {
    return; // Not needed for Lists
  }

  try {
    const CONSUMER_GROUP = "db-queue-processors";
    const CONSUMER_NAME = `processor-${process.pid}`;

    const pending = await redis.xpending(
      QUEUE_NAME,
      CONSUMER_GROUP,
      "-",
      "+",
      BATCH_SIZE,
      CONSUMER_NAME
    );

    if (!pending || pending.length === 0) {
      return;
    }

    for (const [messageId, consumer, idleTime, deliveryCount] of pending) {
      if (idleTime > 60000) {
        try {
          const claimed = await redis.xclaim(
            QUEUE_NAME,
            CONSUMER_GROUP,
            CONSUMER_NAME,
            60000,
            messageId
          );

          if (claimed && claimed.length > 0) {
            const [msgId, fields] = claimed[0];
            const operationField = fields.find(
              ([field]) => field === "operation"
            );
            if (operationField) {
              const operationData = JSON.parse(operationField[1]);
              const result = await processDbOperation(operationData);

              if (result.success) {
                await redis.xack(QUEUE_NAME, CONSUMER_GROUP, msgId);
              }
            }
          }
        } catch (error) {
          console.error(`❌ Error claiming pending message:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error("❌ Error processing pending messages:", error.message);
  }
}

// Start processing
async function start() {
  console.log("🚀 Starting DB Queue Worker...");
  console.log(`📊 Queue: ${QUEUE_NAME}`);

  // Check Redis capabilities and choose method
  await checkRedisCapabilities();

  // Process batches continuously
  setInterval(async () => {
    await processBatch();
  }, 100); // Check every 100ms

  // Process pending messages periodically (only for Streams, every 30 seconds)
  if (useStreams) {
    setInterval(async () => {
      await processPendingMessages();
    }, 30000);
  }

  console.log("✅ DB Queue Worker started");
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("🛑 Shutting down DB Queue Worker...");
  await redis.quit();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("🛑 Shutting down DB Queue Worker...");
  await redis.quit();
  process.exit(0);
});

// Start the worker
start().catch((error) => {
  console.error("❌ Failed to start DB Queue Worker:", error);
  process.exit(1);
});
