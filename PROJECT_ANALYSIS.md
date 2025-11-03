# 📊 Crypto Alerts Dashboard - Complete Project Analysis

## 🏗️ Project Overview

**Crypto Alerts Dashboard** ek **full-stack MERN application** hai jo **Next.js 15** par based hai. Yeh real-time cryptocurrency alerts provide karti hai with Binance market data integration, multiple notification channels (Email, Telegram), aur comprehensive dashboard UI.

---

## 📁 Project Structure

```
alerts-dashboard/
├── app/                    # Next.js 15 App Router
│   ├── api/               # Backend API Routes
│   ├── dashboard/         # Main dashboard page
│   ├── login/            # Login page
│   ├── layout.js        # Root layout
│   └── ThemeProvider.js  # MUI theme configuration
│
├── components/           # React UI Components
│   ├── MarketPanel.js
│   ├── FilterSidebar.js
│   ├── TradingViewChart.js
│   ├── AlertHistory.js
│   └── RealTimeNotifications.js
│
├── contexts/            # React Context Providers
│   ├── AlertContext.js
│   ├── SocketContext.js
│   └── FavoritesContext.js
│
├── services/           # Business Logic Services
│   ├── RealTimeAlertProcessor.js  # Core alert processing
│   ├── TelegramService.js
│   ├── EmailService.js
│   ├── NotificationService.js
│   └── AlertService.js
│
├── workers/           # Background Workers
│   ├── binance-worker.js        # Market data fetcher
│   ├── alert-worker.js          # Legacy alert processor
│   ├── real-time-alert-worker.js # Real-time alert processor
│   └── cleanup-worker.js        # Database cleanup
│
├── models/            # MongoDB Schemas
│   ├── User.js
│   ├── Alert.js
│   └── AlertHistory.js
│
├── utils/             # Utility Functions
│   ├── mongodb.js
│   ├── redis.js
│   └── auth.js
│
└── scripts/          # Setup & Testing Scripts
    ├── setup-database.js
    └── seed-users.js
```

---

## 🛠️ Technology Stack

### **Frontend**
- **Next.js 15.5.4** - React framework with App Router
- **React 19.1.0** - UI library
- **Material-UI (MUI) 5.15.0** - UI component library
- **Lightweight Charts 5.0.9** - Trading charts
- **Socket.IO Client 4.8.1** - Real-time updates

### **Backend**
- **Next.js API Routes** - Serverless API endpoints
- **MongoDB 8.19.0** - Database (via Mongoose)
- **Redis 5.8.3** - Caching & Pub/Sub
- **ioredis 5.8.0** - Redis client

### **Infrastructure**
- **PM2 6.0.13** - Process manager for production
- **Node.js Workers** - Background processing
- **WebSocket (ws 8.18.3)** - Real-time market data

### **Third-Party Services**
- **Binance API** - Crypto market data
- **Telegram Bot API** - Telegram notifications
- **Nodemailer 6.10.1** - Email notifications

---

## 🏛️ Architecture Overview

### **1. Frontend Architecture**

```
User Browser
    ↓
Next.js App (Port 3000)
    ↓
├── Dashboard Page
│   ├── MarketPanel (Real-time prices)
│   ├── FilterSidebar (Alert creation)
│   ├── TradingViewChart (Price charts)
│   └── RealTimeNotifications (Alert notifications)
    ↓
API Routes (/api/*)
    ↓
Services Layer
```

**Key Features:**
- **Server-Side Rendering (SSR)** via Next.js
- **Real-time updates** via Server-Sent Events (SSE)
- **Responsive design** - Desktop, Tablet, Mobile
- **Dark theme** with Material-UI
- **Context API** for state management (Alerts, Favorites, Socket)

---

### **2. Backend Architecture**

```
┌─────────────────────────────────────────────────┐
│           Background Workers                     │
├─────────────────────────────────────────────────┤
│  Binance Worker  │  Alert Worker  │ Cleanup     │
│  (Market Data)   │  (Processing)   │ Worker      │
└─────────────────────────────────────────────────┘
         ↓              ↓              ↓
┌─────────────────────────────────────────────────┐
│              Redis Pub/Sub                        │
│  market:updates │ alert:triggers │ notifications │
└─────────────────────────────────────────────────┘
         ↓              ↓              ↓
┌─────────────────────────────────────────────────┐
│         Next.js API Routes                       │
│  /api/alerts  │ /api/market │ /api/auth         │
└─────────────────────────────────────────────────┘
         ↓              ↓              ↓
┌─────────────────────────────────────────────────┐
│         Services Layer                           │
│  RealTimeAlertProcessor │ TelegramService      │
│  EmailService │ NotificationService              │
└─────────────────────────────────────────────────┘
         ↓              ↓              ↓
┌─────────────────────────────────────────────────┐
│         Database Layer                           │
│  MongoDB (Users, Alerts, History)              │
│  Redis (Cache, Pub/Sub)                        │
└─────────────────────────────────────────────────┘
```

