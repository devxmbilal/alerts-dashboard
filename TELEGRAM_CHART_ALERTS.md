# Telegram Chart Alerts - Implementation Guide

## 🎯 Overview

This document describes the implementation of TradingView chart screenshot integration with Telegram alerts. When an alert is triggered, a real-time screenshot of the TradingView chart is captured and sent to Telegram along with a formatted message.

## 🚀 Features

- ✅ **Real-time Chart Screenshots**: Captures TradingView charts using Puppeteer
- ✅ **Optimized Performance**: Fast screenshot capture (< 3 seconds)
- ✅ **Concurrent Processing**: Handles multiple alerts simultaneously
- ✅ **Automatic Fallback**: Falls back to text-only messages if screenshot fails
- ✅ **Multiple Timeframes**: Supports 1m, 5m, 15m, 1h, 4h, 1d timeframes
- ✅ **Error Handling**: Comprehensive error handling and logging
- ✅ **Memory Efficient**: Automatic cleanup and browser optimization

## 📦 Components

### 1. **Chart Screenshot Service** (`utils/chartScreenshot.js`)
Handles capturing TradingView chart screenshots using Puppeteer.

**Key Methods:**
- `initialize()` - Initialize Puppeteer browser with optimized settings
- `captureChart(symbol, timeframe)` - Capture a single chart screenshot
- `captureMultipleCharts(chartRequests)` - Capture multiple charts concurrently
- `healthCheck()` - Verify browser is running properly
- `shutdown()` - Clean up and close browser

### 2. **Telegram Service** (`services/TelegramService.js`)
Enhanced to send photos with captions.

**Key Methods:**
- `sendAlertMessage(chatId, alertData)` - Send text-only alert (fallback)
- `sendPhotoAlert(chatId, photo, alertData)` - Send alert with chart screenshot
- `formatAlertMessage(alertData)` - Format alert data into Telegram message

### 3. **Real-Time Alert Processor** (`services/RealTimeAlertProcessor.js`)
Integrated chart screenshot capture into the alert triggering flow.

**Changes:**
- Captures chart screenshot before sending Telegram notification
- Uses `sendPhotoAlert()` if screenshot is available
- Falls back to `sendAlertMessage()` if screenshot fails
- Includes comprehensive error handling

## 🛠️ Installation

### 1. Install Dependencies

```bash
npm install puppeteer form-data
```

### 2. Configure Environment Variables

Add the following to your `.env` file:

```env
# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here  # Optional, for testing
```

### 3. Get Your Telegram Bot Token

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the instructions
3. Copy the bot token and add it to `.env`

### 4. Get Your Chat ID (Optional)

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. Copy your chat ID and add it to `.env`

## 🧪 Testing

### Test Chart Screenshot Functionality

Run the comprehensive test script:

```bash
npm run test-chart-screenshot
```

This will:
1. Initialize Puppeteer browser
2. Capture a BTCUSDT chart screenshot
3. Save the screenshot locally (in `tmp/` folder)
4. Send a Telegram photo alert (if configured)
5. Test concurrent chart captures
6. Run health checks

### Test Individual Components

#### Test Chart Screenshot Only:

```javascript
import ChartScreenshotService from "./utils/chartScreenshot.js";

await ChartScreenshotService.initialize();
const screenshot = await ChartScreenshotService.captureChart("BTCUSDT", "5m");
await ChartScreenshotService.saveScreenshot(screenshot, "test.jpg");
await ChartScreenshotService.shutdown();
```

#### Test Telegram Photo Alert Only:

```javascript
import TelegramService from "./services/TelegramService.js";
import fs from "fs";

const photo = fs.readFileSync("./tmp/test.jpg");
const alertData = {
  symbol: "BTCUSDT",
  targetValue: 1,
  actualValue: 2.5,
  // ... other fields
};

await TelegramService.sendPhotoAlert("YOUR_CHAT_ID", photo, alertData);
```

## 📊 Alert Message Format

When an alert is triggered, the Telegram message includes:

```
🚨 ALERT TRIGGERED! 🚨

[TradingView Chart Image]

🪙 SYMBOL
━━━━━━━━━━━━━━━━━━━━
📊 Alert Details
━━━━━━━━━━━━━━━━━━━━
🎯 Target: X%
📉 Actual 24h change: Y%
⏱ Timeframe: 5MIN
🔄 Direction: Increase/Decrease

━━━━━━━━━━━━━━━━━━━━
💰 Price Information
━━━━━━━━━━━━━━━━━━━━
💵 Current Price: $X.XXX
📍 Last Price: $X.XXX
📈 Change: X.XXX%

━━━━━━━━━━━━━━━━━━━━
📈 Trading Volume
━━━━━━━━━━━━━━━━━━━━
📊 24h Volume: X,XXX,XXX.XX

━━━━━━━━━━━━━━━━━━━━
🕐 Timestamp (PKT)
━━━━━━━━━━━━━━━━━━━━
⏰ Time: HH:MM:SS AM/PM
📅 Date: DD MMM YYYY

━━━━━━━━━━━━━━━━━━━━
Automated alert from Crypto Alerts Dashboard
```

