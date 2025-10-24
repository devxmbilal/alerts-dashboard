# 🏗️ Crypto Alerts Dashboard - Architecture Overview

## 📖 **Project Summary**

A **full-stack cryptocurrency alerts dashboard** that monitors real-time prices from Binance and triggers customizable alerts with Email/Telegram notifications.

---

## 🎯 **Tech Stack**

### **Frontend**
- **Next.js 15.5.4** (React 19) - Framework
- **Material-UI v5** - UI components
- **TailwindCSS v4** - Styling
- **TradingView Charts** - Price visualization
- **Context API** - State management
- **SSE** - Real-time updates

### **Backend**
- **Next.js API Routes** - REST APIs
- **MongoDB + Mongoose** - Database
- **Redis + ioredis** - Caching & Pub/Sub
- **JWT** - Authentication
- **WebSocket** - Binance connection

### **Workers**
- **Binance Worker** - Fetches live prices
- **Alert Worker** - Monitors & triggers alerts
- **Cleanup Worker** - Database maintenance
- **PM2** - Process management

### **External APIs**
- **Binance API** - Market data
- **Nodemailer** - Email notifications
- **Telegram Bot API** - Push notifications

---

## 🔄 **System Architecture**

```
┌─────────────────────────────────────────┐
│         BROWSER (Client)                │
│  Dashboard → FilterSidebar → MarketPanel│
│       ↓           ↓             ↓       │
│    Context Providers (Socket/Alert/Fav) │
└─────────────────┬───────────────────────┘
                  │ SSE/HTTP
┌─────────────────▼───────────────────────┐
│      NEXT.JS SERVER (Port 3000)         │
│  ┌─────────────────────────────────┐   │
│  │  API Routes                      │   │
│  │  /api/market/stream (SSE)        │   │
│  │  /api/alerts/* (CRUD)            │   │
│  │  /api/auth/* (JWT)               │   │
│  │  /api/favorites/*                │   │
│  └─────────────────────────────────┘   │
└─────────────┬───────────────────────────┘
              │
      ┌───────┴────────┐
      │                │
┌─────▼─────┐   ┌──────▼──────┐
│  MongoDB  │   │    Redis    │
│ (Database)│   │(Cache/PubSub)│
└─────┬─────┘   └──────┬──────┘
      │                │
┌─────▼────────────────▼──────┐
│   BACKGROUND WORKERS        │
│  - Binance Worker           │
│  - Alert Worker             │
│  - Cleanup Worker           │
└─────┬───────────────────────┘
      │
┌─────▼──────────┐
│ Binance API    │
│ (WebSocket +   │
│  REST)         │
└────────────────┘
      │
┌─────▼──────────┐
│ Notifications  │
│ - Email (SMTP) │
│ - Telegram Bot │
└────────────────┘
```

---

## 💾 **Database Models**

### **User**
```javascript
{
  username: String (unique)
  password: String (hashed)
  email: String (unique)
  favorites: [String] // Symbol array
  telegramChatId: String
  notificationPreferences: { email, telegram }
}
```

### **Alert**
```javascript
{
  userId: String
  symbol: String (e.g., "BTCUSDT")
  conditions: {
    minDaily: String // Min 24h volume
    changePercent: {
      timeframe: String // "5m", "15m", etc.
      percentage: String // e.g., "1.0"
      direction: String // "increase", "decrease", "both"
    }
    alertCount: {
      timeframe: String // Lock duration
      lockUntil: Date // Prevents re-trigger
    }
    // Optional: candle, rsiRange, volume, ema
  }
  baselinePrice: Number // Price when created
  lastTriggeredAt: Date
  status: String // "active", "paused", "triggered"
  notificationSettings: { email, telegram, webhook }
}
```

### **AlertHistory**
```javascript
{
  alertId: ObjectId
  userId: String
  symbol: String
  triggerData: { price, volume, priceChangePercent, ... }
  baselineData: { baselinePrice, changeFromBaselinePercent, ... }
  triggeredAt: Date
  notificationSent: { email, telegram }
  status: String // "triggered", "acknowledged"
}
```

---

## ⚙️ **How Workers Function**

### **1. Binance Worker**
**Purpose:** Streams live crypto prices

