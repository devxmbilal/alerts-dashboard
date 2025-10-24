# 🎯 How the Crypto Alerts Dashboard Works

## **Quick Overview**

This dashboard monitors live cryptocurrency prices from Binance and automatically triggers alerts based on your custom conditions, sending notifications via Email or Telegram.

---

## 🔄 **Complete System Flow (Step-by-Step)**

### **Phase 1: User Setup**

**Step 1 - Authentication:**
```
User → Opens website → Redirected to /login
     → Enters credentials → JWT token issued
     → Stored in localStorage → Redirected to /dashboard
```

**Step 2 - Browse & Favorite:**
```
MarketPanel displays 1000+ USDT pairs (from Binance)
User clicks star icon → Symbol added to favorites
Favorites stored in MongoDB User.favorites array
```

**Step 3 - Create Alert:**
```
User opens FilterSidebar
Selects conditions:
  ✓ Min Daily Volume: 100,000,000
  ✓ Change %: 1.0%
  ✓ Direction: Increase
  ✓ Alert Count: 1 hour (lock after trigger)

User clicks "Create Alerts for Favorites"

For each favorite symbol:
  1. System gets current price from Redis cache
  2. Saves alert to MongoDB with:
     - baselinePrice: 45000.00 (current price)
     - conditions: { minDaily, changePercent, alertCount }
     - status: "active"
  3. Alert Worker loads alert into memory
```

---

### **Phase 2: Background Monitoring**

**Binance Worker (Always Running):**
```
1. Connects to Binance WebSocket
2. Subscribes to 1000+ ticker streams
3. Receives price updates every 1-2 seconds:
   {
     symbol: "BTCUSDT",
     price: 45500.00,
     volume24h: 1500000000,
     priceChangePercent: 1.11
   }
4. Caches in Redis: crypto:BTCUSDT
5. Publishes to Redis channel: market:updates
```

**Alert Worker (Always Running):**
```
Every 30 seconds:
  1. Fetch ALL active alerts from MongoDB
  2. Get current live prices from Redis
  3. For each alert:
     a. Check if locked (alert recently triggered?)
     b. Check price direction (increase/decrease)
     c. Evaluate all conditions
     d. Trigger if conditions met

Real-time (continuous):
  1. Listen to Redis market:updates channel
  2. Process price updates immediately
  3. Evaluate alerts instantly
```

---

### **Phase 3: Alert Evaluation**

**When BTCUSDT price updates to 46000:**

```
Alert Worker receives update:
{
  symbol: "BTCUSDT",
  price: 46000.00,
  volume24h: 1600000000,
  priceChangePercent: 2.22
}

Checks alert conditions:

1. Is alert locked?
   lockUntil: null → ✓ NOT LOCKED

2. Price direction check:
   Direction: "increase"
   Current: 46000 > Baseline: 45000 → ✓ PASS

3. Min Daily Volume:
   Required: 100,000,000
   Actual: 1,600,000,000 → ✓ PASS

4. Change % from baseline:
   Change = (46000 - 45000) / 45000 * 100
   Change = 2.22%
   Required: 1.0%
   2.22% >= 1.0% → ✓ PASS

ALL CONDITIONS MET → TRIGGER ALERT!
```

---

### **Phase 4: Alert Triggering**

**What happens when alert triggers:**

```
1. Create AlertHistory document:
   {
     alertId: "alert123",
     symbol: "BTCUSDT",
     triggeredAt: 2024-01-01T10:30:00Z,
     triggerData: {
       price: 46000,
       priceChangePercent: 2.22,
       volume24h: 1600000000
     },
     baselineData: {
       baselinePrice: 45000,
       changeFromBaselinePercent: 2.22
     }
   }

2. Update Alert document:
   - lastTriggeredAt: 2024-01-01T10:30:00Z
   - lastTriggeredPrice: 46000
   - lockUntil: 2024-01-01T11:30:00Z (1 hour lock)

3. Send Email notification:
   Subject: 🚨 Alert Triggered: BTCUSDT
   Body: Beautiful HTML email with:
     - Symbol: BTCUSDT
     - Target: 1.0%
     - Actual: 2.22%
     - Current Price: $46,000
     - Change: +2.22%

4. Send Telegram notification:
   Markdown-formatted message with emoji

5. Publish to Redis:
   Channel: alert:triggers
   Message: { type: "alert_triggered", symbol: "BTCUSDT", ... }

6. Broadcast via SSE:
   All connected clients receive notification
```

