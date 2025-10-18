# Email & Telegram Notification Setup Guide

## 📧 Email Setup (Gmail)

### Step 1: Enable App Password in Gmail
1. Go to your Google Account settings: https://myaccount.google.com/
2. Navigate to **Security** → **2-Step Verification** (enable if not already)
3. Scroll down to **App passwords**
4. Generate a new app password for "Mail"
5. Copy the 16-character password

### Step 2: Add to Environment Variables
Add these to your `.env` file:
```env
EMAIL_USER=your.email@gmail.com
EMAIL_PASSWORD=your_16_char_app_password
```

**Important:** Use the app password, NOT your regular Gmail password!

---

## 📱 Telegram Setup

### Step 1: Create a Telegram Bot
1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Follow instructions to name your bot
4. Copy the **bot token** (looks like: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

### Step 2: Get Your Chat ID
1. Search for `@userinfobot` in Telegram
2. Send any message to get your Chat ID
3. Copy the number (e.g., `123456789`)

### Step 3: Add to Environment Variables
Add to your `.env` file:
```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

### Step 4: Update User Settings in Database
You need to update your user document with:
- `telegramChatId`: Your chat ID from step 2
- `notificationPreferences.telegram`: Set to `true`

```javascript
// MongoDB Shell or Compass
db.users.updateOne(
  { email: "your.email@gmail.com" },
  {
    $set: {
      telegramChatId: "123456789",
      "notificationPreferences.email": true,
      "notificationPreferences.telegram": true
    }
  }
)
```

---

## 🧪 Testing Notifications

### Test Email
```bash
curl -X POST http://localhost:3000/api/notifications/test-email \
  -H "Content-Type: application/json" \
  -d '{"email": "your.email@gmail.com"}'
```

### Test Telegram
```bash
curl -X POST http://localhost:3000/api/notifications/test-telegram \
  -H "Content-Type: application/json" \
  -d '{"chatId": "123456789"}'
```

---

## 📊 Complete .env File Example

```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017/crypto-alerts

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_SECRET=your_super_secret_jwt_key_here

# Email (Gmail)
EMAIL_USER=your.email@gmail.com
EMAIL_PASSWORD=your_16_char_app_password

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11

# Binance
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_api_secret
```

---

## 🎯 Alert Notification Data Format

When an alert triggers, notifications will include:

```
Symbol: BTCUSDT
Target: 0.2%
Actual 24h change: -3.723%
Timeframe: 5MIN
Direction: Increase

Price: $0.0362
Last Price: $0.0361
Change in price: 0.277%
24h Volume: 22,540,424.6

Time: Oct 17, 22:15:16
Date: Oct 17, 2025
```

---

## 🔧 Troubleshooting

### Email Not Sending
- ✅ Check app password is correct (not regular password)
- ✅ Verify 2-Step Verification is enabled in Google
- ✅ Check server logs for error messages
- ✅ Test with `nodemailer` directly

### Telegram Not Sending
- ✅ Verify bot token is correct
- ✅ Make sure you've started a conversation with your bot
- ✅ Check chatId is correct (no quotes in number)
- ✅ Verify `notificationPreferences.telegram` is `true`

### No Notifications at All
- ✅ Check user exists in database
- ✅ Verify `notificationPreferences` field exists
- ✅ Check server console for errors
- ✅ Ensure alert actually triggered (check alert history)

---

## 📝 Notes

1. **Default Behavior**: Email is enabled by default, Telegram is disabled
2. **Per-User Settings**: Each user can have different notification preferences
3. **Automatic**: Once configured, notifications send automatically when alerts trigger
4. **Real-time**: Notifications are sent instantly when alert conditions are met
