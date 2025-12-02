# 🚀 TELEGRAM SCREENSHOT ALERT - DEMO TESTING GUIDE

## 📋 Quick Testing Steps

### Step 1: Get Your Telegram Chat ID

Pehle apna Chat ID nikalna hoga:

```bash
# Run this script
node get-telegram-chatid.js
```

**If you see messages:**
- Script aapko recent chats dikhayega
- Apna Chat ID copy karein

**If no messages found:**
1. Telegram kholo
2. Apne bot ko search karo (bot username mil jayega script se)
3. Bot ko koi bhi message bhejo (e.g., "Hi")
4. Phir se script run karo: `node get-telegram-chatid.js`

---

### Step 2: Run Demo Alert

Ab demo alert bhejne ke liye:

```bash
# Replace YOUR_CHAT_ID with actual chat ID from Step 1
node demo-telegram-alert.js YOUR_CHAT_ID
```

**Example:**
```bash
# If your chat ID is 123456789
node demo-telegram-alert.js 123456789
```

---

### Step 3: Check Telegram

Telegram pe check karo, aapko milega:
- ✅ Chart screenshot (BTCUSDT)
- ✅ Alert details:
  - Current Price
  - Baseline Price  
  - Change %
  - Volume
  - Time & Date
- ✅ Formatted message with emojis

---

## 🎯 What the Demo Shows

### 1. Screenshot Generation
```
📊 Generating screenshot for BTCUSDT...
✅ Screenshot generated in 1234ms
   Source: generated
   Size: 45.67 KB
```

### 2. Telegram Delivery
```
📤 Sending to Telegram...
✅ Alert sent successfully in 234ms!
```

### 3. Cache Performance
```
🔥 Testing cache hit...
✅ Cache HIT! Retrieved in 2ms
   Speed improvement: 617x faster!
```

---

## 📊 Expected Output

When you run the demo script, you'll see:

```
🚀 ========================================
   TELEGRAM SCREENSHOT ALERT DEMO TEST
========================================

✅ Telegram Bot Token found
✅ Chat ID: 123456789

📊 STEP 1: Connecting to MongoDB...
✅ MongoDB connected

📊 STEP 2: Initializing Services...
✅ Services initialized

📊 STEP 3: Preparing test alert data...
   Symbol: BTCUSDT
   Current Price: $45234.56
   Baseline Price: $44000.00
   Change: 2.81%
   Volume: 12,345,678,900
✅ Test data prepared

📊 STEP 4: Generating screenshot...
   This may take 2-5 seconds for first time...
✅ Screenshot generated in 1847ms
   Source: generated
   Size: 45.23 KB

📊 STEP 5: Sending Telegram alert with screenshot...
   Sending to Chat ID: 123456789...
✅ Telegram alert sent successfully in 892ms!

📊 STEP 6: FastScreenshotService Statistics:
{
  "hotHits": 0,
  "warmHits": 0,
  "coldHits": 0,
  "misses": 1,
  "generated": 1,
  "failed": 0,
  "totalRequests": 1,
  "hitRate": "0.00%",
  "cacheSize": {
    "hot": 1,
    "warm": 1,
    "cold": 1
  }
}

🎉 ========================================
   DEMO COMPLETED SUCCESSFULLY!
========================================

✅ Screenshot generated and cached
✅ Telegram alert sent with photo
✅ Total time: 2863ms

📱 Check your Telegram chat for the alert!
   You should see:
   • Chart screenshot
   • Alert details (price, change, volume)
   • Formatted message with emojis

🚀 System is working perfectly!
========================================

🔥 BONUS TEST: Testing cache hit rate...
   Requesting same screenshot again...

✅ Cache HIT! Retrieved in 3ms
   Source: hot cache
   Age: 0s old
   Speed improvement: 615x faster!

📊 Final Statistics:
   Cache Hit Rate: 50.00%
   Total Requests: 2
   Hot Cache Hits: 1
   Cache Size: 1 hot / 1 warm
```

---

## 📱 Telegram Message Format

Aapko Telegram pe yeh message format milega:

```
🚨 ALERT TRIGGERED! 🚨

BTCUSDT
━━━━━━━━━━━━━━━

📊 Actual 24h change: `5.20%`
💵 Current Price: `$45234.56`
📍 Last Price: `$44000.00`
📈 Change: `2.81%`
📊 24h Volume: `12,345,678,900`
⏰ Time: `07:30:45 pm`
📅 Date: `24 Nov 2025`

━━━━━━━━━━━━━━━

[Chart Screenshot Attached]
```

---

## 🐛 Troubleshooting

### Problem: "TELEGRAM_BOT_TOKEN not found"

**Solution:**
```bash
# Check .env file has token
cat .env | grep TELEGRAM_BOT_TOKEN

# Should show:
TELEGRAM_BOT_TOKEN=8305959326:AAHDT8CW0BPFXJK5RdNP_0c62agwoKraG50
```

### Problem: "Failed to send Telegram alert"

**Possible causes:**
1. **Wrong Chat ID** - Run `get-telegram-chatid.js` again
2. **Bot blocked** - Unblock bot on Telegram
3. **No permissions** - Bot needs permission to send messages

**Solution:**
1. Message bot on Telegram
2. Get correct Chat ID
3. Try again

### Problem: "Screenshot generation failed"

**Possible causes:**
1. **MongoDB not running**
2. **Network issue** (can't fetch from Binance)

**Solution:**
```bash
# Check MongoDB
mongosh --eval "db.adminCommand('ping')"

# Should show: { ok: 1 }
```

### Problem: "Module not found"

**Solution:**
```bash
# Install dependencies
npm install
```

---

## 🎯 Alternative: Test with Environment Variable

Agar har baar Chat ID nahi likhna chahte:

1. **Add to .env:**
```env
TELEGRAM_CHAT_ID=your_chat_id_here
```

2. **Run without argument:**
```bash
node demo-telegram-alert.js
```

Script automatically .env se Chat ID use karega.

---

## ✅ Success Criteria

Demo successful hai agar:

- ✅ Script runs without errors
- ✅ Telegram message received
- ✅ Screenshot attached hai message mein
- ✅ All alert details correct hain
- ✅ Cache test shows speed improvement
- ✅ Stats show hit rate increasing

---

## 🚀 Next Steps After Demo

Demo successful hone ke baad:

1. **Implement in RealTimeAlertProcessor:**
   - Follow `IMPLEMENTATION_CHECKLIST.md`
   - Update notification code
   - Restart workers

2. **Monitor Performance:**
   ```javascript
   const stats = FastScreenshotService.getStats();
   console.log(`Hit Rate: ${stats.hitRate}`);
   ```

3. **Create Real Alerts:**
   - Login to dashboard
   - Create alerts for real symbols
   - Watch them trigger with screenshots!

---

**Created:** November 24, 2025  
**Status:** Ready to Test  
**Estimated Time:** 2-3 minutes
