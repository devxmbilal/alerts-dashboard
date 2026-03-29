import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();
class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
    this.emailQueue = [];
    this.isProcessingQueue = false;
    this.lastEmailTime = 0;
    this.minDelayBetweenEmails = 3000; // 3 seconds between emails
    this.maxRetries = 2;
    this.cooldownUntil = 0;
    this.failedAttempts = 0;
    this.maxFailedAttempts = 3;
  }

  // Initialize email transporter
  initialize() {
    try {
      if (this.initialized) return;

      // Configure nodemailer with your email provider
      // Using Gmail as example - you can change to any provider
      this.transporter = nodemailer.createTransport({
        service: "gmail",
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER, // Your email
          pass: process.env.EMAIL_PASSWORD, // App password (not regular password)
        },
      });

      this.initialized = true;
      console.log("✅ Email service initialized");
    } catch (error) {
      console.error("❌ Error initializing email service:", error);
    }
  }

  // Format alert data into email HTML
  formatAlertEmail(alertData) {
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

    const changeColor = changeFromBaselinePercent >= 0 ? "#4caf50" : "#f44336";
    const changeIcon = changeFromBaselinePercent >= 0 ? "📈" : "📉";

    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: Arial, sans-serif;
      background-color: #f5f5f5;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .alert-badge {
      display: inline-block;
      background-color: #f44336;
      color: white;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: bold;
      margin-top: 10px;
    }
    .content {
      padding: 30px;
    }
    .symbol {
      font-size: 32px;
      font-weight: bold;
      color: #333;
      margin-bottom: 20px;
      text-align: center;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #eee;
    }
    .info-label {
      color: #666;
      font-weight: 500;
    }
    .info-value {
      color: #333;
      font-weight: bold;
    }
    .change-positive {
      color: #4caf50;
    }
    .change-negative {
      color: #f44336;
    }
    .highlight-box {
      background-color: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 15px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .footer {
      background-color: #f8f9fa;
      padding: 20px;
      text-align: center;
      color: #666;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚨 Crypto Alert Triggered!</h1>
      <span class="alert-badge">TRIGGERED</span>
    </div>
    
    <div class="content">
      <div class="symbol">${symbol}</div>
      
      <div class="highlight-box">
        <div class="info-row">
          <span class="info-label">Target:</span>
          <span class="info-value">${targetValue || "N/A"}%</span>
        </div>
        <div class="info-row">
          <span class="info-label">Actual Change (${alertData.timeframe || "5MIN"}):</span>
          <span class="info-value ${actualValue >= 0 ? "change-positive" : "change-negative"}">${actualValue ? actualValue.toFixed(3) : "N/A"}%</span>
        </div>
        <div class="info-row">
          <span class="info-label">Timeframe:</span>
          <span class="info-value">${timeframe || "5MIN"}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Direction:</span>
          <span class="info-value">${direction || "Increase"}</span>
        </div>
      </div>
      
      <div class="info-row">
        <span class="info-label">Current Price:</span>
        <span class="info-value">$${triggeredPrice ? triggeredPrice.toFixed(6) : "N/A"}</span>
      </div>
      
      <div class="info-row">
        <span class="info-label">Last Price:</span>
        <span class="info-value">$${baselinePrice ? baselinePrice.toFixed(6) : "N/A"}</span>
      </div>
      
      <div class="info-row">
        <span class="info-label">${changeIcon} Change in price:</span>
        <span class="info-value" style="color: ${changeColor}">
          ${changeFromBaselinePercent !== undefined ? changeFromBaselinePercent.toFixed(3) : "N/A"}%
        </span>
      </div>
      
      <div class="info-row">
        <span class="info-label">24h Volume:</span>
        <span class="info-value">${volume ? new Intl.NumberFormat("en-US").format(volume) : "N/A"}</span>
      </div>
      
      <div class="info-row">
        <span class="info-label">Time:</span>
        <span class="info-value">${new Date(triggeredAt).toLocaleTimeString()}</span>
      </div>
      
      <div class="info-row">
        <span class="info-label">Date:</span>
        <span class="info-value">${new Date(triggeredAt).toLocaleDateString()}</span>
      </div>
    </div>
    
    <div class="footer">
      <p>This is an automated alert from your Crypto Alerts Dashboard</p>
      <p>© ${new Date().getFullYear()} Crypto Alerts Dashboard. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  // Check if we're in cooldown period
  isInCooldown() {
    return Date.now() < this.cooldownUntil;
  }

  // Set cooldown period (15 minutes)
  setCooldown() {
    this.cooldownUntil = Date.now() + 15 * 60 * 1000; // 15 minutes
    console.log(`⏰ Email service in cooldown until ${new Date(this.cooldownUntil).toLocaleTimeString()}`);
  }

  // Add email to queue
  async sendAlertEmail(userEmail, alertData) {
    // Check if cooldown is active
    if (this.isInCooldown()) {
      console.warn(`⏰ Email service in cooldown, skipping email to ${userEmail}`);
      return false;
    }

    // Check if email is disabled
    if (process.env.DISABLE_EMAIL_NOTIFICATIONS === "true") {
      console.log(`📧 Email notifications disabled, skipping email to ${userEmail}`);
      return false;
    }

    return new Promise((resolve) => {
      this.emailQueue.push({
        userEmail,
        alertData,
        resolve,
        retries: 0,
      });

      console.log(`📬 Email queued for ${userEmail} (Queue size: ${this.emailQueue.length})`);

      // Start processing queue if not already processing
      if (!this.isProcessingQueue) {
        this.processEmailQueue();
      }
    });
  }

  // Process email queue with rate limiting
  async processEmailQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.emailQueue.length > 0) {
      // Check cooldown
      if (this.isInCooldown()) {
        console.warn(`⏰ Email service in cooldown, pausing queue processing`);
        break;
      }

      const emailJob = this.emailQueue.shift();

      // Rate limiting: wait if needed
      const timeSinceLastEmail = Date.now() - this.lastEmailTime;
      if (timeSinceLastEmail < this.minDelayBetweenEmails) {
        const waitTime = this.minDelayBetweenEmails - timeSinceLastEmail;
        console.log(`⏳ Waiting ${waitTime}ms before sending next email...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      // Try to send email
      const success = await this._sendEmailNow(emailJob);
      this.lastEmailTime = Date.now();

      emailJob.resolve(success);

      // If failed and not too many failures, add back to queue
      if (!success && emailJob.retries < this.maxRetries) {
        emailJob.retries++;
        this.emailQueue.push(emailJob);
        console.log(`🔄 Email retry ${emailJob.retries}/${this.maxRetries} queued for ${emailJob.userEmail}`);
      }
    }

    this.isProcessingQueue = false;
  }

  // Actually send the email
  async _sendEmailNow(emailJob) {
    try {
      if (!this.initialized) {
        this.initialize();
      }

      if (!this.transporter) {
        console.error("❌ Email transporter not initialized");
        this.failedAttempts++;
        return false;
      }

      const htmlContent = this.formatAlertEmail(emailJob.alertData);

      const mailOptions = {
        from: `"Crypto Alerts" <${process.env.EMAIL_USER}>`,
        to: emailJob.userEmail,
        subject: `🚨 Alert Triggered: ${emailJob.alertData.symbol}`,
        html: htmlContent,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email sent ofthis pair ${emailJob.alertData.symbol}:`, info.messageId);
      
      // Reset failed attempts on success
      this.failedAttempts = 0;
      return true;
    } catch (error) {
      console.error("❌ Error sending email:", error.message);
      
      // Check for rate limiting errors
      if (error.response && error.response.includes("Too many login attempts")) {
        console.error("🚫 Gmail rate limit hit! Setting cooldown period...");
        this.setCooldown();
        this.failedAttempts = 0; // Reset since it's rate limit, not auth issue
      } else if (error.code === "EAUTH") {
        this.failedAttempts++;
        console.error(`❌ Email authentication failed (${this.failedAttempts}/${this.maxFailedAttempts})`);
        
        if (this.failedAttempts >= this.maxFailedAttempts) {
          console.error("🚫 Too many authentication failures, setting long cooldown...");
          this.setCooldown();
        }
      }
      
      return false;
    }
  }

  // Test email configuration
  async testEmail(testEmail) {
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

      return await this.sendAlertEmail(testEmail, testData);
    } catch (error) {
      console.error("❌ Error testing email:", error);
      return false;
    }
  }
}

export default new EmailService();