---

## 📡 Data Flow

### **Alert Creation Flow**
```
1. User creates alert via FilterSidebar
   ↓
2. POST /api/alerts → AlertService.createAlert()
   ↓
3. Alert saved to MongoDB with baseline price
   ↓
4. RealTimeAlertProcessor.loadAllActiveAlerts() loads into memory
   ↓
5. Alert ready for monitoring
```

### **Alert Triggering Flow**
```
1. Binance Worker fetches market data every 2 seconds
   ↓
2. Market data published to Redis "market:updates" channel
   ↓
3. Real-Time Alert Worker subscribes to "market:updates"
   ↓
4. RealTimeAlertProcessor.processPriceUpdate() evaluates alerts
   ↓
5. If conditions met → triggerAlertWithLiveData()
   ↓
6. AlertHistory saved to MongoDB
   ↓
7. sendRealTimeNotification() called (non-blocking)
   ├── Email notification (if enabled)
   ├── Telegram notification (if enabled) [Non-blocking]
   └── SSE notification to frontend
   ↓
8. Redis publish to "alert:triggers" channel
   ↓
9. Frontend receives via /api/alerts/stream (SSE)
   ↓
10. UI updates (badge, notifications, chart switch)
```

### **Real-Time Updates Flow**
```
Binance Worker
   ↓
WebSocket → Binance API
   ↓
Market data → Redis Pub/Sub
   ↓
Frontend SSE (/api/market/stream)
   ↓
MarketPanel updates prices in real-time
```

---

## 🗄️ Database Schema

### **User Model**
```javascript
{
  username: String (unique, required)
  email: String (unique, required)
  password: String (hashed with bcrypt)
  telegramChatId: String (optional)
  notificationPreferences: {
    email: Boolean (default: true)
    telegram: Boolean (default: false)
  }
  favorites: [String] (crypto symbols)
  isActive: Boolean (default: true)
}
```

### **Alert Model**
```javascript
{
  symbol: String (e.g., "BTCUSDT")
  userId: String (required, indexed)
  status: "active" | "paused" | "triggered" | "expired"
  conditions: {
    minDaily: String
    changePercent: {
      timeframe: "5MIN" | "15MIN" | "1H" | "4H" | "1D"
      // ⚠️ IMPORTANT: Timeframe means the interval for baseline price updates
      // Example: If timeframe = "5MIN" and alert created at 10:00 AM with baseline = $100
      // - At 10:05 AM: Baseline automatically updates to current price (e.g., $102)
      // - At 10:10 AM: Baseline automatically updates to current price (e.g., $104)
      // Alert checks if current price is X% different from the CURRENT baseline
      percentage: String
      direction: "increase" | "decrease" | "both"
    }
    // Optional: candle, rsiRange, volume, ema
  }
  baselinePrice: Number (price when alert created)
  baselineTimestamp: Date
  notificationSettings: {
    email: Boolean
    telegram: Boolean
    webhook: Boolean
  }
}
```

### **AlertHistory Model**
```javascript
{
  alertId: ObjectId (ref: Alert)
  userId: String (indexed)
  symbol: String (indexed)
  alertConditions: Object (original alert conditions)
  conditions: String (human-readable)
  triggerData: {
    price: Number
    priceChangePercent: Number
    volume24h: Number
    high, low, open, close: Number
  }
  baselineData: {
    baselinePrice: Number
    changeFromBaselinePercent: Number
  }
  triggeredAt: Date (indexed)
  notificationSent: {
    email: Boolean
    telegram: Boolean (atomic update for duplicates)
    webhook: Boolean
  }
  status: "triggered" | "acknowledged" | "dismissed"
}
```

---

## ⚙️ Core Services

### **1. RealTimeAlertProcessor**
**Location:** `services/RealTimeAlertProcessor.js`

