import dotenv from "dotenv";
import FormData from "form-data";
import axios from "axios";

dotenv.config();

class TelegramService {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
    this.initialized = false;

    // 🔁 Queue + Rate-limit state
    this.queue = [];
    this.isProcessing = false;
    this.minDelayMs = 1200; // ≈1.2s per message (safe for Telegram)
    this.lastSentAt = 0;
  }

  initialize() {
    try {
      if (this.initialized) return;

      if (!this.botToken) {
        console.warn("⚠️ Telegram bot token not configured");
        return;
      }

      this.initialized = true;
      console.log("✅ Telegram service initialized");
    } catch (error) {
      console.error("❌ Error initializing Telegram service:", error);
    }
  }

  // Small helper
  async sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  // =============== QUEUE CORE ===============

  enqueueJob(job) {
    this.queue.push(job);
    this.processQueue().catch((e) =>
      console.error("❌ Error in Telegram queue:", e.message)
    );
  }

  async processQueue() {
    if (this.isProcessing) return;
    if (!this.botToken) return;
    if (this.queue.length === 0) return;

    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const now = Date.now();
        const sinceLast = now - this.lastSentAt;

        if (sinceLast < this.minDelayMs) {
          const waitMs = this.minDelayMs - sinceLast;
          await this.sleep(waitMs);
        }

        const job = this.queue.shift();
        if (!job) continue;

        const { type, chatId, alertData, photo } = job;

        let ok = false;

        if (type === "text") {
          ok = await this._sendTextNow(chatId, alertData);
        } else if (type === "photo") {
          ok = await this._sendPhotoNow(chatId, photo, alertData);
        }

        this.lastSentAt = Date.now();

        if (!ok) {
          console.warn("⚠️ Telegram send failed for one job");
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  // =============== MESSAGE FORMAT ===============

  formatAlertMessage(alertData) {
    const {
      symbol,
      actualValue,
      triggeredPrice,
      baselinePrice,
      changeFromBaselinePercent,
      volume,
      triggeredAt,
    } = alertData;

    const changeEmoji =
      changeFromBaselinePercent === undefined ||
      changeFromBaselinePercent === null
        ? "📊"
        : changeFromBaselinePercent >= 0
        ? "📈"
        : "📉";

    const safeNumber = (val, digits = 3) =>
      typeof val === "number" && !isNaN(val) ? val.toFixed(digits) : "N/A";

    const safePrice = (val) =>
      typeof val === "number" && !isNaN(val) ? val.toFixed(6) : "N/A";

    const safeVolume =
      typeof volume === "number" && !isNaN(volume)
        ? new Intl.NumberFormat("en-US").format(volume)
        : "N/A";

    const dateObj = triggeredAt ? new Date(triggeredAt) : new Date();

    const timeStr = dateObj.toLocaleTimeString("en-PK", {
      timeZone: "Asia/Karachi",
      hour12: true,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const dateStr = dateObj.toLocaleDateString("en-PK", {
      timeZone: "Asia/Karachi",
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    return `
🚨 *ALERT TRIGGERED!* 🚨

💠 *${symbol || "Unknown"}*
━━━━━━━━━━━━━━━━━━━

📄 Actual 24h change: \`${safeNumber(actualValue)}%\`
💵 Current Price: \`$${safePrice(triggeredPrice)}\`
📍 Last Price: \`$${safePrice(baselinePrice)}\`
${changeEmoji} Change from Baseline: \`${safeNumber(
      changeFromBaselinePercent
    )}%\`
📊 24h Volume: \`${safeVolume}\`
⏰ Time: \`${timeStr}\`
📅 Date: \`${dateStr}\`
━━━━━━━━━━━━━━━━━━━

_Automated alert from Crypto Alerts Dashboard_
    `.trim();
  }

  // =============== LOW-LEVEL SENDS (rate-limited) ===============

  async _sendTextNow(chatId, alertData) {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      if (!this.botToken) {
        console.error("❌ Telegram bot token not configured");
        return false;
      }

      const message = this.formatAlertMessage(alertData);

      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown",
        }),
      });

      const data = await response.json();

      if (data.ok) {
        console.log(`✅ Telegram message sent to chat ${chatId}`);
        return true;
      } else {
        console.error("❌ Telegram API error:", data.description);

        // Basic handling for rate limit
        if (data.error_code === 429 && data.parameters?.retry_after) {
          const wait = (data.parameters.retry_after + 1) * 1000;
          console.warn(`⏳ Rate limited, waiting ${wait}ms...`);
          await this.sleep(wait);
        }

        return false;
      }
    } catch (error) {
      console.error("❌ Error sending Telegram message:", error.message);
      return false;
    }
  }

  async _sendPhotoNow(chatId, photo, alertData) {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      if (!this.botToken) {
        console.error("❌ Telegram bot token not configured");
        return false;
      }

      const caption = this.formatAlertMessage(alertData);

      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("photo", photo, {
        filename: `${alertData.symbol || "chart"}_chart.jpg`,
        contentType: "image/jpeg",
      });
      formData.append("caption", caption);
      formData.append("parse_mode", "Markdown");

      const response = await axios.post(`${this.apiUrl}/sendPhoto`, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        timeout: 30000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      if (response.data.ok) {
        console.log(`✅ Telegram photo alert sent to chat ${chatId}`);
        return true;
      } else {
        console.error(
          "❌ Telegram API error (photo):",
          response.data.description
        );

        if (
          response.data.error_code === 429 &&
          response.data.parameters?.retry_after
        ) {
          const wait = (response.data.parameters.retry_after + 1) * 1000;
          console.warn(`⏳ Rate limited (photo), waiting ${wait}ms...`);
          await this.sleep(wait);
        }

        // fallback text-only
        console.log("⚠️ Falling back to text-only message...");
        return await this._sendTextNow(chatId, alertData);
      }
    } catch (error) {
      console.error("❌ Error sending Telegram photo:", error.message);
      console.log("⚠️ Falling back to text-only message...");
      try {
        return await this._sendTextNow(chatId, alertData);
      } catch (fallbackError) {
        console.error(
          "❌ Fallback text message also failed:",
          fallbackError.message
        );
        return false;
      }
    }
  }

  // =============== PUBLIC API (your existing calls) ===============

  /**
   * Queue alert message to Telegram (non-blocking)
   */
  async sendAlertMessage(chatId, alertData) {
    if (!chatId) {
      console.error("❌ sendAlertMessage: chatId missing");
      return false;
    }

    // Queue job instead of sending immediately
    this.enqueueJob({ type: "text", chatId, alertData });

    // We return true = "successfully queued"
    return true;
  }

  /**
   * Queue photo alert to Telegram (non-blocking)
   */
  async sendPhotoAlert(chatId, photo, alertData) {
    if (!chatId) {
      console.error("❌ sendPhotoAlert: chatId missing");
      return false;
    }

    if (!photo) {
      console.warn("⚠️ sendPhotoAlert: photo missing, sending text-only");
      this.enqueueJob({ type: "text", chatId, alertData });
      return true;
    }

    this.enqueueJob({ type: "photo", chatId, photo, alertData });
    return true;
  }

  // Test message (still works, now uses queue)
  async testTelegram(chatId) {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      const testData = {
        symbol: "BTCUSDT",
        targetValue: 1,
        actualValue: 2.5,
        direction: "Increase",
        timeframe: "5MIN",
        triggeredPrice: 45000,
        baselinePrice: 44000,
        changeFromBaselinePercent: 2.27,
        volume: 1234567890,
        triggeredAt: new Date(),
      };

      return await this.sendAlertMessage(chatId, testData);
    } catch (error) {
      console.error("❌ Error testing Telegram:", error);
      return false;
    }
  }

  async getBotInfo() {
    try {
      if (!this.botToken) {
        return null;
      }

      const response = await fetch(`${this.apiUrl}/getMe`);
      const data = await response.json();

      if (data.ok) {
        return data.result;
      }
      return null;
    } catch (error) {
      console.error("❌ Error getting bot info:", error);
      return null;
    }
  }
}

export default new TelegramService();
