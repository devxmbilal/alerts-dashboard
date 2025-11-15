# 📊 Complete Project Analysis: Crypto Alerts Dashboard

## 🎯 Project Overview

**Crypto Alerts Dashboard** is a full-stack MERN (MongoDB, Express, React, Next.js) application for real-time cryptocurrency price monitoring and alerting. The system tracks cryptocurrency prices from Binance, allows users to create complex alert conditions, and sends notifications via Email and Telegram when conditions are met.

---

## 🏗️ Architecture Overview

### **Technology Stack**

#### **Frontend**
- **Framework**: Next.js 15.5.4 (App Router)
- **UI Library**: Material-UI (MUI) v5.15.0
- **State Management**: React Context API
- **Real-time Communication**: Server-Sent Events (SSE)
- **Charts**: Lightweight Charts v5.0.9, TradingView integration
- **Styling**: Tailwind CSS v4, Custom CSS

#### **Backend**
- **Runtime**: Node.js (ES Modules)
- **API Framework**: Next.js API Routes
- **Database**: MongoDB (Mongoose ODM)
- **Cache**: Redis (ioredis v5.8.0, redis v5.8.3)
- **Authentication**: JWT (jsonwebtoken)
- **Password Hashing**: bcryptjs

#### **Services & Workers**
- **Market Data**: Binance WebSocket API
- **Notifications**: 
  - Email (Nodemailer)
  - Telegram Bot API
- **Chart Screenshots**: Puppeteer v24.29.0
- **Process Management**: PM2 v6.0.13

---

## 📁 Project Structure

```
alerts-dashboard/
├── app/                          # Next.js App Router
│   ├── api/                      # API Routes
│   │   ├── alerts/               # Alert management endpoints
│   │   ├── auth/                 # Authentication endpoints
│   │   ├── favorites/            # Favorites management
│   │   ├── market/               # Market data endpoints
│   │   ├── notifications/       # Notification endpoints
│   │   └── user/                 # User settings
│   ├── dashboard/                # Main dashboard page
│   ├── login/                    # Login page
│   ├── layout.js                 # Root layout
│   └── page.js                   # Home/redirect page
│
├── components/                   # React Components
│   ├── AlertHistory.js           # Alert history display
│   ├── CandlestickChart.js       # Chart component
│   ├── FilterSidebar.js          # Alert creation UI
│   ├── LineChart.js              # Line chart component
│   ├── MarketPanel.js            # Market list component
│   ├── RealTimeNotifications.js  # Notification panel
│   ├── TradingViewChart.js       # TradingView integration
│   └── UserSettingsModal.js      # User settings UI
│
├── contexts/                     # React Context Providers
│   ├── AlertContext.js           # Alert state management
│   ├── FavoritesContext.js       # Favorites state
│   └── SocketContext.js           # WebSocket/SSE state
│
├── models/                       # MongoDB Models
│   ├── Alert.js                  # Alert schema
│   ├── AlertHistory.js           # Alert history schema
│   └── User.js                   # User schema
│
├── services/                     # Business Logic Services
│   ├── AlertHistoryService.js   # Alert history operations
│   ├── AlertRedisService.js      # Redis alert operations
│   ├── AlertService.js           # Alert CRUD operations
│   ├── EmailService.js           # Email notifications
│   ├── NotificationService.js    # Notification management
│   ├── RealTimeAlertProcessor.js # Core alert processing engine
│   ├── TelegramService.js        # Telegram notifications
│   ├── UserService.js            # User operations
│   └── WebSocketService.js       # WebSocket management
│
├── workers/                      # Background Workers
│   ├── alert-worker.js           # Alert processing worker
│   ├── binance-worker.js         # Binance data fetcher
│   ├── cleanup-worker.js         # Data cleanup worker
│   └── real-time-alert-worker.js # Real-time alert processor
│
├── utils/                        # Utility Functions
│   ├── alertLock.js              # Alert locking mechanism
│   ├── auth.js                  # Authentication helpers
│   ├── chartScreenshot.js        # Chart screenshot service
│   ├── mongodb.js                # MongoDB connection
│   └── redis.js                  # Redis connection & cache
│
├── scripts/                      # Utility Scripts
│   ├── seed-users.js            # User seeding
│   ├── setup-database.js         # Database setup
│   └── test-*.js                 # Test scripts
│
└── public/                       # Static Assets
    └── notification-worker.js    # Client-side worker
```