**Responsibilities:**
- Load all active alerts into memory
- Process price updates in real-time
- Evaluate alert conditions (change%, volume, RSI, EMA, candle patterns)
- Trigger alerts when conditions met
- Send notifications (Email, Telegram, SSE) - **Non-blocking**
- Maintain alert locks to prevent duplicate triggers

**Key Features:**
- **Parallel Processing:** Uses `p-limit` (concurrency: 50) for alert evaluation
- **Round-based Processing:** Processes alerts every 3 seconds
- **Atomic Updates:** Prevents duplicate Telegram notifications
- **Non-blocking Notifications:** Fire-and-forget pattern for better performance
- **Timeframe-based Baseline Updates:** Baseline price automatically updates every timeframe interval (e.g., every 5 minutes for "5MIN" timeframe)

**Performance Optimizations:**
```javascript
// Parallel alert processing
const alertPromises = freshAlerts.map(alert =>
  this.processLimit(async () => {
    // Process alert with live data
  })
);
await Promise.all(alertPromises);

// Non-blocking notifications
this.sendRealTimeNotification(...).catch(error => {
  // Handle errors without blocking
});
```

---

### **2. TelegramService**
**Location:** `services/TelegramService.js`

**Features:**
- Format alert messages with Telegram markdown
- Send messages via Telegram Bot API
- Retry logic (3 attempts with 1.1s delay)
- Pakistan timezone (Asia/Karachi) for timestamps
- Rich formatting with emojis and structured data

**Message Format:**
```
🚨 ALERT TRIGGERED! 🚨
🪙 BTCUSDT
━━━━━━━━━━━━━━━━━━━━
📊 Alert Details
🎯 Target: 2.5%
📉 Actual 24h change: 3.2%
⏱ Timeframe: 5MIN
🔄 Direction: Increase
━━━━━━━━━━━━━━━━━━━━
💰 Price Information
💵 Current Price: $43,250.50
📍 Last Price: $41,875.20
📈 Change: 3.28%
━━━━━━━━━━━━━━━━━━━━
📈 Trading Volume
📊 24h Volume: 1,234,567,890
━━━━━━━━━━━━━━━━━━━━
🕐 Timestamp (PKT)
⏰ Time: 02:30:45 PM
📅 Date: Oct 26, 2025
```

---

### **3. NotificationService**
**Location:** `services/NotificationService.js`

**Features:**
- Server-Sent Events (SSE) for real-time frontend updates
- Subscriber pattern (userId → callbacks)
- Redis storage for notification persistence
- Badge count management

**SSE Endpoint:** `/api/alerts/stream`

---

### **4. AlertService**
**Location:** `services/AlertService.js`

**Methods:**
- `createAlert()` - Create new alert with baseline price
- `getUserAlerts()` - Get all alerts for user
- `updateAlertStatus()` - Update alert status
- `deleteAlert()` - Remove alert
- `triggerAlert()` - Mark alert as triggered

---

## 🔄 Background Workers

### **1. Binance Worker**
**File:** `workers/binance-worker.js`

**Functionality:**
- Connects to Binance WebSocket for real-time price updates
- Fetches 24h ticker data via REST API
- Publishes market data to Redis `market:updates` channel
- Handles reconnections and errors
- Updates prices every 2 seconds

**Redis Channel:** `market:updates`
**Update Frequency:** 2 seconds

---

### **2. Real-Time Alert Worker**
**File:** `workers/real-time-alert-worker.js`

**Functionality:**
- Subscribes to Redis `market:updates` channel
- Receives price updates in real-time
- Calls `RealTimeAlertProcessor.processPriceUpdate()`
- Also subscribes to Binance WebSocket as backup
- Handles instant alert evaluation (sub-second response)

**Key Difference from Alert Worker:**
- **Real-time processing** (immediate on price update)
- vs. **Round-based processing** (every 3 seconds)

---

### **3. Alert Worker (Legacy)**
**File:** `workers/alert-worker.js`

**Functionality:**
- Round-based processing (every 3-5 seconds)
- Fetches alerts from database each round
- Evaluates conditions
- Triggers alerts

**Note:** May be redundant with Real-Time Alert Worker, but kept for compatibility.

---

### **4. Cleanup Worker**
**File:** `workers/cleanup-worker.js`

**Functionality:**
- Cleans old alert history (keeps last 30 days)
- Removes expired alerts
- Database maintenance
- Runs periodically (daily)

---

## 🌐 API Endpoints

