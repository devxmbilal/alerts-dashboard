# 📧 Email Rate Limiting & Error Handling

## 🚨 Problem: "Too Many Login Attempts"

Gmail has strict rate limits. If too many alerts trigger quickly, you'll get:
```
454-4.7.0 Too many login attempts, please try again later
```

---

## ✅ **Solution Implemented:**

### **1. Email Queue System**
- Emails are **queued** instead of sent immediately
- Processed **one at a time** with delays
- **3 seconds** minimum between emails

### **2. Automatic Cooldown**
When rate limit is hit:
- ⏰ **15-minute cooldown** activated automatically
- All emails **skipped during cooldown**
- Resumes automatically after cooldown ends

### **3. Retry Logic**
- Failed emails **retry up to 2 times**
- Retries are also rate-limited
- After max retries, email is dropped

### **4. Authentication Failure Protection**
- Tracks failed authentication attempts
- After 3 auth failures → **15-minute cooldown**
- Prevents account lockout

---

## 🎛️ **Configuration Options:**

### **Temporarily Disable Email**
Add to `.env` file:
```env
DISABLE_EMAIL_NOTIFICATIONS=true
```

This will:
- ✅ Keep worker running
- ✅ Telegram still works (if configured)
- ✅ Alerts still trigger & save to database
- ❌ No emails sent

### **Adjust Rate Limiting**
Edit `services/EmailService.js`:
```javascript
this.minDelayBetweenEmails = 5000; // 5 seconds (default: 3 seconds)
this.maxRetries = 1; // Reduce retries (default: 2)
```

---

## 📊 **How It Works:**

### **Normal Flow:**
```
Alert 1 triggers → Email queued
  ↓ (3 seconds)
Email 1 sent ✅
  ↓
Alert 2 triggers → Email queued
  ↓ (3 seconds)
Email 2 sent ✅
```

### **Rate Limit Hit:**
```
Alert triggers → Email queued
  ↓
Email send attempted
  ↓
❌ "Too many login attempts" error
  ↓
⏰ 15-minute cooldown activated
  ↓
All queued emails skipped during cooldown
  ↓ (15 minutes later)
Cooldown ends → Emails resume
```

---

## 🔍 **Console Messages:**

### **Queue Processing:**
```
📬 Email queued for admin@alerts.com (Queue size: 3)
⏳ Waiting 3000ms before sending next email...
✅ Email sent to admin@alerts.com: 1234567890
```

### **Rate Limit Hit:**
```
❌ Error sending email: Too many login attempts
🚫 Gmail rate limit hit! Setting cooldown period...
⏰ Email service in cooldown until 5:40:15 PM
⏰ Email service in cooldown, skipping email to admin@alerts.com
```

### **Cooldown Ends:**
```
📬 Email queued for admin@alerts.com (Queue size: 1)
✅ Email sent to admin@alerts.com: 9876543210
```

---

## 💡 **Recommendations:**

### **Option 1: Reduce Alert Frequency**
```javascript
// In alert settings, increase lock period:
alertCount: {
  count: 1,
  timeframe: "15MIN",  // Increase from 5MIN to 15MIN
  lockPeriod: 30       // Increase lock to 30 minutes
}
```

### **Option 2: Batch Email Digest** (Future Enhancement)
Instead of 1 email per alert:
- Collect alerts for 5-10 minutes
- Send 1 email with all triggered alerts
- Much more email-friendly

### **Option 3: Prefer Telegram**
Telegram has **much higher rate limits**:
```env
# Disable email, use Telegram only
DISABLE_EMAIL_NOTIFICATIONS=true
TELEGRAM_BOT_TOKEN=your_bot_token
```

Update user preferences:
```javascript
db.users.updateOne(
  { email: "admin@alerts.com" },
  {
    $set: {
      "notificationPreferences.email": false,
      "notificationPreferences.telegram": true
    }
  }
)
```

---

## 🧪 **Testing:**

### **Test Rate Limiting:**
1. Create 10 alerts with low targets
2. Wait for them all to trigger quickly
3. Watch console for queue messages
4. Verify 3-second delays between emails

### **Test Cooldown:**
1. Let system hit rate limit
2. Verify cooldown message appears
3. Verify emails are skipped for 15 minutes
4. Verify emails resume after cooldown

---

## ⚙️ **Email Service Status:**

### **Check Queue Size:**
Console will show:
```
📬 Email queued for user@example.com (Queue size: 5)
```

### **Check Cooldown Status:**
If in cooldown:
```
⏰ Email service in cooldown until 5:40:15 PM
```

### **Check Send Rate:**
Look for:
```
⏳ Waiting 3000ms before sending next email...
```

---

## 🚫 **What NOT To Do:**

1. ❌ **Don't increase email speed** - Gmail will block faster
2. ❌ **Don't disable rate limiting** - You'll get locked out
3. ❌ **Don't use regular password** - Use App Password only
4. ❌ **Don't send too many test emails** - Triggers rate limit

---

## 📝 **Summary:**

✅ **Email queue** with rate limiting
✅ **Automatic cooldown** on rate limit
✅ **Retry logic** for failed emails
✅ **Easy disable option** via env var
✅ **Worker won't crash** on email errors

**Result:** Reliable email delivery without hitting Gmail limits! 🎉