---

## 🔑 Core Features

### **1. User Authentication & Management**
- JWT-based authentication
- User registration and login
- Password hashing with bcryptjs
- User settings management
- Session management via localStorage

**Key Files:**
- `app/api/auth/login/route.js`
- `app/api/auth/register/route.js`
- `app/api/auth/me/route.js`
- `models/User.js`
- `utils/auth.js`

### **2. Real-Time Market Data**
- Binance WebSocket integration
- Server-Sent Events (SSE) for client updates
- Redis caching for market data
- Support for all USDT spot pairs
- Real-time price updates

**Key Files:**
- `workers/binance-worker.js`
- `app/api/market/stream/route.js`
- `contexts/SocketContext.js`
- `services/WebSocketService.js`

### **3. Alert System**

#### **Alert Types Supported:**
1. **Price Change Alerts**
   - Percentage change over timeframes (1m, 5m, 15m, 1h, 4h, 1d)
   - Direction: increase, decrease, or both
   - Baseline price tracking

2. **Volume Alerts**
   - Volume increase/decrease detection
   - Percentage-based volume changes
   - Multi-timeframe support

3. **RSI (Relative Strength Index) Alerts**
   - RSI level thresholds (default: 70)
   - Above/below conditions
   - Customizable period (default: 14)

4. **Candle Pattern Alerts**
   - Candle above/below open price
   - Multi-timeframe analysis

5. **Open Interest Alerts**
   - Open interest direction tracking
   - Percentage-based changes
   - Increasing/decreasing detection

6. **Alert Count Management**
   - Lock periods to prevent spam
   - Timeframe-based triggering limits

**Key Files:**
- `services/RealTimeAlertProcessor.js` (3,354 lines - core engine)
- `models/Alert.js`
- `app/api/alerts/route.js`
- `components/FilterSidebar.js`

### **4. Notification System**

#### **Notification Channels:**
- **Email**: Via Nodemailer
- **Telegram**: Bot API integration with chart screenshots
- **Webhook**: Support for custom webhooks
- **In-App**: Real-time notifications via SSE

**Features:**
- Chart screenshots attached to Telegram alerts
- Rich notification formatting
- Notification history tracking
- Read/unread status

**Key Files:**
- `services/NotificationService.js`
- `services/EmailService.js`
- `services/TelegramService.js`
- `utils/chartScreenshot.js`
- `app/api/notifications/route.js`

### **5. Alert History**
- Complete trigger history
- Baseline vs. triggered price comparison
- Notification delivery tracking
- Status management (triggered, acknowledged, dismissed)

**Key Files:**
- `models/AlertHistory.js`
- `services/AlertHistoryService.js`
- `components/AlertHistory.js`

### **6. Favorites System**
- User-specific favorite trading pairs
- Redis caching for fast access
- Bulk operations support
- Integration with alert system

**Key Files:**
- `app/api/favorites/route.js`
- `contexts/FavoritesContext.js`
- `utils/redis.js` (FavoritesCache)

### **7. Dashboard UI**

#### **Layout:**
- **Desktop**: 3-column layout (Filters | Chart | Market)
- **Mobile**: Bottom navigation with drawer menu
- **Responsive**: Adaptive layouts for all screen sizes

#### **Components:**
- **TradingViewChart**: Interactive price charts
- **MarketPanel**: Real-time market list with search/filter
- **FilterSidebar**: Advanced alert creation UI
- **RealTimeNotifications**: Live notification panel
- **UserSettingsModal**: User preferences

**Key Files:**
- `app/dashboard/page.js`
- `components/TradingViewChart.js`
- `components/MarketPanel.js`
- `components/FilterSidebar.js`

---

## 🔄 Data Flow

### **1. Market Data Flow**
```
Binance API → binance-worker.js → Redis → SSE Stream → Frontend
```

1. `binance-worker.js` connects to Binance WebSocket
2. Receives real-time price updates
3. Stores in Redis with symbol as key
4. SSE endpoint streams to connected clients
5. Frontend updates via SocketContext

### **2. Alert Processing Flow**
```
User Creates Alert → MongoDB → RealTimeAlertProcessor → 
Check Conditions → Trigger Alert → Notifications → AlertHistory
```