### **Authentication**
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login (JWT token)
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout

### **Alerts**
- `GET /api/alerts?userId=xxx` - Get user alerts
- `POST /api/alerts` - Create alert
- `PUT /api/alerts` - Update alert
- `DELETE /api/alerts/remove` - Delete alert
- `GET /api/alerts/history?userId=xxx` - Get alert history
- `GET /api/alerts/triggered?userId=xxx` - Get triggered alerts
- `GET /api/alerts/latest-triggered` - Get latest triggered alert
- `GET /api/alerts/stream` - SSE stream for real-time alerts
- `POST /api/alerts/bulk` - Bulk operations
- `POST /api/alerts/reset-baseline` - Reset baseline price

### **Market Data**
- `GET /api/market/pairs` - Get available trading pairs
- `GET /api/market/klines` - Get candlestick data
- `GET /api/market/stream` - SSE stream for market updates

### **Favorites**
- `GET /api/favorites/list?userId=xxx` - Get favorites
- `POST /api/favorites/add` - Add to favorites
- `POST /api/favorites/remove` - Remove from favorites
- `POST /api/favorites/bulk` - Bulk operations
- `POST /api/favorites/clear` - Clear all favorites

### **Notifications**
- `GET /api/notifications?userId=xxx` - Get notifications
- `GET /api/notifications/stream` - SSE stream
- `POST /api/notifications/test-email` - Test email
- `POST /api/notifications/test-telegram` - Test Telegram

### **User Settings**
- `GET /api/user/settings?userId=xxx` - Get settings
- `PUT /api/user/settings` - Update settings

---

## 🎨 Frontend Components

### **1. Dashboard (`app/dashboard/page.js`)**
- Main layout container
- Authentication check
- Responsive design (mobile/tablet/desktop)
- Navigation menu
- User settings modal
- Real-time notification badge

### **2. MarketPanel (`components/MarketPanel.js`)**
- Real-time price list
- Search and filter
- Sort options (price, change%, volume)
- Favorites toggle
- Multi-select for bulk alerts
- SSE connection to `/api/market/stream`

### **3. FilterSidebar (`components/FilterSidebar.js`)**
- Alert creation form
- Multiple condition types:
  - Price change % (with timeframe)
  - Candle patterns
  - RSI indicators
  - Volume conditions
  - EMA indicators
- Notification preferences (Email, Telegram)
- Accordion-based UI

### **4. TradingViewChart (`components/TradingViewChart.js`)**
- Lightweight Charts integration
- Multiple timeframes (1m, 5m, 15m, 1h, 4h, 1d)
- Real-time price updates
- Candlestick visualization

### **5. RealTimeNotifications (`components/RealTimeNotifications.js`)**
- Notification badge counter
- Alert notifications panel
- SSE connection to `/api/alerts/stream`
- Browser notifications (if permitted)

### **6. AlertHistory (`components/AlertHistory.js`)**
- List of triggered alerts
- Filter by symbol, date
- Status indicators
- Detailed alert information

---

## 🔐 Authentication & Security

### **JWT Authentication**
- Token-based authentication
- Token stored in `localStorage`
- Middleware: `utils/auth.js`
- Token expiry: Configurable via `JWT_EXPIRES_IN`

### **Password Security**
- bcrypt hashing (salt rounds: 10)
- Passwords never sent to frontend
- Pre-save hook in User model

### **API Security**
- Protected routes require `Authorization: Bearer <token>`
- User ID extracted from token
- Token verification on each request

---

## 📊 Performance Optimizations

### **1. Caching (Redis)**
- User favorites cached (1 hour TTL)
- User alerts cached (1 hour TTL)
- Market data cached (2 seconds)

### **2. Parallel Processing**
- Alert evaluation: 50 concurrent alerts
- Uses `p-limit` for concurrency control
- Non-blocking notifications

### **3. Database Indexing**
- User: `isActive`, `email`, `username`
- Alert: `symbol`, `status`, `userId`, `createdAt`
- AlertHistory: `userId`, `symbol`, `status`, `triggeredAt`, `alertId`

### **4. Connection Pooling**
- MongoDB connection reuse
- Redis connection reuse
- WebSocket connection reuse

---

## 🚀 Deployment

### **PM2 Configuration**
**File:** `ecosystem.config.cjs`

**Processes:**
1. **alerts-dashboard** - Next.js app (Port 3000)
2. **binance-worker** - Market data fetcher
3. **alert-worker** - Legacy alert processor
4. **cleanup-worker** - Database cleanup

