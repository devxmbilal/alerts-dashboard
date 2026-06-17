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
    this.processingStartedAt = null; // watchdog: detect stuck queue
    this.minDelayMs = 800; // ≈0.8s per message (safe for Telegram, faster than 1.2s)
    this.lastSentAt = 0;
    this.MAX_FETCH_TIMEOUT_MS = 15000;  // 15s per Telegram API call
    this.MAX_PROCESSING_STUCK_MS = 5 * 60 * 1000; // 5 minutes — force reset if stuck
    this.MAX_RETRY_AFTER_MS = 30000;    // cap 429 wait to 30s max
  }

  // Get API URL for a specific token (user token or fallback to global)
  getApiUrlForToken(customToken) {
    const token = customToken || this.botToken;
    return `https://api.telegram.org/bot${token}`;
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
    // Watchdog: if queue has been stuck for > 5 minutes, force reset
    if (this.isProcessing && this.processingStartedAt) {
      const stuckMs = Date.now() - this.processingStartedAt;
      if (stuckMs > this.MAX_PROCESSING_STUCK_MS) {
        console.warn(`⚠️ Telegram queue stuck for ${Math.round(stuckMs / 1000)}s — force resetting isProcessing`);
        this.isProcessing = false;
        this.processingStartedAt = null;
      }
    }

    this.queue.push(job);
    this.processQueue().catch((e) =>
      console.error("❌ Error in Telegram queue:", e.message)
    );
  }

  async processQueue() {
    if (this.isProcessing) return;
    // Check if we have any valid token (global or per-job)
    if (!this.botToken && this.queue.every(job => !job.customBotToken)) return;
    if (this.queue.length === 0) return;

    this.isProcessing = true;
    this.processingStartedAt = Date.now();

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

        const { type, chatId, alertData, photo, customBotToken } = job;

        let ok = false;

        if (type === "text") {
          ok = await this._sendTextNow(chatId, alertData, customBotToken);
        } else if (type === "photo") {
          ok = await this._sendPhotoNow(chatId, photo, alertData, customBotToken);
        }

        this.lastSentAt = Date.now();

        if (!ok) {
          console.warn("⚠️ Telegram send failed for one job");
        }
      }
    } finally {
      this.isProcessing = false;
      this.processingStartedAt = null;
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
      priceChangePercent,
      volume,
      triggeredAt,
      isUpdate,
    } = alertData;

    const changeEmoji =
      priceChangePercent === undefined ||
        priceChangePercent === null
        ? "📊"
        : priceChangePercent >= 0
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

*${symbol || "Unknown"}*
━━━━━━━━━━━━━━━

