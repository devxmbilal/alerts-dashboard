# 🚀 Quick Start Guide - Email & Telegram Notifications

## ⚡ Fast Setup (5 Minutes)

### Step 1: Install Dependencies
```bash
npm install nodemailer
```

### Step 2: Setup Email (Gmail)
1. **Get App Password:**
   - Go to: https://myaccount.google.com/security
   - Enable "2-Step Verification"
   - Click "App passwords" → Generate new one
   - Copy the 16-character password

2. **Add to `.env`:**
```env
EMAIL_USER=your.email@gmail.com
EMAIL_PASSWORD=abcd efgh ijkl mnop
```

### Step 3: Setup Telegram (Optional)
1. **Create Bot:**
   - Open Telegram → Search `@BotFather`
   - Send: `/newbot`
   - Follow instructions
   - Copy token: `123456:ABC-DEF...`

2. **Get Chat ID:**
   - Search `@userinfobot` in Telegram
   - Send any message
   - Copy your Chat ID number

3. **Add to `.env`:**
```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

### Step 4: Update User in Database
Open MongoDB Compass or shell and run:
```javascript
db.users.updateOne(
  { email: "your.email@gmail.com" },
  {
    $set: {
      telegramChatId: "123456789",  // Your Telegram chat ID
      "notificationPreferences.email": true,
      "notificationPreferences.telegram": true
    }
  }
)
```

### Step 5: Test Notifications
**Test Email:**
```bash
curl -X POST http://localhost:3000/api/notifications/test-email \
  -H "Content-Type: application/json" \
  -d '{"email": "your.email@gmail.com"}'
```

**Test Telegram:**
```bash
curl -X POST http://localhost:3000/api/notifications/test-telegram \
  -H "Content-Type: application/json" \
  -d '{"chatId": "123456789"}'
```

### Step 6: Restart Server
```bash
npm run dev
```

---

## ✅ Done! 

Now when an alert triggers, you'll receive:
- 📧 **Email** with formatted alert data
- 📱 **Telegram message** with all details

---

## 📊 What You'll Receive

**Email Format:** Beautiful HTML email with:
- Symbol (e.g., BTCUSDT)
- Target vs Actual change
- Current price & last price
- Change percentage
- 24h volume
- Timestamp

**Telegram Format:** Formatted markdown message with all the same info

---

## 🔧 Quick Troubleshooting

**Email not working?**
- Use **app password**, not regular password
- Enable 2-Step Verification in Google first

**Telegram not working?**
- Start conversation with your bot first
- Check bot token is correct
- Verify chatId is a number (no quotes)

**No notifications at all?**
- Check `.env` file exists and has correct values
- Verify user has notification preferences set
- Check server console for errors

---

## 📝 Example .env File

```env
# Your existing variables...
MONGODB_URI=mongodb://localhost:27017/crypto-alerts
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your_secret

# Add these new ones:
EMAIL_USER=your.email@gmail.com
EMAIL_PASSWORD=abcd efgh ijkl mnop
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

---

🎉 **That's it! You're all set!**

For detailed troubleshooting, see `NOTIFICATION_SETUP.md`
