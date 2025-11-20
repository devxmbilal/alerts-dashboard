# 🚨 Alert System - Complete Flow Documentation

## 📋 Table of Contents
1. [Alert Creation Flow](#1-alert-creation-flow)
2. [Caching System](#2-caching-system)
3. [Live Data Processing](#3-live-data-processing)
4. [Condition Matching](#4-condition-matching)
5. [Alert Triggering](#5-alert-triggering)
6. [Alert Deletion](#6-alert-deletion)

---

## 1. Alert Creation Flow

### Step 1: User Creates Alert (Frontend)
```
User → Create Alert Button → API Call
```

**Location:** `app/api/alerts/route.js` (POST method)

### Step 2: API Receives Request
```javascript
POST /api/alerts
Body: {
  userId: "user123",
  symbol: "BTCUSDT",
  conditions: {
    changePercent: { value: 5, direction: "increase", timeframe: "5MIN" },
    price: { value: 50000, operator: "above" },
    volume: { value: 1000000, operator: "above" },
    rsi: { value: 70, operator: "above", timeframe: "1H", period: 14 },
    alertCount: { max: 3, timeframe: "15MIN" }
  },
  notificationSettings: { email: true, telegram: true }
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

### Step 4: Create Alert in Database
```javascript
// Location: services/AlertService.js
const alert = new Alert({
  userId: "user123",
  symbol: "BTCUSDT",
  conditions: { ... },
  baselinePrice: 50000.00,      // Current price
  baselineVolume: 1500000.00,    // Current volume
  baselineTimestamp: new Date(), // Current time
  status: "active"
});

await alert.save(); // MongoDB save
```

### Step 5: Publish Alert Creation Event
```javascript
// Redis Pub/Sub event
redis.publish("alert:management", {
  event: "create",
  alertId: alert._id,
  symbol: "BTCUSDT",
  userId: "user123"
});
```

### Step 6: Add Alert to Cache (Real-Time)
```javascript
// Location: services/RealTimeAlertProcessor.js
// Method: subscribeToAlertManagement() → handleAlertManagementEvent()

// When "create" event received:
await this.addAlert(alertId);
```

**What happens in `addAlert()`:**
1. ✅ Fetch alert from MongoDB
2. ✅ Check if alert is active
3. ✅ Check if symbol is in user's favorites
4. ✅ Add to **In-Memory Cache** (`this.activeAlerts`)
5. ✅ Add to **Redis Cache** (`alerts:cache:BTCUSDT`)
6. ✅ Add alertId to tracking set

**Cache Structure:**
```javascript
// In-Memory Cache (Map)
this.activeAlerts = Map {
  "BTCUSDT" => [
    { _id: "alert123", symbol: "BTCUSDT", conditions: {...}, baselinePrice: 50000, ... },
    { _id: "alert456", symbol: "BTCUSDT", conditions: {...}, baselinePrice: 50000, ... }
  ],
  "ETHUSDT" => [...]
}

// Redis Cache
Key: "alerts:cache:BTCUSDT"
Value: JSON.stringify([alert1, alert2, ...])
```

---

## 2. Caching System

### Multi-Layer Cache Architecture

```
┌─────────────────────────────────────┐
│   Layer 1: In-Memory Cache (Map)    │  ← Fastest (0.1ms)
│   this.activeAlerts.get(symbol)     │
└─────────────────────────────────────┘
           ↓ (if empty)
┌─────────────────────────────────────┐
│   Layer 2: Redis Cache              │  ← Fast (5-20ms)
│   alerts:cache:{symbol}             │
└─────────────────────────────────────┘
           ↓ (if empty)
┌─────────────────────────────────────┐
│   Layer 3: MongoDB Database         │  ← Slow (50-200ms)
│   Alert.find({ symbol, status })    │
└─────────────────────────────────────┘
```

### Cache Keys:

| Cache Type | Key Format | TTL | Purpose |
|------------|-----------|-----|---------|
| **Alerts Cache** | `alerts:cache:{symbol}` | ❌ None | Store alerts per symbol |
| **Price Cache** | `crypto:{symbol}` | ❌ None | Store live prices |
| **RSI Cache** | `rsi:{symbol}_{timeframe}_{period}` | 60s | Store RSI values |
| **Lock** | `lock:alert:{alertId}` | 2-3s | Prevent duplicate processing |

### Cache Update Strategy:

1. **On Alert Create:** ✅ Add to both caches immediately
2. **On Alert Update:** ✅ Update both caches immediately
3. **On Alert Delete:** ✅ Remove from both caches immediately
4. **On Alert Trigger:** ✅ Update baseline in both caches
5. **On Baseline Update:** ✅ Update both caches (timeframe expiry)

---

## 3. Live Data Processing

### WebSocket Connection

**Location:** `services/RealTimeAlertProcessor.js`
**Method:** `startWebSocketPriceFeed()`

### Step 1: Connect to Binance WebSocket
```javascript
const wsUrl = "wss://stream.binance.com:9443/ws/!ticker@arr";
this.binanceWebSocket = new WebSocket(wsUrl);
```

**What is `!ticker@arr`?**
- `!` = All symbols
- `ticker` = 24hr ticker data
- `@arr` = Array format
- **Updates:** Every 1 second for all symbols

### Step 2: Receive WebSocket Messages
```javascript
// Message format (array of tickers)
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
  ...
]
```

### Step 3: Update Live Prices Cache
```javascript
// For each ticker in message:
tickers.forEach((ticker) => {
  const symbol = ticker.s;
  
  // Update In-Memory Cache
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
  
  // Update Redis Cache (non-blocking)
  const priceCacheKey = `crypto:${symbol}`;
  this.redisClient.set(priceCacheKey, JSON.stringify(priceData));
});
```

### Step 4: Filter Symbols with Alerts
```javascript
// Only process symbols that have active alerts
const symbolsWithAlerts = tickers
  .map(t => t.s)
  .filter(symbol => this.activeAlerts.has(symbol));
```

### Step 5: Process Each Symbol in Parallel
```javascript
// Process all symbols simultaneously (not sequential)
Promise.all(
  symbolsWithAlerts.map(symbol => 
    this.processPriceUpdateRealTime(symbol, liveData)
  )
);
```

---

## 4. Condition Matching

### Entry Point: `processPriceUpdateRealTime()`

**Location:** `services/RealTimeAlertProcessor.js:627`

### Step 1: Get Alerts for Symbol
```javascript
// Priority: In-Memory → Redis → Database
let alerts = this.activeAlerts.get(symbol) || [];

if (alerts.length === 0) {
  alerts = await this.getAlertsFromCache(symbol); // Redis
  if (alerts.length > 0) {
    this.activeAlerts.set(symbol, alerts); // Update in-memory
  }
}
```

### Step 2: Process Each Alert in Parallel
```javascript
// Process all alerts for this symbol simultaneously
const alertPromises = alerts.map(alert =>
  this.processLimit(async () => {
    const result = await this.processAlertWithLiveData(alert, liveData);
    return result;
  })
);

await Promise.all(alertPromises);
```

### Step 3: Check Baseline Update (Timeframe Expiry)
**Location:** `processAlertWithLiveData()`

```javascript
// Check if baseline needs update based on timeframe
if (alert.conditions?.changePercent?.timeframe) {
  const timeframe = "5MIN";
  const timeframeMs = 5 * 60 * 1000; // 5 minutes
  const timeSinceBaseline = Date.now() - baselineTimestamp;
  
  if (timeSinceBaseline >= timeframeMs) {
    // Update baseline to current price
    alert.baselinePrice = liveData.price;
    alert.baselineTimestamp = new Date();
    
    // Update in-memory cache
    alertsForSymbol[alertIndex].baselinePrice = liveData.price;
    
    // Update Redis cache
    await redis.set(cacheKey, JSON.stringify(updatedAlerts));
    
    // Update database (queued)
    this.enqueueDbOperation({
      type: "update_baseline",
      alertId: alert._id,
      data: { baselinePrice: liveData.price, ... }
    });
  }
}
```

### Step 4: Check Alert Lock (AlertCount Condition)
```javascript
// If alertCount condition exists, check if alert is locked
if (isAlertLocked(alert)) {
  const lockUntil = alert.conditions.alertCount.lockUntil;
  const now = new Date();
  
  if (now < lockUntil) {
    return { triggered: false, reason: "alert_locked" };
  }
}
```

### Step 5: Check Price Direction
```javascript
// For changePercent condition
const direction = alert.conditions?.changePercent?.direction || "increase";

if (direction === "increase" && liveData.price <= alert.baselinePrice) {
  return { triggered: false, reason: "price_not_increased" };
}

if (direction === "decrease" && liveData.price >= alert.baselinePrice) {
  return { triggered: false, reason: "price_not_decreased" };
}
```

### Step 6: Check All Conditions
**Location:** `checkAlertConditionsWithLiveData()`

```javascript
// Get all active conditions
const activeConditions = this.getActiveConditions(alert.conditions);

// Check all conditions in PARALLEL (not sequential)
const conditionResults = await Promise.all(
  activeConditions.map(condition => {
    switch (condition.type) {
      case "changePercent":
        return this.evaluateChangePercentCondition(...);
      case "price":
        return this.evaluatePriceCondition(...);
      case "volume":
        return this.evaluateVolumeCondition(...);
      case "rsi":
        return this.evaluateRSICondition(...);
      case "openInterest":
        return this.evaluateOpenInterestCondition(...);
      case "alertCount":
        return this.evaluateAlertCountCondition(...);
    }
  })
);

// All conditions must pass
const allPassed = conditionResults.every(r => r.passed);

if (allPassed) {
  return { passed: true, results: conditionResults };
} else {
  return { passed: false, results: conditionResults };
}
```

### Condition Evaluation Examples:

#### 1. Change Percent Condition
```javascript
evaluateChangePercentCondition(condition, alert, liveData) {
  const baselinePrice = alert.baselinePrice;
  const currentPrice = liveData.price;
  const changePercent = ((currentPrice - baselinePrice) / baselinePrice) * 100;
  const threshold = condition.value; // e.g., 5%
  
  if (condition.direction === "increase") {
    return changePercent >= threshold;
  } else if (condition.direction === "decrease") {
    return changePercent <= -threshold;
  }
}
```

#### 2. RSI Condition (with Multi-Layer Cache)
```javascript
async evaluateRSICondition(condition, alert, liveData) {
  const symbol = alert.symbol;
  const timeframe = condition.timeframe; // "1H"
  const period = condition.period; // 14
  
  // Step 1: Check In-Memory Cache (0.1ms)
  const memoryKey = `${symbol}_${timeframe}_${period}`;
  let rsi = this.rsiData.get(memoryKey);
  
  if (rsi && (Date.now() - rsi.timestamp) < 60000) {
    // Cache hit - use cached value
    return rsi.current >= condition.value;
  }
  
  // Step 2: Check Redis Cache (5-20ms)
  const redisKey = `rsi:${symbol}_${timeframe}_${period}`;
  const cachedRSI = await redis.get(redisKey);
  
  if (cachedRSI) {
    const rsiData = JSON.parse(cachedRSI);
    // Update in-memory cache
    this.rsiData.set(memoryKey, rsiData);
    return rsiData.current >= condition.value;
  }
  
  // Step 3: Calculate RSI (background - non-blocking)
  // Fetch candle data and calculate RSI
  const rsiValue = await this.calculateRSI(symbol, timeframe, period);
  
  // Update both caches
  this.rsiData.set(memoryKey, { current: rsiValue, timestamp: Date.now() });
  await redis.set(redisKey, JSON.stringify({ current: rsiValue, timestamp: Date.now() }), "EX", 60);
  
  return rsiValue >= condition.value;
}
```

#### 3. Alert Count Condition
```javascript
evaluateAlertCountCondition(condition, alert, liveData) {
  // Check if alert is locked (already triggered in this timeframe)
  if (isAlertLocked(alert)) {
    return { passed: false, reason: "alert_locked" };
  }
  
  // If not locked, condition passes (lock will be set after trigger)
  return { passed: true };
}
```

---

## 5. Alert Triggering

### Entry Point: `triggerAlertWithLiveData()`

**Location:** `services/RealTimeAlertProcessor.js:1250`

### Step 1: Acquire Redis Lock
```javascript
// Prevent duplicate processing (especially for alertCount)
const hasAlertCount = alert.conditions?.alertCount?.timeframe;
const lockToken = hasAlertCount 
  ? await this.acquireAlertLock(alert._id, 3000) // 3s lock
  : await this.acquireAlertLock(alert._id, 2000); // 2s lock

if (!lockToken) {
  // Another worker is processing this alert
  return false;
}
```

**Lock Mechanism:**
- **Key:** `lock:alert:{alertId}`
- **TTL:** 2-3 seconds (auto-expire)
- **Token:** Random + timestamp (unique)
- **Purpose:** Prevent duplicate triggers

### Step 2: Calculate Trigger Data
```javascript
const baselinePrice = alert.baselinePrice;
const livePrice = liveData.price;
const changeFromBaseline = livePrice - baselinePrice;
const changeFromBaselinePercent = (changeFromBaseline / baselinePrice) * 100;
```

### Step 3: Create Alert History (BLOCKING)
```javascript
// CRITICAL: Save AlertHistory FIRST (blocking operation)
// This is needed for notifications (Email/Telegram need historyId)
const alertHistory = {
  alertId: alert._id,
  userId: alert.userId,
  symbol: alert.symbol,
  alertConditions: alert.conditions,
  triggerData: {
    price: liveData.price,
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

const savedAlertHistory = await AlertHistoryService.createAlertHistory(alertHistory);
// This is BLOCKING (10-50ms) - needed for notifications
```

### Step 4: Update Alert Lock (if AlertCount)
```javascript
if (alert.conditions.alertCount?.timeframe) {
  const updatedConditions = updateAlertLock(alert);
  // Sets lockUntil to end of current candle period
  // Example: 5MIN timeframe, triggered at 1:02 → locked until 1:05
}
```

### Step 5: Update Alert in Database (QUEUED)
```javascript
// Queue database update (non-blocking)
this.enqueueDbOperation({
  type: "update_alert",
  alertId: alert._id,
  data: {
    lastTriggeredAt: new Date(),
    lastTriggeredPrice: liveData.price,
    baselinePrice: liveData.price, // Update baseline
    baselineTimestamp: new Date(),
    conditions: updatedConditions // If alertCount exists
  },
  priority: "high"
});

// This goes to Redis Stream/List → db-queue-worker processes it
```

### Step 6: Update In-Memory Cache
```javascript
// Update immediately (no DB query needed)
const alertsForSymbol = this.activeAlerts.get(alert.symbol);
const alertIndex = alertsForSymbol.findIndex(a => a._id === alert._id);

alertsForSymbol[alertIndex] = {
  ...alertsForSymbol[alertIndex],
  lastTriggeredAt: new Date(),
  lastTriggeredPrice: liveData.price,
  baselinePrice: liveData.price, // New baseline
  baselineTimestamp: new Date(),
  conditions: updatedConditions // If alertCount
};
```

### Step 7: Update Redis Cache
```javascript
// Update Redis cache (non-blocking)
this.updateAlertInCache({
  ...alert,
  lastTriggeredAt: new Date(),
  lastTriggeredPrice: liveData.price,
  baselinePrice: liveData.price,
  baselineTimestamp: new Date(),
  conditions: updatedConditions
});
```

### Step 8: Update Price Cache
```javascript
// Update price cache for this symbol
const priceCacheKey = `crypto:${alert.symbol}`;
await redis.set(priceCacheKey, JSON.stringify(liveData));
```

### Step 9: Send Notifications (NON-BLOCKING)
```javascript
// Send notifications in background
NotificationService.sendAlertNotification(
  alert,
  savedAlertHistory, // With _id for chart screenshot
  liveData
).catch(error => {
  console.error("Error sending notification:", error);
});
```

**Notification Flow:**
1. **Email:** Nodemailer → SMTP server
2. **Telegram:** Bot API → Send message + chart screenshot (Puppeteer)

### Step 10: Release Lock
```javascript
finally {
  // Always release lock, even if error occurs
  if (lockToken) {
    await this.releaseAlertLock(alert._id, lockToken);
  }
}
```

---

## 6. Alert Deletion

### Step 1: User Deletes Alert (Frontend)
```
User → Delete Alert Button → API Call
```

**Location:** `app/api/alerts/route.js` (DELETE method)

### Step 2: Delete from Database
```javascript
DELETE /api/alerts/{alertId}

// Mark alert as inactive
await Alert.findByIdAndUpdate(alertId, { status: "inactive" });
```

### Step 3: Publish Deletion Event
```javascript
// Redis Pub/Sub event
redis.publish("alert:management", {
  event: "remove",
  alertId: alertId,
  symbol: "BTCUSDT",
  userId: "user123"
});
```

### Step 4: Remove from Cache (Real-Time)
**Location:** `services/RealTimeAlertProcessor.js`
**Method:** `removeAlert(alertId)`

```javascript
async removeAlert(alertId) {
  // Step 1: Find alert in in-memory cache
  let removed = false;
  let removedSymbol = null;
  
  for (const [symbol, alerts] of this.activeAlerts.entries()) {
    const alertIndex = alerts.findIndex(a => a._id.toString() === alertId);
    if (alertIndex !== -1) {
      removed = true;
      removedSymbol = symbol;
      break;
    }
  }
  
  // Step 2: Remove from in-memory cache
  if (removed && removedSymbol) {
    const alerts = this.activeAlerts.get(removedSymbol);
    const updatedAlerts = alerts.filter(a => a._id.toString() !== alertId);
    
    if (updatedAlerts.length === 0) {
      // No alerts left for this symbol
      this.activeAlerts.delete(removedSymbol);
    } else {
      // CRITICAL: Create new array reference (ensures Map update)
      this.activeAlerts.set(removedSymbol, [...updatedAlerts]);
    }
  }
  
  // Step 3: Remove from Redis cache
  const redis = await this.initRedisClient();
  if (redis && removedSymbol) {
    const cacheKey = `alerts:cache:${removedSymbol}`;
    const existingAlerts = await this.getAlertsFromCache(removedSymbol);
    
    const updatedAlerts = existingAlerts.filter(
      a => a._id.toString() !== alertId
    );
    
    if (updatedAlerts.length === 0) {
      // Delete cache key if no alerts left
      await redis.del(cacheKey);
      this.activeAlerts.delete(removedSymbol);
    } else {
      // Update with remaining alerts
      await redis.set(cacheKey, JSON.stringify(updatedAlerts));
      // CRITICAL: Update in-memory cache with new array
      this.activeAlerts.set(removedSymbol, [...updatedAlerts]);
    }
  }
  
  // Step 4: Clean up tracking sets
  this.alertIds.delete(alertId);
  
  // Step 5: Clean up baseline data
  for (const [key, baseline] of this.alertBaselines.entries()) {
    if (key.startsWith(`${alertId}_`)) {
      this.alertBaselines.delete(key);
      break;
    }
  }
  
  // Step 6: Clean up candle data
  if (removedSymbol) {
    for (const [key, candle] of this.candleData.entries()) {
      if (key.startsWith(`${removedSymbol}_`)) {
        this.candleData.delete(key);
      }
    }
  }
  
  return removed;
}
```

### Special Cases:

#### Case 1: Remove All Alerts for Symbol
```javascript
// When user unfavorites a symbol
async removeAlertsForSymbol(symbol) {
  // Remove from in-memory cache
  this.activeAlerts.delete(symbol);
  
  // Remove from Redis cache
  const redis = await this.initRedisClient();
  if (redis) {
    const cacheKey = `alerts:cache:${symbol}`;
    await redis.del(cacheKey);
  }
  
  // Clean up candle data
  for (const [key, candle] of this.candleData.entries()) {
    if (key.startsWith(`${symbol}_`)) {
      this.candleData.delete(key);
    }
  }
}
```

#### Case 2: Remove All Alerts for User
```javascript
// When user clears all favorites
async removeAlertsForUser(userId) {
  const symbolsToUpdate = new Set();
  
  // Remove user's alerts from in-memory cache
  for (const [symbol, alerts] of this.activeAlerts.entries()) {
    const remainingAlerts = alerts.filter(a => a.userId !== userId);
    
    if (remainingAlerts.length === 0) {
      this.activeAlerts.delete(symbol);
    } else {
      this.activeAlerts.set(symbol, remainingAlerts);
    }
    symbolsToUpdate.add(symbol);
  }
  
  // Update Redis cache for all affected symbols
  const redis = await this.initRedisClient();
  if (redis) {
    for (const symbol of symbolsToUpdate) {
      const cacheKey = `alerts:cache:${symbol}`;
      const alerts = this.activeAlerts.get(symbol);
      
      if (!alerts || alerts.length === 0) {
        await redis.del(cacheKey);
      } else {
        await redis.set(cacheKey, JSON.stringify(alerts));
      }
    }
  }
}
```

---

## 🔄 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    ALERT CREATION                           │
└─────────────────────────────────────────────────────────────┘
                          ↓
        User Creates Alert → API → MongoDB Save
                          ↓
        Redis Pub/Sub Event → RealTimeAlertProcessor
                          ↓
        addAlert() → In-Memory Cache + Redis Cache
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                 WEBSOCKET LIVE DATA                          │
└─────────────────────────────────────────────────────────────┘
                          ↓
        Binance WebSocket → !ticker@arr (all symbols)
                          ↓
        Update Live Prices Cache (In-Memory + Redis)
                          ↓
        Filter Symbols with Alerts
                          ↓
        processPriceUpdateRealTime() for each symbol
                          ↓
┌─────────────────────────────────────────────────────────────┐
│              CONDITION MATCHING                              │
└─────────────────────────────────────────────────────────────┘
                          ↓
        Get Alerts from Cache (In-Memory → Redis)
                          ↓
        Process Each Alert in Parallel
                          ↓
        Check Baseline Update (Timeframe Expiry)
                          ↓
        Check Alert Lock (AlertCount)
                          ↓
        Check Price Direction
                          ↓
        Check All Conditions (Parallel):
          - Change Percent
          - Price
          - Volume
          - RSI (with cache)
          - Open Interest
          - Alert Count
                          ↓
        All Conditions Pass? → YES
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                 ALERT TRIGGERING                             │
└─────────────────────────────────────────────────────────────┘
                          ↓
        Acquire Redis Lock (prevent duplicate)
                          ↓
        Save AlertHistory (BLOCKING - for notifications)
                          ↓
        Update Alert Lock (if AlertCount)
                          ↓
        Queue Database Update (NON-BLOCKING)
                          ↓
        Update In-Memory Cache
                          ↓
        Update Redis Cache
                          ↓
        Update Price Cache
                          ↓
        Send Notifications (NON-BLOCKING)
                          ↓
        Release Redis Lock
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                  ALERT DELETION                              │
└─────────────────────────────────────────────────────────────┘
                          ↓
        User Deletes Alert → API → MongoDB Update
                          ↓
        Redis Pub/Sub Event → RealTimeAlertProcessor
                          ↓
        removeAlert() → Remove from In-Memory + Redis
                          ↓
        Clean up: baseline, candle data, tracking sets
```

---

## 📊 Performance Metrics

| Operation | Time | Cache Layer |
|-----------|------|-------------|
| **Get Alerts** | 0.1ms | In-Memory |
| **Get Alerts** | 5-20ms | Redis |
| **Get Alerts** | 50-200ms | MongoDB |
| **Get Price** | 0.1ms | In-Memory |
| **Get Price** | 5-20ms | Redis |
| **Get RSI** | 0.1ms | In-Memory (cached) |
| **Get RSI** | 5-20ms | Redis (cached) |
| **Get RSI** | 200-500ms | API Call (background) |
| **Save AlertHistory** | 10-50ms | MongoDB (blocking) |
| **Update Alert** | 0ms | Queued (non-blocking) |
| **Send Notification** | 0ms | Background (non-blocking) |

---

## 🔒 Lock Mechanism

**Purpose:** Prevent duplicate alert processing

**When Used:**
- ✅ Alert triggering (especially with AlertCount condition)
- ✅ Multi-worker environments

**How It Works:**
1. **Acquire Lock:** `SET lock:alert:{alertId} {token} NX PX 2000`
2. **Process Alert:** Only if lock acquired
3. **Release Lock:** Lua script (atomic check-and-delete)

**Lock Duration:**
- **Standard:** 2 seconds
- **AlertCount:** 3 seconds (longer processing)

**Auto-Expire:** Lock automatically expires (safety mechanism)

---

## 🎯 Key Optimizations

1. **Multi-Layer Caching:** In-Memory → Redis → Database
2. **Parallel Processing:** All alerts processed simultaneously
3. **Batch WebSocket:** Process multiple symbols in parallel
4. **Non-Blocking Operations:** Database updates queued
5. **Background Tasks:** RSI calculation, API calls
6. **Redis Lock:** Prevent duplicate processing
7. **Event-Driven Updates:** Cache updated on create/update/delete
8. **No TTL for Alerts:** Cache updated live (no expiry needed)
9. **No TTL for Prices:** WebSocket provides continuous updates

---

## ✅ Summary

**Alert Creation:**
1. Save to MongoDB
2. Publish event
3. Add to In-Memory + Redis cache

**Live Data Processing:**
1. WebSocket receives all symbols
2. Update price cache
3. Filter symbols with alerts
4. Process in parallel

**Condition Matching:**
1. Get alerts from cache
2. Check baseline update
3. Check alert lock
4. Check all conditions (parallel)

**Alert Triggering:**
1. Acquire lock
2. Save history (blocking)
3. Queue DB update (non-blocking)
4. Update caches
5. Send notifications (non-blocking)
6. Release lock

**Alert Deletion:**
1. Update MongoDB
2. Publish event
3. Remove from In-Memory + Redis cache
4. Clean up related data

---

**End of Documentation** 🎉