📊 Actual Change (${alertData.timeframe || "5MIN"}): \`${safeNumber(actualValue)}%\`
💵 Current Price: \`$${safePrice(triggeredPrice)}\`
📍 Last Price: \`$${safePrice(baselinePrice)}\`
${changeEmoji} 24h Change: \`${safeNumber(priceChangePercent)}%\`
📊 24h Volume: \`${safeVolume}\`
⏰ Time: \`${timeStr}\`
📅 Date: \`${dateStr}\`

━━━━━━━━━━━━━━━
    `.trim();
  }

  // =============== LOW-LEVEL SENDS (rate-limited) ===============

  async _sendTextNow(chatId, alertData, customBotToken = null) {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      const effectiveToken = customBotToken || this.botToken;
      if (!effectiveToken) {
        console.error("❌ Telegram bot token not configured");
        return false;
      }

      const apiUrl = this.getApiUrlForToken(customBotToken);
      const message = this.formatAlertMessage(alertData);

      // Timeout prevents hung fetch from locking the queue forever
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.MAX_FETCH_TIMEOUT_MS);

      let response;
      try {
        response = await fetch(`${apiUrl}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: "Markdown",
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const data = await response.json();

      if (data.ok) {
        console.log(`✅ Telegram message sent to chat ${chatId}`);
        return true;
      } else {
        console.error("❌ Telegram API error:", data.description);

        // Cap retry_after to avoid blocking queue for too long
        if (data.error_code === 429 && data.parameters?.retry_after) {
          const requested = (data.parameters.retry_after + 1) * 1000;
          const wait = Math.min(requested, this.MAX_RETRY_AFTER_MS);
          console.warn(`⏳ Rate limited, waiting ${wait}ms (capped from ${requested}ms)...`);
          await this.sleep(wait);
        }

        return false;
      }
    } catch (error) {
      if (error.name === "AbortError") {
        console.error(`❌ Telegram sendMessage timed out after ${this.MAX_FETCH_TIMEOUT_MS / 1000}s — skipping job`);
      } else {
        console.error("❌ Error sending Telegram message:", error.message);
      }
      return false;
    }
  }

  async _sendPhotoNow(chatId, photo, alertData, customBotToken = null) {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      const effectiveToken = customBotToken || this.botToken;
      if (!effectiveToken) {
        console.error("❌ Telegram bot token not configured");
        return false;
      }

      const apiUrl = this.getApiUrlForToken(customBotToken);

      // Validate photo buffer
      if (!photo || !Buffer.isBuffer(photo)) {
        console.error("❌ Invalid photo buffer provided");
        throw new Error("Invalid photo buffer");
      }

      if (photo.length === 0) {
        console.error("❌ Empty photo buffer");
        throw new Error("Empty photo buffer");
      }

      // Detect image format from buffer signature
      let contentType = "image/jpeg";
      let fileExtension = "jpg";
      let filename = `${alertData.symbol || "chart"}_chart.jpg`;

      // Check PNG signature (89 50 4E 47)
      if (
        photo[0] === 0x89 &&
        photo[1] === 0x50 &&
        photo[2] === 0x4e &&
        photo[3] === 0x47
      ) {
        contentType = "image/png";
        fileExtension = "png";
        filename = `${alertData.symbol || "chart"}_chart.png`;
      }
      // Check JPEG signature (FF D8)
      else if (photo[0] === 0xff && photo[1] === 0xd8) {
        contentType = "image/jpeg";
        fileExtension = "jpg";
        filename = `${alertData.symbol || "chart"}_chart.jpg`;
      }
      // Check file size (Telegram max 10MB for photos)
      if (photo.length > 10 * 1024 * 1024) {
        console.error(
          `❌ Photo too large: ${(photo.length / 1024 / 1024).toFixed(
            2
          )}MB (max 10MB)`
        );
        throw new Error("Photo too large");
      }

      // Check minimum file size (prevent corrupt/placeholder images)
      // Telegram requires minimum 100x100 pixels, which is typically >10KB for PNG/JPEG
      if (photo.length < 10 * 1024) {
        console.error(
          `❌ Photo too small: ${(photo.length / 1024).toFixed(2)}KB (min ~10KB for valid chart)`
        );
        console.error("⚠️ Image likely corrupted or placeholder, sending text-only");
        throw new Error("Photo too small - likely corrupted");
      }

      console.log(
        `📤 Sending ${contentType} photo (${(photo.length / 1024).toFixed(
          2
        )}KB) to Telegram...`
      );

      const caption = this.formatAlertMessage(alertData);

      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("photo", photo, {
        filename: filename,
        contentType: contentType,
      });
      formData.append("caption", caption);
      formData.append("parse_mode", "Markdown");

      const response = await axios.post(`${apiUrl}/sendPhoto`, formData, {
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
          response.data.description || response.data
        );
        console.error("❌ Error code:", response.data.error_code);
        console.error(
          "❌ Full response:",
          JSON.stringify(response.data, null, 2)
        );

        if (
          response.data.error_code === 429 &&
          response.data.parameters?.retry_after
        ) {
          const requested = (response.data.parameters.retry_after + 1) * 1000;
          const wait = Math.min(requested, this.MAX_RETRY_AFTER_MS);
          console.warn(`⏳ Rate limited (photo), waiting ${wait}ms (capped from ${requested}ms)...`);
          await this.sleep(wait);
        }

        // fallback text-only
        console.log("⚠️ Falling back to text-only message...");
        return await this._sendTextNow(chatId, alertData, customBotToken);
      }
    } catch (error) {
      console.error("❌ Error sending Telegram photo:", error.message);
      if (error.response) {
        console.error(
          "❌ Telegram API response:",
          error.response.status,
          error.response.statusText
        );
        if (error.response.data) {
          console.error(
            "❌ Error details:",
            JSON.stringify(error.response.data, null, 2)
          );
        }
      }
      console.log("⚠️ Falling back to text-only message...");
      try {
        return await this._sendTextNow(chatId, alertData, customBotToken);
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
   * @param {string} chatId - Telegram chat ID
   * @param {object} alertData - Alert data to format and send
   * @param {string|null} customBotToken - Optional custom bot token (user-specific)
   */
  async sendAlertMessage(chatId, alertData, customBotToken = null) {
    if (!chatId) {
      console.error("❌ sendAlertMessage: chatId missing");
      return false;
    }

    // Queue job instead of sending immediately
    this.enqueueJob({ type: "text", chatId, alertData, customBotToken });

    // We return true = "successfully queued"
    return true;
  }

  /**
   * Queue photo alert to Telegram (non-blocking)
   * @param {string} chatId - Telegram chat ID
   * @param {Buffer} photo - Photo buffer
   * @param {object} alertData - Alert data to format and send
   * @param {string|null} customBotToken - Optional custom bot token (user-specific)
   */
  async sendPhotoAlert(chatId, photo, alertData, customBotToken = null) {
    if (!chatId) {
      console.error("❌ sendPhotoAlert: chatId missing");
      return false;
    }

    if (!photo) {
      console.warn("⚠️ sendPhotoAlert: photo missing, sending text-only");
      this.enqueueJob({ type: "text", chatId, alertData, customBotToken });
      return true;
    }

    this.enqueueJob({ type: "photo", chatId, photo, alertData, customBotToken });
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
