# Alert System Bug Analysis Report
*Date: January 2, 2026*
*Analysis by: System Audit*

## 🔴 CRITICAL ISSUES FOUND

### Issue #1: "Change in price: 0.000%" Bug at 16:00:00

**Problem:**
Alerts are showing `Change in price: 0.000%` when triggered at exactly 16:00:00 for multiple coins.

**Root Cause:**
Located in `services/RealTimeAlertProcessor.js` at lines **1837-1873**:

```javascript
// Check if timeframe interval has passed
if (timeSinceBaseline >= timeframeMs) {
  console.log(
    `🔄 Timeframe interval passed for ${alert.symbol}, updating baseline from ${alert.baselinePrice} to ${priceData.price}`
  );

  // ❌ BUG: Baseline is updated to CURRENT price BEFORE alert is triggered
  alert.baselinePrice = priceData.price;  // Line 1843
  alert.baselineVolume = priceData.volume || priceData.volume24h;
  alert.baselineTimestamp = new Date();
  
  // ... database update happens here ...
}

// THEN alert is checked and triggered (lines 1917-2133)
// But by this time, baseline = current price!
// So: changeFromBaselinePercent = 0.000%
```

**Impact:**
- When a timeframe interval completes (e.g., 5 minutes), the baseline is reset to the current price
- The alert then triggers with baseline = current price
- This causes `changeFromBaselinePercent = (price - baseline) / baseline * 100 = 0%`
- Telegram notifications show incorrect "Change in price: 0.000%"

**Example:**
```
COOKIEUSDT at 16:00:00
- Actual 24h change: 16.667% (CORRECT)
- Change in price: 0.000% (WRONG - should show change from baseline)
```

**Why it happens at 16:00:00:**
- 16:00:00 is likely when a 5-minute candle closes
- The timeframe check `timeSinceBaseline >= timeframeMs` becomes true
- Baseline gets reset right before triggering

---

### Issue #2: Potential Alert Misses Due to Race Conditions

**Problem:**
Multiple locking mechanisms can cause alerts to be skipped incorrectly.

**Root Cause:**
Located in `utils/alertProcessor.js`:

```javascript
// Line 87: Lock TTL is only 1 second
const lockTTL = 1; // 🔥 REDUCED: 1 second (was 5s - caused missed alerts)

// Line 191: Recently processed check (10 seconds)
return timeDiff < 10000; // 10 seconds

// Line 326: Lock cleanup threshold (10 seconds)
const lockThreshold = 10000; // 10 seconds for processing locks
```

**Issues:**
1. **Lock TTL too short (1 second)**: If WebSocket processing takes >1 second, the lock expires and another worker might process the same alert
2. **Multiple lock layers**: Alert has 3 different lock mechanisms:
   - Processing lock (1 second TTL)
   - Alert lock (from alertCount)
   - Recently processed cache (10 seconds)
3. **Race condition window**: Between lines 2135-2373, if baseline is updated by another process, alert might miss

---

### Issue #3: Baseline Update Race Condition

**Problem:**
Baseline can be updated multiple times during alert processing, causing inconsistent calculations.

**Root Cause:**
Located in `services/RealTimeAlertProcessor.js`:

```javascript
// Lines 1843-1904: Baseline updated BEFORE alert check
alert.baselinePrice = priceData.price;

// Lines 2282-2310: Baseline updated AGAIN after alert triggers  
await Alert.findByIdAndUpdate(alert._id, {
  baselinePrice: priceData.price,  // Updated again!
  baselineVolume: priceData.volume,
  baselineTimestamp: new Date(),
});
```

**Impact:**
- Baseline is updated twice in one alert cycle
- First update causes 0% change calculation
- Second update is redundant
- In-memory and database can get out of sync

---

## 🐛 OTHER POTENTIAL ISSUES

### Issue #4: Incorrect actualValue Mapping

**Location:** `workers/notify-worker.js` line 189

```javascript
actualValue: history.triggerData?.priceChangePercent || 0,
```

