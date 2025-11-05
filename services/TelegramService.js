import dotenv from "dotenv";
import FormData from "form-data";
import axios from "axios";
dotenv.config();
class TelegramService {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
    this.initialized = false;
  }

  // Initialize Telegram service
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

  // Format alert data into Telegram message
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

    const changeEmoji = changeFromBaselinePercent >= 0 ? "📈" : "📉";

    // Format with Telegram markdown - Simple & Clean Design
    return `
🚨 *ALERT TRIGGERED!* 🚨

💠 *${symbol}*
━━━━━━━━━━━━━━━━━━━

📄 Actual 24h change: \`${actualValue ? actualValue.toFixed(3) : "N/A"}%\`
💵 Current Price: \`$${triggeredPrice ? triggeredPrice.toFixed(6) : "N/A"}\`
📍 Last Price: \`$${baselinePrice ? baselinePrice.toFixed(6) : "N/A"}\`
${changeEmoji} Change: \`${
      changeFromBaselinePercent !== undefined
        ? changeFromBaselinePercent.toFixed(3)
        : "N/A"
    }%\`
📊 24h Volume: \`${
      volume ? new Intl.NumberFormat("en-US").format(volume) : "N/A"
    }\`
⏰ Time: \`${new Date(triggeredAt).toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })}\`
📅 Date: \`${new Date(triggeredAt).toLocaleDateString('en-PK', { timeZone: 'Asia/Karachi', year: 'numeric', month: 'short', day: 'numeric' })}\`
━━━━━━━━━━━━━━━━━━━

_Automated alert from Crypto Alerts Dashboard_
    `.trim();
  }
z
  // Send alert to Telegram
  async sendAlertMessage(chatId, alertData) {
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
        return false;
      }
    } catch (error) {
      console.error("❌ Error sending Telegram message:", error);
      return false;
    }
  }

  /**
   * Send photo with caption to Telegram
   * @param {string} chatId - Telegram chat ID
   * @param {Buffer} photo - Image buffer
   * @param {Object} alertData - Alert data for caption
   * @returns {Promise<boolean>}
   */
  async sendPhotoAlert(chatId, photo, alertData) {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      if (!this.botToken) {
        console.error("❌ Telegram bot token not configured");
        return false;
      }

      const caption = this.formatAlertMessage(alertData);

      // Create FormData for multipart/form-data
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("photo", photo, {
        filename: `${alertData.symbol}_chart.jpg`,
        contentType: "image/jpeg",
      });
      formData.append("caption", caption);
      formData.append("parse_mode", "Markdown");

      // Use axios for better multipart/form-data handling
      const response = await axios.post(`${this.apiUrl}/sendPhoto`, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        timeout: 30000, // 30 second timeout
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      if (response.data.ok) {
        console.log(`✅ Telegram photo alert sent to chat ${chatId}`);
        return true;
      } else {
        console.error("❌ Telegram API error:", response.data.description);
        // Fallback to text message if photo fails
        console.log("⚠️ Falling back to text-only message...");
        return await this.sendAlertMessage(chatId, alertData);
      }
    } catch (error) {
      console.error("❌ Error sending Telegram photo:", error.message);
      // Fallback to text message
      console.log("⚠️ Falling back to text-only message...");
      try {
        return await this.sendAlertMessage(chatId, alertData);
      } catch (fallbackError) {
        console.error("❌ Fallback text message also failed:", fallbackError);
        return false;
      }
    }
  }

  // Test Telegram notification
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

  // Get bot info
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