**Flow:**
1. Connects to Binance API
2. Fetches 1000+ USDT pairs
3. Gets initial 24hr ticker data
4. Opens WebSocket connections (200 pairs/connection)
5. Receives real-time price updates
6. Caches in Redis: `crypto:BTCUSDT`
7. Publishes to: `market:updates` channel

**Output:**
```javascript
{
  symbol: "BTCUSDT",
  price: 45000.00,
  priceChangePercent: 2.27,
  volume24h: 1234567890,
  high: 46000, low: 44000,
  timestamp: 1234567890
}
```

### **2. Alert Worker**
**Purpose:** Monitors alerts and triggers notifications

**Flow:**
1. Loads all active alerts from MongoDB
2. Subscribes to Redis `market:updates`
3. **Every 30 seconds (Round-Based):**
   - Fetches fresh alerts from DB
   - Gets live prices from Redis
   - Evaluates each alert
   - Triggers if conditions met
4. **Real-Time Processing:**
   - Processes price updates instantly
   - Evaluates conditions immediately

**Alert Evaluation Logic:**
```javascript
✅ Is alert locked? → Skip (wait for lock expiry)
✅ Price direction correct?
   - direction="increase" → currentPrice > baselinePrice
   - direction="decrease" → currentPrice < baselinePrice
✅ Min volume met? → volume24h >= minDaily
✅ Change % met?
   - change = (currentPrice - baselinePrice) / baselinePrice * 100
   - |change| >= requiredPercentage
✅ All conditions pass? → TRIGGER ALERT!
```

**When Triggered:**
1. Creates AlertHistory entry
2. Updates alert.lastTriggeredAt
3. Calculates lock duration from alertCount.timeframe
4. Sets alert.lockUntil (prevents re-trigger)
5. Publishes to `alert:triggers` channel
6. Sends Email/Telegram notifications
7. Broadcasts to clients via SSE

---

## 🚨 **Alert System Flow**

```
USER CREATES ALERT
  ↓
Selects favorites in MarketPanel
  ↓
Sets conditions in FilterSidebar
  ↓
Clicks "Create Alerts for Favorites"
  ↓
POST /api/alerts/bulk
  ↓
Server records baseline price from current market
  ↓
Saves alert to MongoDB
  ↓
Alert Worker loads alert into memory
  ↓
Monitors price updates from Binance Worker
  ↓
PRICE CHANGES
  ↓
Evaluates conditions:
  1. Not locked? ✓
  2. Direction correct? ✓
  3. Volume threshold met? ✓
  4. Change % threshold met? ✓
  ↓
CONDITIONS MET → TRIGGER!
  ↓
Creates AlertHistory
  ↓
Applies lock (e.g., 1 hour)
  ↓
Sends Email/Telegram notification
  ↓
Broadcasts to dashboard via SSE
  ↓
Dashboard auto-switches chart to triggered symbol
  ↓
Shows notification banner
  ↓
LOCK EXPIRES (after 1 hour)
  ↓
Alert becomes active again (retriggerable)
```

---

## 📡 **Real-Time Communication (SSE)**

### **Market Data Stream**
```
Binance WebSocket → Binance Worker → Redis Pub/Sub
                                          ↓
                             Shared Redis Subscriber
                                          ↓
                          SSE: /api/market/stream
                                          ↓
                          Client: SocketContext
                                          ↓
                          Updates MarketPanel UI
```

### **Message Types:**
1. **initial_data** - Bulk data on connect
2. **market_update** - Price updates
3. **heartbeat** - Keep-alive ping
4. **alert_triggered** - Alert notifications

---

## 🎨 **Frontend Components**

### **Dashboard (`app/dashboard/page.js`)**
- Main layout orchestrator
- 3-column desktop (Filters | Chart | Market)
- Mobile bottom navigation
- Context providers wrapper
- Auto-switches chart on alert trigger

### **FilterSidebar (`components/FilterSidebar.js`)**
Alert creation interface:
- **Basic Conditions:**
  - Min Daily Volume
  - Change % (+ direction)
  - Alert Count (+ lock timeframe)
- **Technical Conditions (Optional):**
  - Candle patterns
  - RSI Range
  - Volume trends
  - EMA crossovers

### **MarketPanel (`components/MarketPanel.js`)**
- Lists 1000+ USDT pairs
- Search & filter
- Favorites management (star/unstar)
- Bulk alert creation
- Live price updates (green/red)

### **TriggeredAlertsPanel**
- Shows alert history
- Detailed trigger info
- Clear alerts
- Auto-switches chart

