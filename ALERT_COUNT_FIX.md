# 🔒 Alert Count Lock Bug - FIXED

## 🐛 Problem
Alert Count condition (1HR) set tha, lekin **5 minutes baad dobara same coin ka alert aa raha tha**.

## Root Cause
1. **In-memory cache update nahi ho raha** - Lock DB mein save ho raha tha, lekin in-memory alert object mein nahi
2. **Baseline update** ke time lock conditions overwrite ho jate the
3. **Redis lock** sirf 2-3 seconds ka tha (processing lock), Alert Count lock nahi

## ✅ Fix Applied

### **1. Early Lock Check in triggerAlertWithLiveData()**
```javascript
// BEFORE: Lock check nahi tha
async triggerAlertWithLiveData(alert, liveData) {
  const lockToken = await this.acquireAlertLock(...);
  // Process alert
}

// AFTER: Lock check FIRST
async triggerAlertWithLiveData(alert, liveData) {
  // Check Alert Count lock FIRST
  if (isAlertLocked(alert)) {
    console.log(`🔒 ALERT BLOCKED - Locked for ${minutesRemaining}min`);
    return false;
  }
  
  const lockToken = await this.acquireAlertLock(...);
  // Process alert
}
```

### **2. Immediate In-Memory Update with Lock**
```javascript
// BEFORE: Lock conditions update nahi ho rahe the
alertsForSymbol[alertIndex] = {
  ...alertsForSymbol[alertIndex],
  ...updateData,
  baselinePrice: liveData.price,
};

// AFTER: Lock conditions bhi update ho rahe hain
alertsForSymbol[alertIndex] = {
  ...alertsForSymbol[alertIndex],
  ...updateData,
  conditions: updateData.conditions, // ✅ Lock included
  baselinePrice: liveData.price,
};
```

### **3. Preserve Lock During Baseline Updates**
```javascript
// BEFORE: Baseline update ke time lock lost ho jata tha
alertsForSymbol[alertIndex] = {
  ...alertsForSymbol[alertIndex],
  baselinePrice: liveData.price,
  // conditions missing - lock lost!
};

// AFTER: Lock preserve hota hai
alertsForSymbol[alertIndex] = {
  ...alertsForSymbol[alertIndex],
  baselinePrice: liveData.price,
  conditions: alert.conditions, // ✅ Lock preserved
};
```

## 🎯 Result

### Before Fix:
```
10:00 AM - Alert triggers ✅
10:05 AM - Alert triggers again ❌ (should be locked)
10:10 AM - Alert triggers again ❌ (should be locked)
```

### After Fix:
```
10:00 AM - Alert triggers ✅ (Lock until 11:00 AM)
10:05 AM - 🔒 BLOCKED (55 min remaining)
10:30 AM - 🔒 BLOCKED (30 min remaining)
10:59 AM - 🔒 BLOCKED (1 min remaining)
11:00 AM - Lock expires, can trigger again ✅
```

## 📊 Changes Made

| File | Lines Changed | Purpose |
|------|---------------|---------|
| `RealTimeAlertProcessor.js` | 3 sections | Early lock check, immediate in-memory update, preserve lock |

## ✅ Testing

Test karne ke liye:
1. Alert create karo with Alert Count = 1HR
2. Condition meet karo (e.g., 2% increase)
3. Alert trigger hoga ✅
4. 5-10 minutes baad condition dobara meet karo
5. Alert **NAHI** trigger hoga 🔒 (locked message dikhega)
6. 1 hour baad condition meet karo
7. Alert dobara trigger hoga ✅

## 🚀 Deployment

Changes already applied. Restart alert processor:
```bash
pm2 restart alert-processor
```

## 📝 Logs to Watch

```
✅ Alert 123 for BTCUSDT is NOT locked, proceeding...
🔒 Alert 123 LOCKED for 1HR until 2024-01-15T11:00:00Z
✅ In-memory alert updated with lock: 123

# 5 minutes later
🔒 ALERT BLOCKED - Alert 123 for BTCUSDT is LOCKED until 2024-01-15T11:00:00Z (55 minutes remaining)
```

## 🎉 Done!

Ab 1HR ka alert sirf **1 hour mein ek baar** trigger hoga, chahe 100 baar condition meet ho! 🔒


import { NextResponse } from "next/server";
import { connectToMongoDB } from "../../../../utils/mongodb.js";
import { verifyToken } from "../../../../utils/auth.js";
import { FavoritesCache, AlertsCache } from "../../../../utils/redis.js";
import { initializeRedis } from "../../../../utils/init-redis.js";
import { calculateLockTime } from "../../../../utils/alertLock.js";
import Alert from "../../../../models/Alert.js";
import RealTimeAlertProcessor from "../../../../services/RealTimeAlertProcessor.js";
import AlertRedisService from "../../../../services/AlertRedisService.js";