**Commands:**
```bash
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs
pm2 restart all
pm2 stop all
```

### **Environment Variables**
```bash
MONGODB_URI=mongodb://localhost:27017/crypto-alerts
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your-secret-key
TELEGRAM_BOT_TOKEN=your-bot-token
NODE_ENV=production
```

---

## 🐛 Known Issues & Fixes

### **1. Telegram Notifications**
**Issue:** Alerts not consistently sent to Telegram
**Fix:**
- Atomic database updates (`findOneAndUpdate` with `$ne: true`)
- Non-blocking notification calls
- Retry logic (3 attempts)
- Proper `_id` propagation

### **2. Font Sizes**
**Issue:** Text too small on dashboard
**Fix:**
- Increased base font size in `ThemeProvider.js`
- Responsive font sizes enabled
- Global zoom (1.06) for desktop

### **3. User Menu Clipping**
**Issue:** Settings/Logout menu going off-screen
**Fix:**
- Proper `anchorOrigin` and `transformOrigin`
- `marginThreshold` set to 16
- `PaperProps` with `minWidth` and `maxWidth`

---

## 📈 Scalability Considerations

### **Current Limitations**
- Single Redis instance (no clustering)
- Single MongoDB instance (no sharding)
- Workers run on single server
- No load balancing

### **Future Improvements**
1. **Redis Cluster** for high availability
2. **MongoDB Replica Set** for read scaling
3. **Worker Scaling** with PM2 cluster mode
4. **Load Balancer** for multiple Next.js instances
5. **CDN** for static assets
6. **Database Sharding** for large user bases

---

## 🧪 Testing

### **Test Scripts**
- `npm run test-redis` - Test Redis connection
- `npm run test-telegram` - Test Telegram notifications
- `scripts/test-real-time-worker.js` - Test alert worker

### **Manual Testing**
1. Create alert → Check database
2. Trigger alert → Check Telegram/Email
3. Real-time updates → Check frontend
4. SSE connection → Check browser console

---

## 📝 Development Workflow

### **Local Development**
```bash
# Install dependencies
npm install

# Start all services
npm run start-all

# Or start separately
npm run dev              # Next.js dev server
npm run worker           # Binance worker
npm run alert-worker     # Alert worker
npm run cleanup-worker   # Cleanup worker
```

### **Production Deployment**
```bash
# Build Next.js app
npm run build

# Start with PM2
pm2 start ecosystem.config.cjs

# Check status
pm2 status
pm2 logs
```

---

## 🎯 Key Features Summary

✅ **Real-time Market Data** - Binance WebSocket integration
✅ **Advanced Alert Conditions** - Price, Volume, RSI, EMA, Candle patterns
✅ **Multi-channel Notifications** - Email, Telegram, Browser
✅ **Parallel Processing** - 50 concurrent alerts
✅ **Non-blocking Notifications** - No performance impact
✅ **Atomic Updates** - Prevents duplicate notifications
✅ **Responsive UI** - Mobile, Tablet, Desktop
✅ **SSE Real-time Updates** - Server-Sent Events
✅ **Redis Pub/Sub** - Inter-worker communication
✅ **PM2 Production Ready** - Process management

---

## 📚 Documentation Files

- `README.md` - Basic setup guide
- `ALERT_FIX_GUIDE.md` - Alert system fixes
- `TELEGRAM_NOTIFICATION_FIX.md` - Telegram fixes
- `PRODUCTION_DEPLOYMENT_GUIDE.md` - Production setup
- `FIX_PM2_ISSUES.md` - PM2 configuration fixes
- `PROJECT_ANALYSIS.md` - This document

---

## 🔄 Recent Improvements

1. **Non-blocking Telegram notifications** - Fire-and-forget pattern
2. **Parallel alert processing** - 50 concurrent alerts
3. **Atomic duplicate prevention** - Database-level checks
4. **Pakistan timezone** - Telegram timestamps
5. **Improved font sizes** - Better readability
6. **Fixed user menu** - Proper positioning
7. **Timeframe-based baseline updates** - Baseline automatically updates every timeframe interval (e.g., every 5 minutes for "5MIN" timeframe), allowing alerts to track relative price changes over time periods

---

**Analysis Complete!** ✅

This project is a **production-ready, scalable cryptocurrency alerts dashboard** with comprehensive real-time features and robust error handling.