**Problem:**
- `actualValue` is set to `priceChangePercent` (24h change from Binance)
- But it should be `changeFromBaselinePercent` (change from the alert's baseline)
- This doesn't match the "Actual 24h change: 16.667%" shown in notifications

**Why it's confusing:**
The Telegram message shows "Actual 24h change" which is from `priceChangePercent`, but this should be the change based on the alert's timeframe (5MIN, 15MIN, etc.), not 24h.

---

### Issue #5: Duplicate Alert Prevention Too Aggressive

**Location:** `services/RealTimeAlertProcessor.js` lines 2142-2167

```javascript
// Create alert key with 1-minute window
const alertKey = `${alert._id}_${Math.floor(
  priceData.timestamp / (1 * 60 * 1000)
)}_${Math.floor(parseFloat(priceData.price))}`;

// Also check price-based key
const priceKey = `${alert._id}_price_${Math.floor(
  parseFloat(priceData.price)
)}`;
```

**Problem:**
- Price is floored (e.g., $0.044800 → $0)
- This can cause ALL alerts for low-price coins to be marked as duplicates
- Example: $0.044800 and $0.045123 both floor to $0

---

## 📊 ALERT MISS SCENARIOS

Based on the analysis, alerts can be missed in these scenarios:

1. **Timeframe Reset Miss**:
   - Alert baseline is reset when timeframe interval completes
   - Next price update happens immediately after
   - Alert shows 0% change and might not meet threshold

2. **Lock Expiry Miss**:
   - Processing lock expires after 1 second
   - Another worker picks up the same alert
   - Both workers skip it (one due to lock, one due to "recently processed")

3. **Price Floor Collision**:
   - Two different prices floor to same integer
   - Second alert is skipped as "duplicate"
   - Common for low-price altcoins (<$1)

4. **Redis Unavailable Fallback**:
   - When Redis is down, system falls back to in-memory locks
   - Multiple workers don't share in-memory state
   - Same alert can be processed multiple times OR skipped

---

## 🔧 RECOMMENDED FIXES

### Fix #1: Baseline Update Timing (CRITICAL)

**Change in:** `services/RealTimeAlertProcessor.js` lines 1837-1914

**Current flow:**
```
1. Check if timeframe passed → YES
2. Update baseline to current price
3. Save to database
4. Check alert conditions
5. Trigger alert (but baseline = current price!)
```

**Correct flow:**
```
1. Check if timeframe passed → YES
2. Note that baseline should be updated AFTER trigger
3. Check alert conditions (with OLD baseline)
4. Trigger alert (with correct change calculation)
5. THEN update baseline to current price
```

**Implementation:**
```javascript
// Store if baseline needs updating, but DON'T update yet
let shouldUpdateBaseline = false;
if (timeSinceBaseline >= timeframeMs) {
  shouldUpdateBaseline = true;
  console.log(`⏰ Timeframe interval passed, will update baseline AFTER alert check`);
}

// Check alert conditions with CURRENT baseline (not updated yet)
if (isAlertLocked(alert)) {
  // ... lock check ...
}

// ... all condition checks ...

if (conditionsMet) {
  // Trigger alert with CORRECT baseline
  await this.triggerAlert(alert, priceData);
}

// NOW update baseline if needed
if (shouldUpdateBaseline) {
  alert.baselinePrice = priceData.price;
  // ... update database ...
}
```

---

### Fix #2: Price Floor Issue

**Change in:** `services/RealTimeAlertProcessor.js` lines 2156-2158

**Current:**
```javascript
const priceKey = `${alert._id}_price_${Math.floor(parseFloat(priceData.price))}`;
```

**Fixed:**
```javascript
// Use 8 decimal places for precise price tracking
const priceKey = `${alert._id}_price_${parseFloat(priceData.price).toFixed(8)}`;
```

---

### Fix #3: Lock TTL Adjustment

**Change in:** `utils/alertProcessor.js` line 87

**Current:**
```javascript
const lockTTL = 1; // 1 second
```

**Fixed:**
```javascript
const lockTTL = 3; // 3 seconds - enough for processing but not too long to block
```

---

### Fix #4: actualValue Correction

**Change in:** `workers/notify-worker.js` line 189

**Current:**
```javascript
actualValue: history.triggerData?.priceChangePercent || 0,
```

**Fixed:**
```javascript
// Use baseline change for timeframe-based alerts, fallback to 24h change
actualValue: history.baselineData?.changeFromBaselinePercent ?? 
             history.triggerData?.priceChangePercent ?? 0,
```

---

## 🎯 TESTING RECOMMENDATIONS

1. **Test Timeframe Boundaries**:
   - Create alert for 5MIN timeframe
   - Wait for exactly 5 minutes
   - Check if "Change in price" is calculated correctly

2. **Test Low-Price Coins**:
   - Create alerts for coins <$1
   - Verify no false duplicates
   - Check all price changes are detected

3. **Test Under Load**:
   - Create 100+ alerts for same symbol
   - Send rapid price updates
   - Verify no alerts are missed or duplicated

4. **Test Redis Failure**:
   - Stop Redis temporarily
   - Verify fallback mechanism works
   - Check for alert duplicates when Redis recovers

---

## 📈 PRIORITY

| Issue | Severity | Impact | Priority |
|-------|----------|--------|----------|
| Baseline Update Timing | CRITICAL | All alerts at timeframe boundaries | P0 |
| Price Floor Issue | HIGH | Low-price coins | P1 |
| Lock TTL | MEDIUM | Race conditions under load | P2 |
| actualValue Mapping | LOW | Display inconsistency | P3 |

---

## 🔍 ADDITIONAL NOTES

1. **16:00:00 Pattern**: This time appears frequently because:
   - Many 5-minute candles align on :00, :05, :10, :15, etc.
   - 16:00:00 is 4:00 PM - high trading volume time
   - System likely resets baselines at round candle times

2. **Missed Alerts**: Could be caused by:
   - Baseline reset bug (alert doesn't trigger because change = 0%)
   - Lock expiry during processing
   - Redis connection issues
   - Price floor collisions for cheap coins

3. **System Architecture**: 
   - Multiple workers process alerts in parallel
   - Redis is used for coordination
   - WebSocket provides real-time price updates
   - Complex locking mechanism to prevent duplicates

---

*End of Analysis Report*
