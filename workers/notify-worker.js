import {
  createRedisClient,
  setupGracefulShutdown,
} from "../utils/workerHelpers.js";
import { connectToMongoDB } from "../utils/mongodb.js";
import TelegramService from "../services/TelegramService.js";
import EmailService from "../services/EmailService.js";
import ChartScreenshotService from "../utils/chartScreenshot.js";
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

// Create Redis client using centralized utility
const redis = createRedisClient();

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
          "email telegramChatId telegramBotToken notificationPreferences preferredTimeframe"
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
            "email telegramChatId telegramBotToken notificationPreferences preferredTimeframe"
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
            actualValue: history.baselineData?.changeFromBaselinePercent ??
              history.triggerData?.priceChangePercent ?? 0, // 🔥 FIX: Use baseline change first
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

              // 🔥 FIX: Pass alertData to chart for trigger price marker
              const chartOptions = {
                alertData: {
                  triggerPrice: alertData.triggeredPrice,
                  baselinePrice: alertData.baselinePrice,  // 🔥 NEW: For baseline line
                  changePercent: alertData.changeFromBaselinePercent || alertData.actualValue || 0
                }
              };

              const screenshotPromise = ChartScreenshotService.captureChart(
                history.symbol,
                timeframe,
                chartOptions  // 🔥 Pass alert context for chart marker
              );
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Screenshot timeout")), 10000)
              );
              chartScreenshot = await Promise.race([
                screenshotPromise,
                timeoutPromise,
              ]);
            } catch (e) {
              console.warn(`⚠️ Screenshot failed for ${history.symbol}: ${e.message}`);
              // Screenshot failed, continue with text-only
            }

            try {
              if (chartScreenshot) {
                await TelegramService.sendPhotoAlert(
                  userByString.telegramChatId,
                  chartScreenshot,
                  alertData,
                  userByString.telegramBotToken || null
                );
                console.log(`✅ Telegram PHOTO alert sent for ${alertData.symbol}`);
              } else {
                await TelegramService.sendAlertMessage(
                  userByString.telegramChatId,
                  alertData,
                  userByString.telegramBotToken || null
                );
                console.log(`✅ Telegram TEXT alert sent for ${alertData.symbol}`);
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
      actualValue: history.baselineData?.changeFromBaselinePercent ??
        history.triggerData?.priceChangePercent ?? 0, // 🔥 FIX: Use baseline change for timeframe-based alerts
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

    // Telegram (queued inside service)
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

      // Capture chart screenshot using user's preferred timeframe (with timeout)
      let chartScreenshot = null;
      try {
        // 🔥 NEW: Check for pre-captured chart in Redis FIRST (instant, no delay!)
        const preCapturedKey = `chart:alert:${historyId}`;
        const preCapturedChart = await redis.get(preCapturedKey);

        if (preCapturedChart) {
          console.log(`✅ Using PRE-CAPTURED chart for ${alertData.symbol} (zero delay!)`);
          chartScreenshot = Buffer.from(preCapturedChart, 'base64');
          // Delete from Redis after use (cleanup)
          redis.del(preCapturedKey).catch(() => { });
        } else {
          // Fallback: Generate new chart (may have slight delay)
          console.log(`📸 No pre-captured chart found, generating new for ${alertData.symbol}...`);

          const userPreferredTimeframe = user.preferredTimeframe || "5m";
          const timeframe =
            userPreferredTimeframe || alertData.timeframe?.toLowerCase() || "5m";

          // 🔥 FIX: Pass alertData to chart for trigger price marker
          const chartOptions = {
            alertData: {
              triggerPrice: alertData.triggeredPrice,
              baselinePrice: alertData.baselinePrice,
              changePercent: alertData.changeFromBaselinePercent || alertData.actualValue || 0
            }
          };

          // Add timeout to prevent long delays (max 10 seconds for screenshot)
          const screenshotPromise = ChartScreenshotService.captureChart(
            alertData.symbol,
            timeframe,
            chartOptions
          );
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Screenshot timeout")), 10000)
          );

          chartScreenshot = await Promise.race([
            screenshotPromise,
            timeoutPromise,
          ]);
        }
        console.log(`✅ Chart ready for ${alertData.symbol}`);
      } catch (screenshotError) {
        console.error(
          `❌ Failed to capture chart screenshot:`,
          screenshotError.message
        );
        console.log(`📱 Will send text-only alert (no delay)`);
      }

      // Send Telegram message (queued - TelegramService handles rate limiting and retries)
      try {
        // Check if already sent BEFORE queuing (prevent duplicates)
        const alreadySent = await AlertHistory.findOne({
          _id: historyId,
          "notificationSent.telegram": true,
        }).lean();

        if (alreadySent) {
          console.log(
            `⚠️ Telegram notification already sent for history ${historyId}, skipping`
          );
          return;
        }

        let telegramQueued = false;
        if (chartScreenshot) {
          telegramQueued = await TelegramService.sendPhotoAlert(
            user.telegramChatId,
            chartScreenshot,
            alertData,
            user.telegramBotToken || null
          );
          if (telegramQueued) {
            console.log(
              `✅ Telegram PHOTO alert ${alertData.symbol} queued successfully`
            );
          } else {
            console.error(
              `❌ Failed to queue Telegram photo alert for ${alertData.symbol}`
            );
          }
        } else {
          telegramQueued = await TelegramService.sendAlertMessage(
            user.telegramChatId,
            alertData,
            user.telegramBotToken || null
          );
          if (telegramQueued) {
            console.log(
              `✅ Telegram TEXT alert ${alertData.symbol} queued successfully`
            );
          } else {
            console.error(
              `❌ Failed to queue Telegram text alert for ${alertData.symbol}`
            );
          }
        }

        // Only mark as sent if successfully queued
        if (telegramQueued) {
          AlertHistory.findOneAndUpdate(
            {
              _id: historyId,
              "notificationSent.telegram": { $ne: true },
            },
            {
              $set: { "notificationSent.telegram": true },
            }
          )
            .then(() => {
              console.log(
                `✅ Alert history ${historyId} marked as Telegram queued`
              );
            })
            .catch((err) => {
              console.error(
                `❌ Error marking alert history as queued:`,
                err.message
              );
            });
        } else {
          console.error(
            `❌ Telegram message not queued for history ${historyId}, will not mark as sent`
          );
        }
      } catch (error) {
        console.error(`❌ Error queuing Telegram message:`, error.message);
        console.error(`❌ Error stack:`, error.stack);
        // Don't mark as sent if queueing failed
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

// Setup graceful shutdown using centralized utility
class NotifyWorker {
  stop() {
    redis.disconnect();
  }
}
const notifyWorker = new NotifyWorker();
setupGracefulShutdown(notifyWorker, "Notify Worker");

console.log("🚀 Notify worker started (on-demand chart screenshots)");