---

### **Phase 5: Frontend Updates**

**Dashboard receives alert trigger:**

```
1. RealTimeNotifications component receives SSE event
2. Dashboard.handleAlertTrigger() called
3. Chart auto-switches to BTCUSDT
4. Orange notification banner appears:
   "🚨 Alert triggered and switched to BTCUSDT
    Price: $46,000.00 (2.22%)"
5. TriggeredAlertsPanel adds to history
6. Notification auto-hides after 5 seconds
```

---

### **Phase 6: Alert Lock & Retriggering**

**Lock prevents spam:**

```
Alert locked for 1 hour (lockUntil: 11:30)

During lock period (10:30 - 11:30):
  - Price changes to 47000 → Alert does NOT trigger
  - Price changes to 48000 → Alert does NOT trigger
  - Alert Worker checks: "Still locked, skip"

After 1 hour (11:30):
  - Lock expires
  - Alert becomes active again
  - Price changes to 49000 → CAN TRIGGER AGAIN!
  
This makes alerts RETRIGGERABLE while preventing spam
```

---

## 📊 **Data Flow Visualization**

### **Price Update Flow:**
```
Binance API
    ↓ (WebSocket)
Binance Worker
    ↓ (Redis Pub/Sub)
Redis (market:updates)
    ↓
┌───────────────┬───────────────┐
↓               ↓               ↓
Alert Worker    SSE Stream      Dashboard
(Monitors)      (Broadcasts)    (Displays)
    ↓
Triggers Alert
    ↓
Notifications
```

### **Alert Creation Flow:**
```
User (FilterSidebar)
    ↓ (HTTP POST)
API /api/alerts/bulk
    ↓
Get current price from Redis
    ↓
Save to MongoDB with baselinePrice
    ↓
Alert Worker loads alert
    ↓
Starts monitoring
```

### **Alert Trigger Flow:**
```
Price Update → Alert Worker
    ↓
Evaluate Conditions
    ↓ (All Met)
Create AlertHistory
    ↓
Apply Lock (1 hour)
    ↓
Send Notifications
    ↓
Broadcast to Clients
    ↓
Dashboard Updates
```

---

## 🎨 **User Interface Components**

### **1. MarketPanel (Right Side)**
- Shows all USDT trading pairs
- Live price updates (every 1-2 seconds)
- Search functionality
- Star/unstar favorites
- Green = price up, Red = price down

### **2. FilterSidebar (Left Side)**
- Create alert conditions
- Select timeframes
- Set percentage thresholds
- Configure notifications
- "Create Alerts for Favorites" button

### **3. TradingViewChart (Center)**
- Live candlestick chart
- Multiple timeframes (1m, 5m, 15m, 1h, 4h, 1d)
- Volume bars
- Auto-switches on alert trigger

### **4. TriggeredAlertsPanel (Below Chart)**
- Shows alert history
- Most recent first
- Detailed trigger information
- Clear alerts button

### **5. RealTimeNotifications (Top Right)**
- Bell icon with badge count
- Dropdown list of notifications
- Clickable to view details

---

## 🔐 **Security Features**

1. **Password Hashing:** bcrypt with salt rounds
2. **JWT Authentication:** Secure token-based auth
3. **API Protection:** All routes check JWT validity
4. **MongoDB Indexes:** Optimized queries
5. **Redis TTL:** Auto-expire cached data
6. **Environment Variables:** Sensitive data protected

---

## 🚀 **Performance Optimizations**

1. **Redis Caching:** 5-minute TTL for prices
2. **Shared Redis Subscriber:** One connection for all SSE clients
3. **Worker Architecture:** Non-blocking background processing
4. **MongoDB Indexes:** Fast queries on userId, symbol, status
5. **SSE over WebSocket:** Lower overhead for one-way data
6. **Throttled Publishing:** Max 2 publishes/second
7. **Cleanup Worker:** Removes old data automatically

