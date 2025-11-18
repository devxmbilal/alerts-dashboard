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

const STREAM_NAME = "db:operations:queue";
const CONSUMER_GROUP = "db-queue-processors";
const CONSUMER_NAME = `processor-${process.pid}`;
const BATCH_SIZE = 10; // Process 10 operations at once
const CONCURRENCY_LIMIT = 5; // Process 5 operations in parallel
const processLimit = pLimit(CONCURRENCY_LIMIT);

// Initialize consumer group
async function initConsumerGroup() {
  try {
    // Try to create consumer group (will fail if it already exists, which is OK)
    await redis.xgroup("CREATE", STREAM_NAME, CONSUMER_GROUP, "0", "MKSTREAM");
    console.log(`✅ Created consumer group: ${CONSUMER_GROUP}`);
  } catch (error) {
    if (error.message.includes("BUSYGROUP")) {
      console.log(`✅ Consumer group ${CONSUMER_GROUP} already exists`);
    } else {
      console.error("❌ Error creating consumer group:", error.message);
      throw error;
    }
  }
}

// Process a single database operation
async function processDbOperation(operationData) {
  const { type, alertId, data, priority } = operationData;

  try {
    switch (type) {
      case "update_alert":
        await Alert.findByIdAndUpdate(alertId, data, { new: false });
        console.log(`✅ Updated alert ${alertId} (priority: ${priority})`);
        break;

      case "update_baseline":
        await Alert.findByIdAndUpdate(alertId, data, { new: false });
        console.log(
          `✅ Updated baseline for alert ${alertId} (priority: ${priority})`
        );
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

// Process batch of operations from Redis Stream
async function processBatch() {
  try {
    // Read from stream with consumer group
    const messages = await redis.xreadgroup(
      "GROUP",
      CONSUMER_GROUP,
      CONSUMER_NAME,
      "COUNT",
      BATCH_SIZE,
      "BLOCK",
      1000, // Block for 1 second if no messages
      "STREAMS",
      STREAM_NAME,
      ">" // Read new messages
    );

    if (!messages || messages.length === 0) {
      return; // No messages
    }

    const streamMessages = messages[0][1]; // [streamName, [messages]]
    if (!streamMessages || streamMessages.length === 0) {
      return; // No messages in stream
    }

    console.log(
      `📦 Processing batch of ${streamMessages.length} DB operations`
    );

    // Process operations in parallel with concurrency limit
    const operationPromises = streamMessages.map(([messageId, fields]) =>
      processLimit(async () => {
        try {
          // Parse operation data
          const operationField = fields.find(
            ([field]) => field === "operation"
          );
          if (!operationField) {
            console.warn(`⚠️ No operation field in message ${messageId}`);
            // Acknowledge message even if invalid
            await redis.xack(STREAM_NAME, CONSUMER_GROUP, messageId);
            return;
          }

          const operationData = JSON.parse(operationField[1]);
          const result = await processDbOperation(operationData);

          // Acknowledge message after successful processing
          if (result.success) {
            await redis.xack(STREAM_NAME, CONSUMER_GROUP, messageId);
            console.log(
              `✅ Acknowledged message ${messageId} for operation ${operationData.type}`
            );
          } else {
            // Don't acknowledge on failure - will be retried
            console.warn(
              `⚠️ Failed to process message ${messageId}, will retry`
            );
          }
        } catch (error) {
          console.error(
            `❌ Error processing message ${messageId}:`,
            error.message
          );
          // Don't acknowledge on error - will be retried
        }
      })
    );

    // Wait for all operations to complete
    await Promise.all(operationPromises);

    console.log(`✅ Batch processing complete`);
  } catch (error) {
    if (error.message.includes("NOGROUP")) {
      // Consumer group doesn't exist, initialize it
      console.log("⚠️ Consumer group not found, initializing...");
      await initConsumerGroup();
    } else {
      console.error("❌ Error processing batch:", error.message);
    }
  }
}

// Handle pending messages (messages that were read but not acknowledged)
async function processPendingMessages() {
  try {
    // Get pending messages for this consumer
    const pending = await redis.xpending(
      STREAM_NAME,
      CONSUMER_GROUP,
      "-",
      "+",
      BATCH_SIZE,
      CONSUMER_NAME
    );

    if (!pending || pending.length === 0) {
      return; // No pending messages
    }

    console.log(`🔄 Processing ${pending.length} pending messages`);

    // Process each pending message
    for (const [messageId, consumer, idleTime, deliveryCount] of pending) {
      // If message has been idle for more than 60 seconds, claim and process it
      if (idleTime > 60000) {
        try {
          // Claim the message
          const claimed = await redis.xclaim(
            STREAM_NAME,
            CONSUMER_GROUP,
            CONSUMER_NAME,
            60000, // Min idle time: 60 seconds
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
                await redis.xack(STREAM_NAME, CONSUMER_GROUP, msgId);
                console.log(
                  `✅ Processed and acknowledged pending message ${msgId}`
                );
              }
            }
          }
        } catch (error) {
          console.error(
            `❌ Error claiming pending message ${messageId}:`,
            error.message
          );
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
  console.log(`📊 Consumer: ${CONSUMER_NAME}`);
  console.log(`📊 Stream: ${STREAM_NAME}`);
  console.log(`📊 Group: ${CONSUMER_GROUP}`);

  // Initialize consumer group
  await initConsumerGroup();

  // Process batches continuously
  setInterval(async () => {
    await processBatch();
  }, 100); // Check every 100ms

  // Process pending messages periodically (every 30 seconds)
  setInterval(async () => {
    await processPendingMessages();
  }, 30000);

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