1. User creates alert via FilterSidebar
2. Alert saved to MongoDB
3. `RealTimeAlertProcessor` loads active alerts
4. Processes alerts every 30 seconds (round-based)
5. Checks all conditions against live data
6. On trigger: creates AlertHistory, sends notifications
7. Updates alert status

### **3. Notification Flow**
```
Alert Triggered → NotificationService → 
Email/Telegram/Webhook → User Receives Notification
```

1. Alert processor detects trigger
2. NotificationService coordinates delivery
3. EmailService sends email
4. TelegramService sends message with chart screenshot
5. WebhookService calls custom endpoints
6. In-app notification via SSE

---

## 🗄️ Database Schema

### **User Model**
```javascript
{
  username: String (unique, required)
  password: String (hashed, required)
  name: String (required)
  email: String (unique, required)
  favorites: [String] (array of symbols)
  telegramChatId: String
  notificationPreferences: {
    email: Boolean
    telegram: Boolean
  }
  isActive: Boolean
  lastLogin: Date
}
```

### **Alert Model**
```javascript
{
  symbol: String (indexed, required)
  userId: String (indexed, required)
  conditions: {
    minDaily: String (required)
    changePercent: {
      timeframe: String (required)
      percentage: String (required)
      direction: "increase" | "decrease" | "both"
    }
    alertCount: {
      timeframe: String
      lockUntil: Date
      lastTriggered: Date
    }
    candle: {
      timeframes: [String]
      condition: String
    }
    rsiRange: {
      timeframes: [String]
      period: String
      level: String
      condition: String
    }
    volume: {
      timeframes: [String]
      condition: String
      percentage: String
    }
    openInterest: {
      timeframes: [String]
      direction: String
      percentage: String
    }
  }
  status: "active" | "paused" | "triggered" | "expired"
  baselinePrice: Number (required)
  baselineVolume: Number
  baselineOpenInterest: Number
  baselineTimestamp: Date
  lastTriggeredAt: Date
  lastTriggeredPrice: Number
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
  alertId: ObjectId (ref: Alert, indexed)
  userId: String (indexed, required)
  symbol: String (indexed, required)
  alertConditions: Object (snapshot of alert conditions)
  conditions: String (human-readable)
  triggerData: {
    price: Number
    priceChange: Number
    priceChangePercent: Number
    volume24h: Number
    high: Number
    low: Number
    open: Number
    close: Number
    timestamp: Number
  }
  baselineData: {
    baselinePrice: Number
    baselineVolume: Number
    baselineTimestamp: Date
    changeFromBaseline: Number
    changeFromBaselinePercent: Number
  }
  triggeredAt: Date (indexed)
  notificationSent: {
    email: Boolean
    telegram: Boolean
    webhook: Boolean
  }
  status: "triggered" | "acknowledged" | "dismissed"
}
```

---

## 🔧 Key Services & Workers

### **RealTimeAlertProcessor** (Core Engine)
- **Location**: `services/RealTimeAlertProcessor.js`
- **Size**: 3,354 lines
- **Purpose**: Main alert processing engine

**Key Features:**
- Round-based processing (every 30 seconds)
- Parallel alert processing (concurrency limit: 50)
- Baseline price tracking and updates
- Multi-condition evaluation
- RSI calculation and tracking
- Open Interest tracking
- Candle pattern analysis
- Alert locking to prevent duplicates
- Integration with notification services

**Processing Flow:**
1. Load all active alerts from MongoDB
2. Filter alerts for valid favorite pairs
3. Fetch current live prices from Redis
4. Process each alert in parallel
5. Check all conditions
6. Trigger alerts when conditions met
7. Create alert history records
8. Send notifications

### **Binance Worker**
- **Location**: `workers/binance-worker.js`
- **Purpose**: Fetch and cache market data

**Features:**
- WebSocket connection to Binance
- Fallback API endpoints for reliability
- Retry logic with exponential backoff
- Redis caching
- Handles connection errors gracefully

### **Alert Worker**
- **Location**: `workers/alert-worker.js`
- **Purpose**: Background alert processing

### **Cleanup Worker**
- **Location**: `workers/cleanup-worker.js`
- **Purpose**: Data cleanup and maintenance

---

## 🔐 Security Features

1. **Authentication**
   - JWT tokens for API authentication
   - Password hashing with bcryptjs (salt rounds: 10)
   - Token expiration handling