### **TradingViewChart**
- Candlestick charts
- Multiple timeframes
- Volume bars
- Interactive

---

## 🔐 **Authentication Flow**

```
1. User registers → Password hashed → JWT generated
2. User logs in → Password validated → JWT returned
3. Client stores JWT in localStorage
4. Every request includes: Authorization: Bearer <JWT>
5. Server validates JWT → Allows/Denies access
```

---

## 📧 **Notification System**

### **Email (via Nodemailer)**
- Queue-based sending
- Rate limiting (3s between emails)
- Retry mechanism (2 retries)
- Cooldown on rate limit (15 min)
- Beautiful HTML templates

### **Telegram (via Bot API)**
- Instant delivery
- Markdown formatting
- Emoji-rich messages
- No rate limits

---

## 🔢 **Alert Locking Mechanism**

Prevents alert spam by locking after trigger:

```javascript
alertCount: {
  timeframe: "1h", // Lock for 1 hour
  lockUntil: Date  // Calculated timestamp
}

Lock Durations:
"5m"  → 5 minutes
"15m" → 15 minutes
"30m" → 30 minutes
"1h"  → 1 hour
"4h"  → 4 hours
"1d"  → 24 hours
```

After lock expires, alert can trigger again.

---

## 📊 **Key API Endpoints**

### **Authentication**
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### **Alerts**
- `GET /api/alerts` - List user alerts
- `POST /api/alerts` - Create alert
- `POST /api/alerts/bulk` - Create multiple alerts
- `GET /api/alerts/history` - Alert history
- `GET /api/alerts/latest-triggered` - Latest trigger

### **Market Data**
- `GET /api/market/stream` - SSE price stream
- `GET /api/market/pairs` - All USDT pairs
- `GET /api/market/klines` - Historical data

### **Favorites**
- `GET /api/favorites/list` - User favorites
- `POST /api/favorites/add` - Add favorite
- `POST /api/favorites/remove` - Remove favorite

---

## 🚀 **Deployment**

### **Production Setup**
1. Install Node.js 18+, MongoDB 6+, Redis 6+
2. Clone repository
3. Configure `.env` file
4. Build: `npm run build`
5. Start with PM2: `pm2 start ecosystem.config.cjs`
6. (Optional) Setup Nginx reverse proxy
7. (Optional) Configure SSL certificate

### **PM2 Process Manager**
Runs 3 processes:
- `alerts-dashboard` - Next.js server
- `binance-worker` - Price fetching
- `alert-worker` - Alert monitoring

---

## 📈 **Performance Features**

- ✅ Redis caching (5min TTL)
- ✅ SSE for efficient real-time updates
- ✅ Shared Redis subscriber (1 connection, many clients)
- ✅ Worker-based architecture (non-blocking)
- ✅ MongoDB indexes on frequently queried fields
- ✅ Throttled publishing (500ms min interval)
- ✅ Cleanup worker for data hygiene

---

## 🎯 **Key Features Summary**

1. **Real-Time Price Monitoring** - 1000+ USDT pairs
2. **Advanced Alert System** - Multi-condition alerts
3. **Retriggerable Alerts** - Lock mechanism prevents spam
4. **Dual Notifications** - Email + Telegram
5. **Favorites System** - Quick access to tracked pairs
6. **Live Charts** - TradingView integration
7. **Mobile Responsive** - Works on all devices
8. **Secure Authentication** - JWT-based
9. **High Performance** - Redis caching + SSE
10. **Scalable Architecture** - Worker-based design

---

## 🔍 **How It All Connects**

**User Journey:**
1. Register/Login
2. Browse crypto pairs in MarketPanel
3. Star favorites
4. Create alerts with conditions in FilterSidebar
5. System records baseline price
6. Workers monitor prices 24/7
7. Alert triggers when conditions met
8. Notification sent (Email/Telegram)
9. Dashboard shows alert + auto-switches chart
10. Alert locks for specified duration
11. Lock expires → Can trigger again

**Behind the Scenes:**
- Binance Worker continuously streams prices
- Prices cached in Redis
- Alert Worker checks conditions every 30s + real-time
- When triggered: History saved, lock applied, notifications sent
- Frontend receives updates via SSE
- UI updates instantly with live data

---

**Built with ❤️ for real-time crypto monitoring!**
