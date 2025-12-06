# 🔄 Complete Alert System Workflow - Detailed Analysis

## 📋 Table of Contents
1. [Alert Creation & Storage](#1-alert-creation--storage)
2. [Worker Initialization](#2-worker-initialization)
3. [Live Data Flow](#3-live-data-flow)
4. [Alert Processing Flow](#4-alert-processing-flow)
5. [Condition Checking](#5-condition-checking)
6. [Alert Triggering](#6-alert-triggering)
7. [Baseline Price Update](#7-baseline-price-update)
8. [Alert Count Condition](#8-alert-count-condition)

---

## 1. Alert Creation & Storage

### Step 1: User Creates Alert (Frontend)
```
User → Create Alert Button → API Call
```

**API Endpoint:** `POST /api/alerts`

### Step 2: API Processes Request
**Location:** `app/api/alerts/route.js`

```javascript
// User sends:
{
  userId: "user123",
  symbol: "BTCUSDT",
  conditions: {
    changePercent: {
      percentage: 5,           // 5% change required
      direction: "increase",   // Price must increase
      timeframe: "5MIN"        // Baseline updates every 5 minutes
    },
    price: {
      value: 50000,
      operator: "above"
    },
    volume: {
      value: 1000000,
      operator: "above"
    },
    rsiRange: {
      min: 70,
      max: 80,
      timeframes: ["1H"],
      period: 14
    },
    alertCount: {
      max: 3,                  // Max 3 alerts
      timeframe: "15MIN"       // Per 15 minutes
    }
  },
  notificationSettings: {
    email: true,
    telegram: true
  }
}
```

### Step 3: Fetch Current Market Data
```javascript
// If baseline not provided, fetch from Binance
GET https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT

Response: {
  lastPrice: "50000.00",
  volume: "1500000.00",
  priceChangePercent: "2.5"
}
```

### Step 4: Save Alert to MongoDB
**Location:** `services/AlertService.js`

```javascript
const alert = new Alert({
  userId: "user123",
  symbol: "BTCUSDT",
  conditions: { ... },
  baselinePrice: 50000.00,      // ✅ Current price from Binance
  baselineVolume: 1500000.00,    // ✅ Current volume
  baselineTimestamp: new Date(), // ✅ Current time
  status: "active"
});

await alert.save(); // ✅ Saved to MongoDB
```

### Step 5: Publish Redis Pub/Sub Event
**Location:** `app/api/alerts/route.js`

```javascript
// Publish event to Redis
redis.publish("alert:management", {
  event: "create",
  alertId: alert._id.toString(),
  symbol: "BTCUSDT",
  userId: "user123"
});
```

### Step 6: Worker Receives Event & Updates Cache
**Location:** `services/RealTimeAlertProcessor.js`
**Method:** `subscribeToAlertManagement() → handleAlertManagementEvent()`

```javascript
// When "create" event received:
await this.addAlert(alertId);
```

**What `addAlert()` does:**

```javascript
async addAlert(alertId) {
  // Step 1: Fetch alert from MongoDB
  const alert = await Alert.findById(alertId).lean();
  
  // Step 2: Check if alert is active
  if (alert.status !== "active") return false;
  
  // Step 3: Check if symbol is in user's favorites
  const userFavorites = await this.getUserFavorites(alert.userId);
  if (!userFavorites.includes(alert.symbol)) return false;
  
  // Step 4: ✅ Add to In-Memory Cache
  const symbol = alert.symbol; // "BTCUSDT"
  if (!this.activeAlerts.has(symbol)) {
    this.activeAlerts.set(symbol, []);
  }
  
  // Check if alert already exists
  const inMemoryAlerts = this.activeAlerts.get(symbol);
  const alertExists = inMemoryAlerts.some(
    a => a._id.toString() === alertId
  );
  
  if (!alertExists) {
    // ✅ Add to In-Memory Cache
    this.activeAlerts.get(symbol).push(alert);
    this.alertIds.add(alertId);
    
    // Step 5: ✅ Add to Redis Cache
    const redis = await this.initRedisClient();
    if (redis) {
      const cacheKey = `alerts:cache:${symbol}`; // "alerts:cache:BTCUSDT"
      const redisAlerts = await this.getAlertsFromCache(symbol);
      
      // Check if alert already exists in Redis
      const existsInRedis = redisAlerts.some(
        a => a._id.toString() === alertId
      );
      
      if (!existsInRedis) {
        // ✅ Add to Redis Cache
        redisAlerts.push(alert);
        await redis.set(cacheKey, JSON.stringify(redisAlerts));
      }
    }
    
    return true;
  }
}
```

**Storage Summary:**
- ✅ **MongoDB:** Alert document saved with all conditions, baseline price, volume, timestamp
- ✅ **In-Memory Cache:** `this.activeAlerts.get("BTCUSDT")` → Array of alerts
- ✅ **Redis Cache:** `alerts:cache:BTCUSDT` → JSON string of alerts array

---

## 2. Worker Initialization

### Step 1: Worker Starts
**Location:** `workers/real-time-alert-worker.js` or `workers/alert-worker.js`

```javascript
async start() {
  // Step 1: Connect to MongoDB
  await connectToMongoDB();
  
  // Step 2: Start WebSocket Processing
  await RealTimeAlertProcessor.startWebSocketProcessing();
  
  // Step 3: Subscribe to Alert Management Events
  await RealTimeAlertProcessor.subscribeToAlertManagement();
}
```

### Step 2: Initialize WebSocket Processing
**Location:** `services/RealTimeAlertProcessor.js`
**Method:** `startWebSocketProcessing()`

```javascript
async startWebSocketProcessing() {
  // Step 1: Initialize Redis clients
  await this.initRedisClient();        // For cache operations
  await this.initDbQueueClient();      // For database queue
  
  // Step 2: Load all alerts from DB and cache in Redis
  await this.loadAlertsToRedisCache();
  
  // Step 3: Start WebSocket connection
  this.startWebSocketPriceFeed();
  
  // Step 4: Subscribe to alert management events
  await this.subscribeToAlertManagement();
  
  // Step 5-8: Setup micro-batch engine, heartbeat, etc.
}
```

### Step 3: Load Alerts to Cache
**Location:** `services/RealTimeAlertProcessor.js`
**Method:** `loadAlertsToRedisCache()`

```javascript
async loadAlertsToRedisCache() {
  // Step 1: Fetch all active alerts from MongoDB
  const alerts = await Alert.find({ status: "active" }).lean();
  
  // Step 2: Filter alerts (only for favorited symbols)
  const validAlerts = [];
  for (const alert of alerts) {
    const userFavorites = await this.getUserFavorites(alert.userId);
    if (userFavorites.includes(alert.symbol)) {
      validAlerts.push(alert);
    }
  }
  
  // Step 3: Group alerts by symbol
  const alertsBySymbol = {};
  validAlerts.forEach(alert => {
    if (!alertsBySymbol[alert.symbol]) {
      alertsBySymbol[alert.symbol] = [];
    }
    alertsBySymbol[alert.symbol].push(alert);
  });
  
  // Step 4: ✅ Cache in Redis (by symbol)
  const redis = await this.initRedisClient();
  for (const [symbol, symbolAlerts] of Object.entries(alertsBySymbol)) {
    const cacheKey = `alerts:cache:${symbol}`;
    await redis.set(cacheKey, JSON.stringify(symbolAlerts));
    
    // Step 5: ✅ Also cache in In-Memory
    this.activeAlerts.set(symbol, symbolAlerts);
    symbolAlerts.forEach(alert => {
      this.alertIds.add(alert._id.toString());
    });
  }
}
```

**Result:**
- ✅ All active alerts loaded from MongoDB
- ✅ Cached in Redis (by symbol)
- ✅ Cached in In-Memory (by symbol)

---

## 3. Live Data Flow

### Step 1: WebSocket Connection
**Location:** `services/RealTimeAlertProcessor.js`
**Method:** `startWebSocketPriceFeed()`

```javascript
startWebSocketPriceFeed() {
  // Connect to Binance WebSocket
  const wsUrl = "wss://stream.binance.com:9443/ws/!ticker@arr";
  this.binanceWebSocket = new WebSocket(wsUrl);
  
  // Listen for messages
  this.binanceWebSocket.on("message", (data) => {
    const tickers = JSON.parse(data.toString());
    // Process tickers...
  });
}
```

**What is `!ticker@arr`?**
- `!` = All symbols
- `ticker` = 24hr ticker data
- `@arr` = Array format
- **Updates:** Every 1 second for ALL symbols

### Step 2: Receive WebSocket Message
```javascript
// Message format (array of all symbols)
[
  {
    "s": "BTCUSDT",        // Symbol
    "c": "50000.00",       // Last price
    "P": "2.5",            // Price change percent
    "v": "1500000.00",     // Volume
    "h": "51000.00",       // High price
    "l": "49000.00",       // Low price
    "o": "49500.00",       // Open price
    ...
  },
  { "s": "ETHUSDT", ... },
  ... (all symbols)
]
```

### Step 3: Filter Symbols with Alerts
```javascript
// Only process symbols that have active alerts
const symbolsWithAlerts = tickers
  .map(t => t.s)
  .filter(symbol => this.activeAlerts.has(symbol));
```

### Step 4: Update Live Prices Cache
```javascript
// For each ticker
tickers.forEach((ticker) => {
  const symbol = ticker.s;
  
  // ✅ Update In-Memory Cache
  this.livePrices[symbol] = {
    symbol: symbol,
    price: parseFloat(ticker.c),
    priceChange: parseFloat(ticker.P),
    priceChangePercent: parseFloat(ticker.P),
    volume: parseFloat(ticker.v),
    volume24h: parseFloat(ticker.v),
    high: parseFloat(ticker.h),
    low: parseFloat(ticker.l),
    open: parseFloat(ticker.o),
    close: parseFloat(ticker.c),
    timestamp: Date.now()
  };
  
  // ✅ Update Redis Cache (non-blocking)
  const priceCacheKey = `crypto:${symbol}`;
  this.redisClient.set(priceCacheKey, JSON.stringify(priceData));
});
```

### Step 5: Process Each Symbol
```javascript
// Process all symbols in parallel
Promise.all(
  symbolsWithAlerts.map(symbol => {
    const liveData = priceUpdates[symbol];
    return this.processPriceUpdateRealTime(symbol, liveData);
  })
);
```

---

## 4. Alert Processing Flow

### Entry Point: `processPriceUpdateRealTime()`
**Location:** `services/RealTimeAlertProcessor.js:584`

```javascript
async processPriceUpdateRealTime(symbol, liveData) {
  // Step 1: Get alerts for this symbol from cache
  let alerts = this.activeAlerts.get(symbol) || [];
  
  // Step 2: Fallback to Redis if in-memory cache is empty
  if (alerts.length === 0) {
    alerts = await this.getAlertsFromCache(symbol);
    if (alerts.length > 0) {
      this.activeAlerts.set(symbol, alerts); // Update in-memory
    }
  }
  
  if (alerts.length === 0) {
    return; // No alerts for this symbol
  }
  
  // Step 3: Process all alerts in parallel
  const alertPromises = alerts.map(alert =>
    this.processLimit(async () => {
      // Use SafeAlertProcessor to prevent race conditions
      const result = await this.safeProcessor.processAlertSafely(
        alert,
        liveData,
        this.processAlertWithLiveData.bind(this)
      );
      return result;
    })
  );
  
  await Promise.all(alertPromises);
}
```

### Next: `processAlertWithLiveData()`
**Location:** `services/RealTimeAlertProcessor.js:808`

```javascript
async processAlertWithLiveData(alert, liveData) {
  // Step 1: Check if baseline needs update (timeframe expiry)
  if (alert.conditions?.changePercent?.timeframe) {
    const timeframe = "5MIN";
    const timeframeMs = 5 * 60 * 1000; // 5 minutes
    const baselineTimestamp = alert.baselineTimestamp.getTime();
    const currentTime = Date.now();
    const timeSinceBaseline = currentTime - baselineTimestamp;
    
    if (timeSinceBaseline >= timeframeMs) {
      // ✅ Update baseline to current live price
      alert.baselinePrice = liveData.price;
      alert.baselineTimestamp = new Date();
      
      // ✅ Update in-memory cache
      const alertsForSymbol = this.activeAlerts.get(alert.symbol);
      const alertIndex = alertsForSymbol.findIndex(
        a => a._id.toString() === alert._id.toString()
      );
      alertsForSymbol[alertIndex].baselinePrice = liveData.price;
      alertsForSymbol[alertIndex].baselineTimestamp = new Date();
      
      // ✅ Update Redis cache
      await this.updateAlertInCache({
        ...alert,
        baselinePrice: liveData.price,
        baselineTimestamp: new Date()
      });
      
      // ✅ Update database (non-blocking)
      Alert.findByIdAndUpdate(alert._id, {
        baselinePrice: liveData.price,
        baselineTimestamp: new Date()
      });
    }
  }
  
  // Step 2: Check if alert is locked (AlertCount condition)
  if (isAlertLocked(alert)) {
    return { triggered: false, reason: "alert_locked" };
  }
  
  // Step 3: Check price direction
  const direction = alert.conditions?.changePercent?.direction || "increase";
  
  if (direction === "increase" && liveData.price <= alert.baselinePrice) {
    return { triggered: false, reason: "price_not_increased" };
  }
  
  if (direction === "decrease" && liveData.price >= alert.baselinePrice) {
    return { triggered: false, reason: "price_not_decreased" };
  }
  
  // Step 4: Check all conditions
  const conditionsMet = await this.checkAlertConditionsWithLiveData(
    alert,
    liveData
  );
  
  if (conditionsMet) {
    // Step 5: Trigger alert
    await this.triggerAlertWithLiveData(alert, liveData);
    return { triggered: true, reason: "conditions_met" };
  } else {
    return { triggered: false, reason: "conditions_not_met" };
  }
}
```

---

## 5. Condition Checking

### Entry Point: `checkAlertConditionsWithLiveData()`
**Location:** `services/RealTimeAlertProcessor.js:934`

```javascript
async checkAlertConditionsWithLiveData(alert, liveData) {
  const conditions = alert.conditions;
  
  // Step 1: Get only active conditions (priority order)
  const activeConditions = this.getActiveConditions(conditions, liveData, alert);
  
  if (activeConditions.length === 0) {
    return false; // No conditions set
  }
  
  // Step 2: Check all conditions in PARALLEL
  const conditionResults = await Promise.all(
    activeConditions.map(async (conditionCheck) => {
      return await conditionCheck.check();
    })
  );
  
  // Step 3: All conditions must pass
  for (let i = 0; i < conditionResults.length; i++) {
    const result = conditionResults[i];
    if (!result.passed) {
      return false; // Early exit if any condition fails
    }
  }
  
  return true; // All conditions passed
}
```

### Condition Types & How They're Checked:

#### 1. Change Percent Condition
```javascript
// Priority: 2
check: async () => {
  const requiredChange = 5; // 5%
  const direction = "increase";
  
  // Calculate change from baseline
  const baselinePrice = alert.baselinePrice; // 50000
  const currentPrice = liveData.price;       // 52500
  const changeFromBaseline = currentPrice - baselinePrice; // 2500
  const changePercent = (changeFromBaseline / baselinePrice) * 100; // 5%
  
  // Check direction
  if (direction === "increase" && changeFromBaseline < 0) {
    return { passed: false, reason: "Price decreased but increase required" };
  }
  
  // Check percentage
  if (changePercent < requiredChange) {
    return { passed: false, reason: "5% < 5%" };
  }
  
  return { passed: true, reason: "5% >= 5% (increase)" };
}
```

#### 2. Price Condition
```javascript
// Priority: 2
check: async () => {
  const targetPrice = 50000;
  const operator = "above";
  const currentPrice = liveData.price;
  
  if (operator === "above" && currentPrice <= targetPrice) {
    return { passed: false, reason: "Price not above target" };
  }
  
  return { passed: true, reason: "Price above target" };
}
```

#### 3. Volume Condition
```javascript
// Priority: 6
check: async () => {
  const requiredVolume = 1000000;
  const currentVolume = liveData.volume || liveData.volume24h;
  
  if (currentVolume < requiredVolume) {
    return { passed: false, reason: "Volume too low" };
  }
  
  return { passed: true, reason: "Volume sufficient" };
}
```

#### 4. RSI Condition (with Multi-Layer Cache)
```javascript
// Priority: 5
check: async () => {
  const symbol = alert.symbol;
  const timeframe = "1H";
  const period = 14;
  const minRSI = 70;
  const maxRSI = 80;
  
  // Step 1: Check In-Memory Cache (0.1ms)
  const memoryKey = `${symbol}_${timeframe}_${period}`;
  let rsi = this.rsiData.get(memoryKey);
  
  if (rsi && (Date.now() - rsi.timestamp) < 60000) {
    // Cache hit - use cached value
    return rsi.current >= minRSI && rsi.current <= maxRSI;
  }
  
  // Step 2: Check Redis Cache (5-20ms)
  const redisKey = `rsi:${symbol}_${timeframe}_${period}`;
  const cachedRSI = await redis.get(redisKey);
  
  if (cachedRSI) {
    const rsiData = JSON.parse(cachedRSI);
    this.rsiData.set(memoryKey, rsiData); // Update in-memory
    return rsiData.current >= minRSI && rsiData.current <= maxRSI;
  }
  
  // Step 3: Calculate RSI (background - non-blocking)
  const rsiValue = await this.calculateRSI(symbol, timeframe, period);
  
  // Update both caches
  this.rsiData.set(memoryKey, { current: rsiValue, timestamp: Date.now() });
  await redis.set(redisKey, JSON.stringify({ current: rsiValue, timestamp: Date.now() }), "EX", 60);
  
  return rsiValue >= minRSI && rsiValue <= maxRSI;
}
```

#### 5. Alert Count Condition
```javascript
// Priority: 3
check: async () => {
  // Check if alert is locked (already triggered in this timeframe)
  if (isAlertLocked(alert)) {
    const lockUntil = alert.conditions.alertCount.lockUntil;
    const timeRemaining = lockUntil.getTime() - Date.now();
    return {
      passed: false,
      reason: `Alert locked for ${Math.ceil(timeRemaining / 60000)} minutes`
    };
  }
  
  // If not locked, condition passes (lock will be set after trigger)
  return { passed: true, reason: "Alert count condition met" };
}
```

---

## 6. Alert Triggering

### Entry Point: `triggerAlertWithLiveData()`
**Location:** `services/RealTimeAlertProcessor.js:1252`

```javascript
async triggerAlertWithLiveData(alert, liveData) {
  // Step 1: Acquire Redis Lock (prevent duplicate processing)
  const hasAlertCount = alert.conditions?.alertCount?.timeframe;
  const lockToken = hasAlertCount
    ? await this.acquireAlertLock(alert._id.toString(), 3000) // 3s lock
    : await this.acquireAlertLock(alert._id.toString(), 2000); // 2s lock
  
  if (!lockToken) {
    return false; // Another worker is processing
  }
  
  try {
    // Step 2: Get baseline values
    const baselinePrice = alert.baselinePrice; // 50000
    const livePrice = liveData.price;          // 52500
    
    // Step 3: Calculate change from baseline
    const changeFromBaseline = livePrice - baselinePrice; // 2500
    const changeFromBaselinePercent = (changeFromBaseline / baselinePrice) * 100; // 5%
    
    // Step 4: Create AlertHistory (BLOCKING - needed for notifications)
    const alertHistory = {
      alertId: alert._id,
      userId: alert.userId,
      symbol: alert.symbol,
      alertConditions: alert.conditions,
      triggerData: {
        price: livePrice,
        priceChange: liveData.priceChange,
        priceChangePercent: liveData.priceChangePercent,
        volume: liveData.volume,
        ...
      },
      baselineData: {
        baselinePrice: baselinePrice,
        changeFromBaseline: changeFromBaseline,
        changeFromBaselinePercent: changeFromBaselinePercent,
        ...
      },
      triggeredAt: new Date()
    };
    
    // ✅ Save AlertHistory to MongoDB (BLOCKING - 10-50ms)
    const savedAlertHistory = await AlertHistoryService.createAlertHistory(alertHistory);
    
    // Step 5: Update alert lock (if AlertCount condition exists)
    const updateData = {
      lastTriggeredAt: new Date(),
      lastTriggeredPrice: livePrice,
      baselinePrice: livePrice,        // ✅ Update baseline to current price
      baselineVolume: liveData.volume,
      baselineTimestamp: new Date()
    };
    
    if (alert.conditions.alertCount?.timeframe) {
      const updatedConditions = updateAlertLock(alert);
      updateData.conditions = updatedConditions;
      // Sets lockUntil to end of current candle period
    }
    
    // Step 6: ✅ Update database (BLOCKING - immediate update)
    await Alert.findByIdAndUpdate(alert._id, updateData);
    
    // Step 7: ✅ Update In-Memory Cache
    const alertsForSymbol = this.activeAlerts.get(alert.symbol);
    const alertIndex = alertsForSymbol.findIndex(
      a => a._id.toString() === alert._id.toString()
    );
    alertsForSymbol[alertIndex] = {
      ...alertsForSymbol[alertIndex],
      ...updateData,
      baselinePrice: livePrice,        // ✅ New baseline
      baselineTimestamp: new Date()
    };
    
    // Step 8: ✅ Update Redis Cache
    this.updateAlertInCache({
      ...alert,
      ...updateData,
      baselinePrice: livePrice,        // ✅ New baseline
      baselineTimestamp: new Date()
    });
    
    // Step 9: ✅ Update Price Cache
    const priceCacheKey = `crypto:${alert.symbol}`;
    await redis.set(priceCacheKey, JSON.stringify(liveData));
    
    // Step 10: Send Notifications (NON-BLOCKING)
    this.sendRealTimeNotification(alert, liveData, savedAlertHistory);
    
    return true;
  } finally {
    // Step 11: Release Lock
    await this.releaseAlertLock(alert._id.toString(), lockToken);
  }
}
```

---

## 7. Baseline Price Update

### When Baseline Updates:

#### 1. On Alert Trigger
```javascript
// After alert triggers:
baselinePrice: livePrice        // ✅ Updated to current price
baselineTimestamp: new Date()    // ✅ Updated to current time
```

**Updated in:**
- ✅ MongoDB (immediate - blocking)
- ✅ In-Memory Cache (immediate)
- ✅ Redis Cache (immediate)

**Why?** So alert doesn't trigger again on same price.

#### 2. On Timeframe Expiry
```javascript
// If timeframe interval has passed:
if (timeSinceBaseline >= timeframeMs) {
  baselinePrice: liveData.price        // ✅ Updated to current price
  baselineTimestamp: new Date()       // ✅ Updated to current time
}
```

**Updated in:**
- ✅ In-Memory Cache (immediate)
- ✅ Redis Cache (immediate)
- ✅ MongoDB (non-blocking)

**Why?** So baseline resets after timeframe interval (e.g., every 5 minutes).

### Example Flow:

```
Alert Created:
  baselinePrice: 50000
  baselineTimestamp: 10:00:00

Price Moves to 52500 (5% increase):
  ✅ Alert triggers
  ✅ baselinePrice updated to 52500
  ✅ baselineTimestamp updated to 10:01:00

Price Moves to 53000 (but only 0.95% from new baseline):
  ❌ Alert doesn't trigger (less than 5% from new baseline)

5 Minutes Pass (timeframe expiry):
  ✅ baselinePrice updated to current price (53000)
  ✅ baselineTimestamp updated to 10:06:00

Price Moves to 55650 (5% from new baseline):
  ✅ Alert triggers again
```

---

## 8. Alert Count Condition

### How It Works:

#### Step 1: Check Lock Status
```javascript
// Before checking conditions
if (isAlertLocked(alert)) {
  return { triggered: false, reason: "alert_locked" };
}
```

#### Step 2: Calculate Lock Time
**Location:** `utils/alertLock.js`

```javascript
function calculateLockTime(timeframe, triggerTime) {
  // Example: 15MIN timeframe, triggered at 1:02
  // Current 15-min candle started at 1:00
  // Lock until 1:15 (end of current candle)
  
  const timeframeMs = 15 * 60 * 1000; // 15 minutes
  const candleStart = alignToCandleStart(triggerTime, timeframe);
  const lockUntil = new Date(candleStart.getTime() + timeframeMs);
  
  return lockUntil; // 1:15
}
```

#### Step 3: Set Lock After Trigger
```javascript
// After alert triggers
if (alert.conditions.alertCount?.timeframe) {
  const updatedConditions = updateAlertLock(alert);
  // Sets:
  // conditions.alertCount.lockUntil = end of current candle
  // conditions.alertCount.lastTriggered = current time
}
```

#### Step 4: Lock Prevents Duplicate Triggers
```javascript
// On next price update
if (isAlertLocked(alert)) {
  // Check: current time < lockUntil
  if (Date.now() < lockUntil.getTime()) {
    return { triggered: false, reason: "alert_locked" };
  }
}
```

### Example Flow:

```
Alert with AlertCount: max 3, timeframe 15MIN

10:00:00 - Alert triggers (1st time)
  ✅ Lock until 10:15:00

10:01:00 - Price moves again
  ❌ Alert locked (until 10:15:00)

10:05:00 - Price moves again
  ❌ Alert locked (until 10:15:00)

10:15:00 - Lock expires
  ✅ Alert can trigger again

10:16:00 - Alert triggers (2nd time)
  ✅ Lock until 10:30:00

10:20:00 - Alert triggers (3rd time)
  ✅ Lock until 10:35:00

10:25:00 - Price moves again
  ❌ Alert locked (max 3 reached in 15MIN window)
```

---

## 🔄 Complete Workflow Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    ALERT CREATION                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
        User Creates Alert → API → MongoDB Save
                          ↓
        Redis Pub/Sub Event → Worker
                          ↓
        addAlert() → In-Memory + Redis Cache
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                 WORKER INITIALIZATION                         │
└─────────────────────────────────────────────────────────────┘
                          ↓
        Worker Starts → startWebSocketProcessing()
                          ↓
        Load Alerts from DB → Cache in Redis + In-Memory
                          ↓
        Connect to Binance WebSocket (!ticker@arr)
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                    LIVE DATA FLOW                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
        WebSocket Message (all symbols) → Every 1 second
                          ↓
        Filter Symbols with Alerts
                          ↓
        Update Live Prices Cache (In-Memory + Redis)
                          ↓
        Process Each Symbol → processPriceUpdateRealTime()
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                  ALERT PROCESSING                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
        Get Alerts from Cache (In-Memory → Redis)
                          ↓
        Process Each Alert → processAlertWithLiveData()
                          ↓
        Check Baseline Update (Timeframe Expiry)
                          ↓
        Check Alert Lock (AlertCount)
                          ↓
        Check Price Direction
                          ↓
        Check All Conditions (Parallel):
          - Change Percent (calculate percentage)
          - Price
          - Volume
          - RSI (with cache)
          - Open Interest
          - Alert Count
                          ↓
        All Conditions Pass? → YES
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                  ALERT TRIGGERING                             │
└─────────────────────────────────────────────────────────────┘
                          ↓
        Acquire Redis Lock (prevent duplicate)
                          ↓
        Save AlertHistory (BLOCKING - for notifications)
                          ↓
        Update Alert Lock (if AlertCount)
                          ↓
        Update Baseline Price:
          - MongoDB (BLOCKING)
          - In-Memory Cache (immediate)
          - Redis Cache (immediate)
                          ↓
        Update Price Cache
                          ↓
        Send Notifications (NON-BLOCKING)
                          ↓
        Release Redis Lock
```

---

## 📊 Data Flow Diagram

```
┌──────────────┐
│   MongoDB    │ ← Alert created/updated
└──────┬───────┘
       │
       ↓
┌──────────────┐
│ Redis Cache  │ ← Cached by symbol
└──────┬───────┘
       │
       ↓
┌──────────────┐
│In-Memory Map │ ← Fastest access
└──────┬───────┘
       │
       ↓
┌──────────────┐
│  WebSocket   │ ← Live prices (every 1s)
└──────┬───────┘
       │
       ↓
┌──────────────┐
│  Worker      │ ← Processes alerts
└──────┬───────┘
       │
       ↓
┌──────────────┐
│  Conditions  │ ← Check all conditions
└──────┬───────┘
       │
       ↓
┌──────────────┐
│   Trigger    │ ← Alert triggers
└──────┬───────┘
       │
       ↓
┌──────────────┐
│  Baseline    │ ← Updated everywhere
│   Update     │
└──────────────┘
```

---

## ✅ Key Points

1. **Alert Creation:**
   - Saved to MongoDB with baseline price
   - Cached in Redis (by symbol)
   - Cached in In-Memory (by symbol)

2. **Worker Processing:**
   - WebSocket receives live prices every 1 second
   - Only processes symbols with alerts
   - Processes all alerts in parallel

3. **Condition Checking:**
   - Baseline price from cache (not live price)
   - Percentage calculated: `(livePrice - baselinePrice) / baselinePrice * 100`
   - All conditions checked in parallel
   - RSI uses multi-layer cache

4. **Alert Triggering:**
   - Redis lock prevents duplicates
   - AlertHistory saved (blocking)
   - Baseline price updated everywhere (MongoDB, Redis, In-Memory)
   - Notifications sent (non-blocking)

5. **Baseline Update:**
   - Updated on alert trigger (to prevent duplicate)
   - Updated on timeframe expiry (to reset baseline)

6. **Alert Count:**
   - Lock set after trigger
   - Lock until end of candle period
   - Prevents duplicate triggers in same timeframe

---

**End of Complete System Workflow** 🎉