2. **Data Validation**
   - Input validation on API routes
   - MongoDB schema validation
   - Type checking

3. **Error Handling**
   - Try-catch blocks throughout
   - Graceful error responses
   - Logging for debugging

4. **Rate Limiting**
   - Alert locking mechanism
   - Timeframe-based triggering limits
   - Concurrency limits on processing

---

## 📊 Performance Optimizations

1. **Caching**
   - Redis for market data
   - Redis for user favorites
   - Redis for alert caching
   - 1-hour TTL on cache entries

2. **Database Indexing**
   - Indexed fields: symbol, userId, status, createdAt
   - Compound indexes for common queries
   - AlertHistory indexes for efficient lookups

3. **Parallel Processing**
   - Alert processing with p-limit (50 concurrent)
   - Promise.all for batch operations
   - Non-blocking I/O operations

4. **Connection Pooling**
   - MongoDB connection reuse
   - Redis connection management
   - WebSocket connection pooling

---

## 🚀 Deployment

### **PM2 Configuration**
- **File**: `ecosystem.config.cjs`
- **Processes**:
  1. `alerts-dashboard`: Next.js app (port 3000)
  2. `binance-worker`: Market data worker
  3. `alert-worker`: Alert processing worker
  4. `cleanup-worker`: Cleanup worker

### **Environment Variables Required**
```env
MONGODB_URI=mongodb://...
REDIS_URL=redis://...
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
EMAIL_HOST=...
EMAIL_USER=...
EMAIL_PASS=...
NODE_ENV=production
```

### **Start Scripts**
- `npm run dev`: Development server
- `npm run build`: Production build
- `npm run start`: Production server
- `npm run start-all`: Start all workers
- `npm run worker`: Start binance worker
- `npm run alert-worker`: Start alert worker
- `npm run real-time-worker`: Start real-time processor

---

## 📈 Scalability Considerations

### **Current Architecture**
- Single-instance processing
- Round-based alert checking (30s intervals)
- Redis for caching
- MongoDB for persistence

### **Potential Improvements**
1. **Horizontal Scaling**
   - Multiple alert processor instances
   - Distributed locking (Redis-based)
   - Load balancing for API routes

2. **Performance**
   - Database sharding for large user bases
   - Redis cluster for high availability
   - CDN for static assets

3. **Monitoring**
   - Application performance monitoring
   - Error tracking (Sentry, etc.)
   - Metrics collection (Prometheus, etc.)

---

## 🐛 Known Issues & Areas for Improvement

1. **RealTimeAlertProcessor.js**
   - Large file (3,354 lines) - could be split into modules
   - Complex condition evaluation logic
   - Could benefit from unit tests

2. **Error Handling**
   - Some error cases may not be fully handled
   - Could add more comprehensive logging

3. **Testing**
   - Limited test coverage
   - No automated test suite visible

4. **Documentation**
   - Some inline documentation
   - Could benefit from API documentation (Swagger/OpenAPI)

5. **Type Safety**
   - JavaScript (not TypeScript)
   - Could benefit from type checking

---

## 🎯 Use Cases

1. **Crypto Traders**
   - Monitor price movements
   - Get alerts on significant changes
   - Track multiple trading pairs

2. **Portfolio Managers**
   - Set alerts for portfolio assets
   - Monitor market conditions
   - Receive notifications on key events

3. **Algorithmic Traders**
   - Integrate via webhooks
   - Custom alert conditions
   - Automated trading triggers

---

## 📝 Summary

This is a **sophisticated, production-ready cryptocurrency alerting system** with:

✅ **Full-stack MERN architecture**
✅ **Real-time market data integration**
✅ **Complex multi-condition alert system**
✅ **Multiple notification channels**
✅ **Scalable worker architecture**
✅ **Modern React/Next.js frontend**
✅ **Comprehensive data models**
✅ **Redis caching for performance**
✅ **PM2 process management**
✅ **Responsive UI design**

The system is well-structured with clear separation of concerns, comprehensive features, and production-ready deployment configuration. The core alert processing engine (`RealTimeAlertProcessor.js`) is particularly sophisticated, handling complex condition evaluation and multi-timeframe analysis.

---

**Analysis Date**: 2024
**Project Version**: 0.1.0
**Lines of Code**: ~15,000+ (estimated)