## ⚙️ Configuration

### Puppeteer Options

The browser is launched with optimized settings for server environments:

```javascript
{
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-gpu',
  ],
  defaultViewport: {
    width: 800,
    height: 400,
  },
}
```

### Screenshot Settings

- **Image Type**: JPEG (optimized for Telegram)
- **Quality**: 85 (balance between quality and file size)
- **Dimensions**: 800x400 pixels (optimal for mobile viewing)
- **Device Scale Factor**: 2 (high resolution/retina display)

### Timeframe Mapping

| Timeframe | TradingView Interval |
|-----------|---------------------|
| 1m        | 1                   |
| 5m        | 5                   |
| 15m       | 15                  |
| 1h        | 60                  |
| 4h        | 240                 |
| 1d        | D                   |

## 🔧 Troubleshooting

### Issue: Puppeteer fails to launch

**Solution:** Install required dependencies (Linux):
```bash
sudo apt-get install -y \
  chromium-browser \
  libgbm1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2
```

### Issue: Screenshot takes too long

**Solution:** The browser is configured with optimizations. If still slow:
1. Check your server's CPU/memory usage
2. Reduce concurrent screenshot captures
3. Increase timeout values in `chartScreenshot.js`

### Issue: Telegram photo fails to send

**Solution:** The system automatically falls back to text-only messages. Check:
1. File size is within Telegram limits (< 10MB)
2. Bot has proper permissions
3. Network connectivity is stable

### Issue: Charts appear empty or broken

**Solution:**
1. Increase wait time after page load (currently 2 seconds)
2. Check TradingView website is accessible
3. Verify the symbol format is correct (e.g., "BTCUSDT")

## 📈 Performance

### Benchmarks

- **Single Screenshot**: ~2-4 seconds
- **Concurrent Screenshots**: ~3-5 seconds for 3 charts
- **Memory Usage**: ~150-200MB per browser instance
- **Image Size**: ~50-150KB per screenshot

### Optimization Tips

1. **Reuse Browser Instance**: The service maintains a single browser instance
2. **Concurrent Captures**: Use `captureMultipleCharts()` for batch operations
3. **Cleanup**: Automatically cleans up old screenshots from `tmp/` folder
4. **Health Checks**: Monitors browser health and restarts if needed

## 🚦 Production Deployment

### Before Deploying:

1. ✅ Test all functionality with `npm run test-chart-screenshot`
2. ✅ Ensure Puppeteer dependencies are installed on server
3. ✅ Configure environment variables in production `.env`
4. ✅ Set up monitoring for screenshot failures
5. ✅ Configure proper logging

### Production Checklist:

- [ ] Puppeteer browser launches successfully
- [ ] Screenshots are captured within 5 seconds
- [ ] Telegram bot token is configured
- [ ] Fallback to text-only works correctly
- [ ] Error logging is in place
- [ ] Health checks pass consistently

## 🔒 Security Notes

- Keep your `TELEGRAM_BOT_TOKEN` secure (never commit to git)
- The bot token is stored in environment variables
- Screenshots are stored temporarily and cleaned up automatically
- No user data is stored in screenshots

## 📝 Logs

The system logs comprehensive information:

```
[SYMBOL] Capturing TradingView chart screenshot...
[SYMBOL] Screenshot captured successfully
[SYMBOL] Telegram alert sent with chart
```

If screenshot fails:
```
[SYMBOL] Failed to capture chart screenshot: [error]
[SYMBOL] Will send text-only alert
[SYMBOL] Telegram alert sent (text only)
```

## 🎉 Success!

Once configured, your Telegram alerts will automatically include:
- ✅ Real-time TradingView chart screenshots
- ✅ Formatted alert information
- ✅ Automatic fallback to text if needed
- ✅ Fast delivery (< 5 seconds from alert trigger)

## 🆘 Support

If you encounter issues:
1. Check the logs in console
2. Run `npm run test-chart-screenshot` to verify setup
3. Review error messages for specific issues
4. Ensure all dependencies are installed

## 🔄 Future Enhancements

Potential improvements:
- [ ] Add support for custom chart indicators
- [ ] Support for multiple chart exchanges (not just Binance)
- [ ] Screenshot caching to reduce load time
- [ ] Custom chart themes/styles
- [ ] Support for different chart types (line, candle, etc.)
- [ ] Screenshot annotations (price levels, markers, etc.)