// POST /api/alerts/bulk - Create alerts for all favorite pairs
export async function POST(request) {
  try {
    await connectToMongoDB();

    // Initialize Redis (optional - continue if it fails)
    try {
      await initializeRedis();
    } catch (redisError) {
      console.warn(
        "⚠️ Redis initialization failed, continuing without cache:",
        redisError.message
      );
    }

    // Get token from Authorization header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Authorization token required" },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const userId = decoded.userId;
    const { conditions, notificationSettings } = await request.json();

    if (!conditions) {
      return NextResponse.json(
        { error: "Conditions are required" },
        { status: 400 }
      );
    }

    // Validate required conditions

    if (
      !conditions.minDaily ||
      !conditions.changePercent?.timeframe ||
      !conditions.changePercent?.percentage
    ) {
      return NextResponse.json(
        {
          error: "Min Daily and Change % conditions are required",
          details: {
            minDaily: conditions.minDaily,
            changePercent: conditions.changePercent,
          },
        },
        { status: 400 }
      );
    }

    // Get user's favorites from Redis cache or API
    let favoriteSymbols = null;

    try {
      favoriteSymbols = await FavoritesCache.getUserFavorites(decoded.userId);
    } catch (cacheError) {
      console.warn(
        "⚠️ Redis cache error, fetching from API:",
        cacheError.message
      );
    }

    if (!favoriteSymbols) {
      // Cache miss - get from API
      const response = await fetch(
        `${request.nextUrl.origin}/api/favorites/list`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        favoriteSymbols = data.favorites || [];
      } else {
        return NextResponse.json(
          { error: "Failed to get favorites" },
          { status: 400 }
        );
      }
    }

    if (favoriteSymbols.length === 0) {
      return NextResponse.json(
        {
          error:
            "No favorite pairs found. Please add some pairs to favorites first.",
        },
        { status: 400 }
      );
    }

    // Fetch current prices for baseline
    console.log("📊 Fetching current prices for baseline...");
    let currentPrices = {};

    try {
      // Get current prices from Redis or API
      const redis = await import("../../../../utils/redis.js");
      for (const symbol of favoriteSymbols) {
        try {
          // Try both formats: original case and lowercase
          let priceData = await redis.default.get(`crypto:${symbol}`);
          if (!priceData) {
            priceData = await redis.default.get(
              `crypto:${symbol.toLowerCase()}`
            );
          }

          if (priceData) {
            const data = JSON.parse(priceData);
            console.log(`🔍 Debug - Fetched data for ${symbol}:`, data);
            currentPrices[symbol] = {
              price: parseFloat(data.price),
              volume: parseFloat(data.volume24h) || 0, // Use volume24h as baseline volume
              timestamp: Date.now(),
            };
            console.log(
              `🔍 Debug - Set currentPrices[${symbol}]:`,
              currentPrices[symbol]
            );
          } else {
            console.log(
              `⚠️ No price data found for ${symbol} (tried both formats)`
            );
          }
        } catch (error) {
          console.warn(`⚠️ Could not get price for ${symbol}:`, error.message);
        }
      }
    } catch (error) {
      console.warn("⚠️ Error fetching current prices:", error.message);
    }

    // Fallback: If no Redis data, fetch from Binance API directly
    if (Object.keys(currentPrices).length === 0) {
      console.log("📊 No Redis data found, fetching from Binance API...");
      try {
        const response = await fetch(
          "https://api.binance.com/api/v3/ticker/24hr"
        );
        const tickers = await response.json();

        for (const symbol of favoriteSymbols) {
          const ticker = tickers.find((t) => t.symbol === symbol);
          if (ticker) {
            currentPrices[symbol] = {
              price: parseFloat(ticker.lastPrice),
              volume: parseFloat(ticker.quoteVolume), // USDT volume (24h)
              timestamp: Date.now(),
            };
            console.log(
              `✅ Fetched ${symbol} from Binance API - Price: ${currentPrices[symbol].price}, Volume (USDT): ${currentPrices[symbol].volume}`
            );
          }
        }
      } catch (apiError) {
        console.warn("⚠️ Error fetching from Binance API:", apiError.message);
      }
    }

    // Fetch open interest for symbols if openInterest condition is present
    const openInterestData = {};
    if (
      conditions.openInterest &&
      conditions.openInterest.timeframes?.length > 0
    ) {
      console.log("📊 Fetching Open Interest data from Binance Futures API...");
      for (const symbol of favoriteSymbols) {
        try {
          // Convert spot symbol to futures symbol (e.g., BTCUSDT -> BTCUSDT)
          const futuresSymbol = symbol.toUpperCase();
          const response = await fetch(
            `https://fapi.binance.com/fapi/v1/openInterest?symbol=${futuresSymbol}`
          );
          if (response.ok) {
            const data = await response.json();
            openInterestData[symbol] = parseFloat(data.openInterest || 0);
            console.log(
              `✅ Fetched Open Interest for ${symbol}: ${openInterestData[symbol]}`
            );
          } else {
            console.warn(
              `⚠️ Could not fetch Open Interest for ${symbol}: ${response.status}`
            );
            openInterestData[symbol] = null;
          }
        } catch (error) {
          console.warn(
            `⚠️ Error fetching Open Interest for ${symbol}:`,
            error.message
          );
          openInterestData[symbol] = null;
        }
      }
    }

    // ✅ NO VOLUME FILTER: Create alerts for ALL favorites
    // minDaily is checked at RUNTIME by worker, not during creation
    console.log(`\n� Creating alerts for ALL ${favoriteSymbols.length} favorite symbols...`);
    console.log(`   minDaily (${conditions.minDaily}) will be checked at runtime by worker\n`);

    // Prepare alert documents for bulk insert (ALL favorites)
    const alertDocuments = favoriteSymbols.map((symbol) => {
      let alertConditions = { ...conditions };