---

## 📱 **Mobile Responsive Design**

**Desktop (>1024px):**
```
┌─────────────┬─────────────┬─────────────┐
│ Filter      │   Chart     │   Market    │
│ Sidebar     │   +         │   Panel     │
│             │   Alerts    │             │
└─────────────┴─────────────┴─────────────┘
```

**Mobile (<768px):**
```
┌───────────────────────────────────┐
│  Selected View (Chart/Filters/Mkt) │
└───────────────────────────────────┘
        ┌─────────────────┐
        │ Bottom Nav:     │
        │ Chart│Filters│Mkt│
        └─────────────────┘
```

---

## 🔢 **Example Alert Scenarios**

### **Scenario 1: Simple Price Increase**
```
Condition:
- Symbol: BTCUSDT
- Min Volume: 100M
- Change: +1% increase
- Lock: 1 hour

Timeline:
10:00 - Alert created, baseline = $45,000
10:30 - Price = $45,450 (+1.0%) → TRIGGERED
10:30 - Lock until 11:30
10:45 - Price = $46,000 (+2.2%) → NOT triggered (locked)
11:30 - Lock expires
11:45 - Price = $46,500 (+3.3%) → TRIGGERED AGAIN
```

### **Scenario 2: Price Decrease Alert**
```
Condition:
- Symbol: ETHUSDT
- Min Volume: 50M
- Change: -1% decrease
- Lock: 30 minutes

Timeline:
10:00 - Alert created, baseline = $3,000
10:15 - Price = $2,970 (-1.0%) → TRIGGERED
10:15 - Lock until 10:45
10:30 - Price = $2,940 (-2.0%) → NOT triggered (locked)
10:45 - Lock expires
11:00 - Price = $2,910 (-3.0%) → TRIGGERED AGAIN
```

### **Scenario 3: Both Directions**
```
Condition:
- Symbol: SOLUSDT
- Min Volume: 20M
- Change: 1% (any direction)
- Lock: 15 minutes

Triggers on:
- +1% increase OR -1% decrease
Whichever happens first
```

---

## 🛠️ **Key Technologies Explained**

### **Server-Sent Events (SSE)**
- One-way data stream from server to client
- Automatic reconnection on disconnect
- Lower overhead than WebSocket
- Perfect for price updates (server → client only)

### **Redis Pub/Sub**
- Decouples workers from API server
- Binance Worker publishes prices
- Alert Worker + SSE Stream subscribe
- Real-time, low-latency communication

### **MongoDB**
- Document database for flexible schema
- Stores users, alerts, alert history
- Indexes for fast queries
- Automatic timestamps

### **PM2**
- Process manager for Node.js
- Auto-restart on crash
- Monitors CPU/memory usage
- Handles graceful shutdowns
- Logs management

---

## 📧 **Notification Details**

### **Email (Nodemailer + Gmail)**
```
Setup:
1. Enable 2FA on Gmail
2. Generate App Password
3. Set EMAIL_USER and EMAIL_PASSWORD

Features:
- Queue-based sending
- Rate limiting (3s between emails)
- Retry on failure (2 attempts)
- Cooldown on rate limit (15 min)
- Beautiful HTML templates
```

### **Telegram Bot**
```
Setup:
1. Create bot via @BotFather
2. Get bot token
3. Get your chat ID
4. Set TELEGRAM_BOT_TOKEN

Features:
- Instant delivery
- Markdown formatting
- No rate limits
- Works globally
```

---

## 🎯 **Summary**

The system works like this:

1. **Binance Worker** continuously streams live prices
2. **Prices cached** in Redis for fast access
3. **User creates alerts** with custom conditions
4. **Alert Worker** monitors prices 24/7
5. **Conditions met** → Alert triggers
6. **Lock applied** to prevent spam (retriggerable)
7. **Notifications sent** via Email/Telegram
8. **Dashboard updates** in real-time via SSE
9. **Chart auto-switches** to triggered pair
10. **After lock expires** → Can trigger again

**Result:** Fully automated, real-time crypto monitoring with intelligent alert management!
