import Redis from "ioredis";
import { connectToMongoDB } from "../utils/mongodb.js";
import TelegramService from "../services/TelegramService.js";
import EmailService from "../services/EmailService.js";
import ChartScreenshotService from "../utils/chartScreenshot.js";
import ScreenshotCacheService from "../services/ScreenshotCacheService.js";
import User from "../models/User.js";
import AlertHistory from "../models/AlertHistory.js";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// Connect to MongoDB
connectToMongoDB()
  .then(() => {
    console.log("✅ MongoDB connected for notify-worker");
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

redis.subscribe("notifications:queue", (err) => {
  if (err) {
    console.error("❌ Redis subscribe error:", err);
    process.exit(1);
  } else {
    console.log("✅ Subscribed to notifications:queue");
  }
});

redis.on("message", async (channel, message) => {
  if (channel !== "notifications:queue") return;

  try {
    const data = JSON.parse(message);
    const { userId, historyId } = data;

    console.log(
      `📨 Processing notification for user ${userId}, history ${historyId}`
    );

    // Convert userId string to ObjectId if it's a valid ObjectId string
    let userQueryId = userId;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      userQueryId = new mongoose.Types.ObjectId(userId);
    }

    const [user, history] = await Promise.all([
      User.findById(userQueryId)
        .select(
          "email telegramChatId notificationPreferences preferredTimeframe"
        )
        .lean(),
      AlertHistory.findById(historyId).lean(),
    ]);

    if (!user) {
      console.error(
        `❌ User not found: ${userId} (queried as ObjectId: ${userQueryId})`
      );
      // Try alternative query methods
      if (mongoose.Types.ObjectId.isValid(userId)) {
        // Already tried ObjectId, try as string directly
        const userByString = await User.findOne({ _id: userId.toString() })
          .select(
            "email telegramChatId notificationPreferences preferredTimeframe"
          )
          .lean();
        if (userByString) {
          console.log(`✅ User found with string ID query`);
          // Re-run the main logic with found user
          const history = await AlertHistory.findById(historyId).lean();
          if (!history) {
            console.error(`❌ Alert history not found: ${historyId}`);
            return;
          }
          // Continue with userByString and history (code below will handle it)
          const alertData = {
            symbol: history.symbol,
            targetValue:
              history.alertConditions?.changePercent?.percentage || "N/A",
            actualValue: history.triggerData?.priceChangePercent || 0,
            direction:
              history.alertConditions?.changePercent?.direction === "increase"
                ? "Increase"
                : history.alertConditions?.changePercent?.direction ===
                  "decrease"
                  ? "Decrease"
                  : "Increase",
            timeframe:
              history.alertConditions?.changePercent?.timeframe || "5MIN",
            triggeredPrice: history.triggerData?.price,
            baselinePrice: history.baselineData?.baselinePrice,
            changeFromBaselinePercent:
              history.baselineData?.changeFromBaselinePercent,
            volume: history.triggerData?.volume24h,
            triggeredAt: history.triggeredAt,
          };

          // Send notifications (reuse existing logic)
          if (
            userByString.notificationPreferences?.email !== false &&
            userByString.email
          ) {
            EmailService.sendAlertEmail(userByString.email, alertData).catch(
              (err) => console.error(`❌ Error sending email:`, err.message)
            );
          }

          if (
            userByString.notificationPreferences?.telegram &&
            userByString.telegramChatId
          ) {
            // Screenshot and Telegram logic (same as below)
            let chartScreenshot = null;
            try {
              const timeframe =
                userByString.preferredTimeframe ||
                alertData.timeframe?.toLowerCase() ||
                "5m";
              const screenshotPromise = ChartScreenshotService.captureChart(
                history.symbol,
                timeframe
              );
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Screenshot timeout")), 3000)
              );
              chartScreenshot = await Promise.race([
                screenshotPromise,
                timeoutPromise,
              ]);
            } catch (e) {
              // Screenshot failed, continue with text-only
            }

            try {
              if (chartScreenshot) {
                await TelegramService.sendPhotoAlert(
                  userByString.telegramChatId,
                  chartScreenshot,
                  alertData
                );
              } else {
                await TelegramService.sendAlertMessage(
                  userByString.telegramChatId,
                  alertData
                );
              }
              await AlertHistory.findOneAndUpdate(
                { _id: historyId, "notificationSent.telegram": { $ne: true } },
                { $set: { "notificationSent.telegram": true } }
              );
            } catch (error) {
              console.error(
                `❌ Error queuing Telegram message:`,
                error.message
              );
            }
          }
          return;
        }
      }
      console.error(
        `❌ User ${userId} not found in database. Skipping notification.`
      );
      return;
    }

    if (!history) {
      console.error(`❌ Alert history not found: ${historyId}`);
      return;
    }

    const alertData = {
      symbol: history.symbol,
      targetValue: history.alertConditions?.changePercent?.percentage || "N/A",
      actualValue: history.triggerData?.priceChangePercent || 0,
      direction:
        history.alertConditions?.changePercent?.direction === "increase"
          ? "Increase"
          : history.alertConditions?.changePercent?.direction === "decrease"
            ? "Decrease"
            : "Increase",
      timeframe: history.alertConditions?.changePercent?.timeframe || "5MIN",
      triggeredPrice: history.triggerData?.price,
      baselinePrice: history.baselineData?.baselinePrice,
      changeFromBaselinePercent:
        history.baselineData?.changeFromBaselinePercent,
      volume: history.triggerData?.volume24h,
      triggeredAt: history.triggeredAt,
    };

    // Email
    if (user.notificationPreferences?.email !== false && user.email) {
      console.log(`📧 Sending email to ${user.email}...`);
      EmailService.sendAlertEmail(user.email, alertData)
        .then((sent) => {
          if (sent) {
            console.log(`✅ Email sent successfully to ${user.email}`);
          } else {
            console.error(`❌ Failed to send email to ${user.email}`);
          }
        })
        .catch((err) => {
          console.error(
            `❌ Error sending email to ${user.email}:`,
            err.message
          );
        });
    }

    // Telegram (OPTIMIZED: Parallel screenshot + send)
    if (user.notificationPreferences?.telegram && user.telegramChatId) {
      console.log(`📱 Sending Telegram message to ${user.telegramChatId}...`);

      // Check if already sent (atomic check)
      const checkResult = await AlertHistory.findOne({
        _id: historyId,
        "notificationSent.telegram": { $ne: true },
      }).lean();

      if (!checkResult) {
        console.log(
          `⚠️ Telegram notification already sent for history ${historyId}, skipping`
        );
        return;
      }

      // ⚡ OPTIMIZED: Start screenshot capture immediately (parallel)
      const userPreferredTimeframe = user.preferredTimeframe || "5m";
      const timeframe = userPreferredTimeframe || alertData.timeframe?.toLowerCase() || "5m";

      console.log(`📸 Getting screenshot for ${alertData.symbol} (timeframe: ${timeframe})...`);
      const screenshotStartTime = Date.now();

      // Use cache service for faster delivery (cache hit = instant)
      const screenshotPromise = ScreenshotCacheService.getScreenshot(
        alertData.symbol,
        timeframe
      ).then(result => {
        console.log(`✅ Screenshot received for ${alertData.symbol} in ${Date.now() - screenshotStartTime}ms`);
        return result;
      }).catch(err => {
        console.error(`❌ Screenshot failed for ${alertData.symbol} after ${Date.now() - screenshotStartTime}ms:`, err.message);
        return null;
      });

      // Wait max 15 seconds for screenshot (increased for slow coins/QuickChart)
      const timeoutPromise = new Promise(resolve => {
        setTimeout(() => {
          console.log(`⏰ Screenshot timeout (15s) for ${alertData.symbol}`);
          resolve(null);
        }, 15000);
      });

      // Race: screenshot vs 15s timeout
      const chartScreenshot = await Promise.race([screenshotPromise, timeoutPromise]);

      const screenshotDuration = Date.now() - screenshotStartTime;
      console.log(`📊 Screenshot result for ${alertData.symbol}: ${chartScreenshot ? `✅ Got ${(chartScreenshot.length / 1024).toFixed(1)}KB in ${screenshotDuration}ms` : `❌ NULL after ${screenshotDuration}ms`}`);

      // Send alert (with or without screenshot)
      try {
        if (chartScreenshot && Buffer.isBuffer(chartScreenshot) && chartScreenshot.length > 0) {
          console.log(`✅ Screenshot ready for ${alertData.symbol} (${(chartScreenshot.length / 1024).toFixed(1)}KB), sending photo alert`);
          await TelegramService.sendPhotoAlert(
            user.telegramChatId,
            chartScreenshot,
            alertData
          );
          console.log(`✅ Telegram PHOTO alert sent for ${alertData.symbol}`);
        } else {
          console.log(`⚠️ Screenshot not ready for ${alertData.symbol}, sending text-only`);
          await TelegramService.sendAlertMessage(
            user.telegramChatId,
            alertData
          );
          console.log(`✅ Telegram TEXT alert sent for ${alertData.symbol}`);
        }

        // Mark as sent in database (atomic update)
        await AlertHistory.findOneAndUpdate(
          {
            _id: historyId,
            "notificationSent.telegram": { $ne: true },
          },
          {
            $set: { "notificationSent.telegram": true },
          }
        );
        console.log(`✅ Alert history ${historyId} marked as Telegram sent`);
      } catch (error) {
        console.error(`❌ Error sending Telegram alert:`, error.message);
      }
    }
  } catch (err) {
    console.error("❌ Notify worker error:", err.message);
    console.error("❌ Error stack:", err.stack);
  }
});

// Handle Redis connection errors
redis.on("error", (err) => {
  console.error("❌ Redis connection error:", err);
});

redis.on("connect", () => {
  console.log("✅ Redis connected for notify-worker");
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("🛑 Shutting down notify-worker...");
  redis.disconnect();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("🛑 Shutting down notify-worker...");
  redis.disconnect();
  process.exit(0);
});

// Start screenshot cache auto-refresh
ScreenshotCacheService.startAutoRefresh(4000); // Refresh every 4 seconds
console.log("✅ Screenshot cache auto-refresh started (4s interval)");

// Initial cache warm-up
ScreenshotCacheService.prewarmCache()
  .then(() => console.log("✅ Initial cache warm-up completed"))
  .catch(err => console.error("❌ Initial cache warm-up failed:", err.message));

// Cleanup old cache entries every 30 seconds
setInterval(() => {
  ScreenshotCacheService.cleanup();
}, 30000);

console.log("🚀 Notify worker started with ultra-fast screenshot cache");
