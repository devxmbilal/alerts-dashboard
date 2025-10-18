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
      targetValue,
      actualValue,
      direction,
      timeframe,
      triggeredPrice,
      baselinePrice,
      changeFromBaselinePercent,
      volume,
      triggeredAt,
    } = alertData;

    const changeEmoji = changeFromBaselinePercent >= 0 ? "📈" : "📉";
    const alertEmoji = "🚨";

    // Format with Telegram markdown
    return `
${alertEmoji} *ALERT TRIGGERED!* ${alertEmoji}

🪙 *${symbol}*

━━━━━━━━━━━━━━━━━━━━
📊 *Alert Details*
━━━━━━━━━━━━━━━━━━━━

🎯 Target: \`${targetValue || "N/A"}%\`
📉 Actual 24h change: \`${actualValue ? actualValue.toFixed(3) : "N/A"}%\`
⏱ Timeframe: \`${timeframe || "5MIN"}\`
🔄 Direction: \`${direction || "Increase"}\`

━━━━━━━━━━━━━━━━━━━━
💰 *Price Information*
━━━━━━━━━━━━━━━━━━━━

💵 Current Price: \`$${triggeredPrice ? triggeredPrice.toFixed(6) : "N/A"}\`
📍 Last Price: \`$${baselinePrice ? baselinePrice.toFixed(6) : "N/A"}\`
${changeEmoji} Change: \`${changeFromBaselinePercent !== undefined ? changeFromBaselinePercent.toFixed(3) : "N/A"}%\`

━━━━━━━━━━━━━━━━━━━━
📈 *Trading Volume*
━━━━━━━━━━━━━━━━━━━━

📊 24h Volume: \`${volume ? new Intl.NumberFormat("en-US").format(volume) : "N/A"}\`

━━━━━━━━━━━━━━━━━━━━
🕐 *Timestamp*
━━━━━━━━━━━━━━━━━━━━

⏰ Time: \`${new Date(triggeredAt).toLocaleTimeString()}\`
📅 Date: \`${new Date(triggeredAt).toLocaleDateString()}\`

━━━━━━━━━━━━━━━━━━━━

_Automated alert from Crypto Alerts Dashboard_
    `.trim();
  }

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
