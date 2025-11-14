# Open Interest Condition Examples - Multi-Timeframe Scenarios

## 📋 Open Interest Condition Setup

**Alert Configuration:**
- Symbol: BTCUSDT
- Open Interest Condition: INCREASING by 5% (Percentage Change Required)
- Timeframes: 1MIN, 5MIN, 15MIN, 1HR, 4H
- Baseline Open Interest: 1,000,000 BTC (when alert was created)

**Important:** 
- Percentage field mein jo value di hai (e.g., 5%), wahi minimum change required hai
- Open Interest ko baseline se **exactly that percentage** ya usse zyada change hona chahiye
- Example: 5% diya hai to Open Interest ko baseline se kam se kam 5% increase hona chahiye

---

## ✅ Scenario 1: Alert TRIGGERS (All Timeframes Pass)

### Current Market Data:
```
Baseline Open Interest: 1,000,000 BTC (from alert creation)
```

### Condition Check:

#### Timeframe 1MIN:
```
Current Open Interest: 1,060,000 BTC
Baseline Open Interest: 1,000,000 BTC

OI Change = ((1,060,000 - 1,000,000) / 1,000,000) × 100
          = (60,000 / 1,000,000) × 100
          = 6%

Required: 5% increase (percentage field value)
Actual: 6% increase
6% >= 5%? TRUE ✅

Explanation: Open Interest baseline se 6% increase hua hai, 
jo required 5% se zyada hai, isliye condition PASS ✅
```

#### Timeframe 5MIN:
```
Current Open Interest: 1,055,000 BTC
Baseline Open Interest: 1,000,000 BTC

OI Change = ((1,055,000 - 1,000,000) / 1,000,000) × 100
          = 5.5%

Required: 5% increase
Actual: 5.5% increase
5.5% >= 5%? TRUE ✅
```

#### Timeframe 15MIN:
```
Current Open Interest: 1,052,000 BTC
Baseline Open Interest: 1,000,000 BTC

OI Change = ((1,052,000 - 1,000,000) / 1,000,000) × 100
          = 5.2%

Required: 5% increase
Actual: 5.2% increase
5.2% >= 5%? TRUE ✅
```

#### Timeframe 1HR:
```
Current Open Interest: 1,051,000 BTC
Baseline Open Interest: 1,000,000 BTC

OI Change = ((1,051,000 - 1,000,000) / 1,000,000) × 100
          = 5.1%

Required: 5% increase
Actual: 5.1% increase
5.1% >= 5%? TRUE ✅
```

#### Timeframe 4H:
```
Current Open Interest: 1,050,000 BTC
Baseline Open Interest: 1,000,000 BTC

OI Change = ((1,050,000 - 1,000,000) / 1,000,000) × 100
          = 5%

Required: 5% increase
Actual: 5% increase
5% >= 5%? TRUE ✅
```

### Result:
```
✅✅✅✅✅ ALL TIMEFRAMES PASSED!
📊 Open Interest condition PASSED: INCREASING met for all timeframes
🚨 ALERT TRIGGERED! (if other conditions also pass)
```

---

## ❌ Scenario 2: Alert FAILS - One Timeframe Failed

### Current Market Data:
```
Baseline Open Interest: 1,000,000 BTC
```

### Condition Check:

#### Timeframe 1MIN: ✅
```
Current OI: 1,060,000 BTC
OI Change: +6%
6% >= 5%? TRUE ✅
```

#### Timeframe 5MIN: ✅
```
Current OI: 1,055,000 BTC
OI Change: +5.5%
5.5% >= 5%? TRUE ✅
```

#### Timeframe 15MIN: ✅
```
Current OI: 1,052,000 BTC
OI Change: +5.2%
5.2% >= 5%? TRUE ✅
```

#### Timeframe 1HR: ✅
```
Current OI: 1,051,000 BTC
OI Change: +5.1%
5.1% >= 5%? TRUE ✅
```

#### Timeframe 4H: ❌
```
Current OI: 1,040,000 BTC
Baseline OI: 1,000,000 BTC

OI Change = ((1,040,000 - 1,000,000) / 1,000,000) × 100
          = 4%

Required: 5% increase (percentage field value)
Actual: 4% increase
4% >= 5%? FALSE ❌

Explanation: Open Interest baseline se sirf 4% increase hua hai, 
jo required 5% se kam hai, isliye condition FAIL ❌
```

### Result:
```
✅ 1MIN PASSED
✅ 5MIN PASSED
✅ 15MIN PASSED
✅ 1HR PASSED
❌ 4H FAILED (4% < 5%)
❌ Open Interest condition FAILED: INCREASING not met for 4H timeframe
❌ ALERT NOT TRIGGERED
```

---

## ✅ Scenario 3: DECREASING Condition - All Pass

### Alert Configuration:
- Open Interest Condition: DECREASING by 3%
- Timeframes: 5MIN, 15MIN, 1HR
- Baseline Open Interest: 1,000,000 BTC

### Condition Check:

#### Timeframe 5MIN:
```
Current OI: 970,000 BTC
Baseline OI: 1,000,000 BTC

OI Change = ((970,000 - 1,000,000) / 1,000,000) × 100
          = -3%

Required: -3% (decrease)
Actual: -3% (decrease)
-3% <= -3%? TRUE ✅
```

#### Timeframe 15MIN:
```
Current OI: 968,000 BTC
Baseline OI: 1,000,000 BTC

OI Change = ((968,000 - 1,000,000) / 1,000,000) × 100
          = -3.2%

Required: -3% (decrease)
Actual: -3.2% (decrease)
-3.2% <= -3%? TRUE ✅
```

#### Timeframe 1HR:
```
Current OI: 965,000 BTC
Baseline OI: 1,000,000 BTC

OI Change = ((965,000 - 1,000,000) / 1,000,000) × 100
          = -3.5%

Required: -3% (decrease)
Actual: -3.5% (decrease)
-3.5% <= -3%? TRUE ✅
```

### Result:
```
✅✅✅ ALL TIMEFRAMES PASSED!
📉 Open Interest condition PASSED: DECREASING met for all timeframes
```

---

## ✅ Scenario 4: ABOVE Condition (Without Percentage) - All Pass

### Alert Configuration:
- Open Interest Condition: ABOVE (no percentage)
- Timeframes: 5MIN, 15MIN, 1HR

### Condition Check:

#### Timeframe 5MIN:
```
Current OI: 1,050,000 BTC
Baseline OI: 1,000,000 BTC
Required: Current > Baseline
1,050,000 > 1,000,000? TRUE ✅
```

#### Timeframe 15MIN:
```
Current OI: 1,030,000 BTC
Baseline OI: 1,000,000 BTC
1,030,000 > 1,000,000? TRUE ✅
```

#### Timeframe 1HR:
```
Current OI: 1,020,000 BTC
Baseline OI: 1,000,000 BTC
1,020,000 > 1,000,000? TRUE ✅
```

### Result:
```
✅✅✅ ALL TIMEFRAMES PASSED!
📈 Open Interest condition PASSED: ABOVE met for all timeframes
```

---

## ❌ Scenario 5: ABOVE Condition - One Failed

### Alert Configuration:
- Open Interest Condition: ABOVE (no percentage)
- Timeframes: 5MIN, 15MIN, 1HR

### Condition Check:

#### Timeframe 5MIN: ✅
```
Current OI: 1,050,000 BTC
Baseline OI: 1,000,000 BTC
1,050,000 > 1,000,000? TRUE ✅
```

#### Timeframe 15MIN: ✅
```
Current OI: 1,030,000 BTC
Baseline OI: 1,000,000 BTC
1,030,000 > 1,000,000? TRUE ✅
```

#### Timeframe 1HR: ❌
```
Current OI: 980,000 BTC
Baseline OI: 1,000,000 BTC
Required: Current > Baseline
980,000 > 1,000,000? FALSE ❌
```

### Result:
```
✅ 5MIN PASSED
✅ 15MIN PASSED
❌ 1HR FAILED (980,000 < 1,000,000)
❌ Open Interest condition FAILED
```

---

## ✅ Scenario 6: BELOW Condition - All Pass

### Alert Configuration:
- Open Interest Condition: BELOW (no percentage)
- Timeframes: 5MIN, 15MIN

### Condition Check:

#### Timeframe 5MIN:
```
Current OI: 950,000 BTC
Baseline OI: 1,000,000 BTC
Required: Current < Baseline
950,000 < 1,000,000? TRUE ✅
```

#### Timeframe 15MIN:
```
Current OI: 970,000 BTC
Baseline OI: 1,000,000 BTC
970,000 < 1,000,000? TRUE ✅
```

### Result:
```
✅✅ ALL TIMEFRAMES PASSED!
📉 Open Interest condition PASSED: BELOW met for all timeframes
```

---

## 📊 Complete Example Flow

### Alert Setup:
```
Symbol: BTCUSDT
Open Interest Condition: INCREASING by 5%
Timeframes: 1MIN, 5MIN, 15MIN, 1HR, 4H
Baseline Open Interest: 1,000,000 BTC (set at alert creation)
```

### Check Process:

```
1. Check Timeframe 1MIN
   📊 Fetch Open Interest from Binance
   Current OI: 1,060,000
   Baseline: 1,000,000
   Change: +6%
   Required: +5%
   6% >= 5%? ✅ PASS

2. Check Timeframe 5MIN
   📊 Fetch Open Interest from Binance
   Current OI: 1,055,000
   Baseline: 1,000,000
   Change: +5.5%
   Required: +5%
   5.5% >= 5%? ✅ PASS

3. Check Timeframe 15MIN
   📊 Fetch Open Interest from Binance
   Current OI: 1,052,000
   Baseline: 1,000,000
   Change: +5.2%
   Required: +5%
   5.2% >= 5%? ✅ PASS

4. Check Timeframe 1HR
   📊 Fetch Open Interest from Binance
   Current OI: 1,051,000
   Baseline: 1,000,000
   Change: +5.1%
   Required: +5%
   5.1% >= 5%? ✅ PASS

5. Check Timeframe 4H
   📊 Fetch Open Interest from Binance
   Current OI: 1,050,000
   Baseline: 1,000,000
   Change: +5%
   Required: +5%
   5% >= 5%? ✅ PASS

Result: ✅✅✅✅✅ ALL TIMEFRAMES PASSED!
Open Interest condition: PASSED
```

---

## 🔄 Real-Time Flow Example

### Timeline:

**10:00 AM - Alert Created:**
```
Baseline Open Interest: 1,000,000 BTC
```

**10:01 AM - First Check (1MIN interval):**
```
1MIN: Current OI = 1,060,000 (+6%) ✅
5MIN: Current OI = 1,055,000 (+5.5%) ✅
15MIN: Current OI = 1,052,000 (+5.2%) ✅
1HR: Current OI = 1,051,000 (+5.1%) ✅
4H: Current OI = 1,050,000 (+5%) ✅

Result: ✅ ALL PASSED - Alert can trigger
```

**10:05 AM - Second Check (5MIN interval):**
```
1MIN: Current OI = 1,040,000 (+4%) ❌ (Baseline updated to 1,060,000)
5MIN: Current OI = 1,055,000 (+5.5%) ✅
15MIN: Current OI = 1,052,000 (+5.2%) ✅
1HR: Current OI = 1,051,000 (+5.1%) ✅
4H: Current OI = 1,050,000 (+5%) ✅

Result: ❌ 1MIN FAILED - Alert won't trigger
```

**10:15 AM - Third Check (15MIN interval):**
```
1MIN: Current OI = 1,065,000 ✅ (New baseline for 1MIN)
5MIN: Current OI = 1,060,000 ✅ (New baseline for 5MIN)
15MIN: Current OI = 1,055,000 ✅ (New baseline for 15MIN)
1HR: Current OI = 1,051,000 (+5.1%) ✅
4H: Current OI = 1,050,000 (+5%) ✅

Result: ✅ ALL PASSED - Alert can trigger again
```

---

## 📝 Summary Table

| Condition | Timeframes | Required | Example Result |
|-----------|-----------|----------|----------------|
| **INCREASING** | 1MIN, 5MIN, 15MIN, 1HR, 4H | +5% | All pass: ✅ Trigger |
| **INCREASING** | 1MIN, 5MIN, 15MIN, 1HR, 4H | +5% | 4H fails: ❌ No Trigger |
| **DECREASING** | 5MIN, 15MIN, 1HR | -3% | All pass: ✅ Trigger |
| **ABOVE** | 5MIN, 15MIN, 1HR | (no %) | All pass: ✅ Trigger |
| **ABOVE** | 5MIN, 15MIN, 1HR | (no %) | 1HR fails: ❌ No Trigger |
| **BELOW** | 5MIN, 15MIN | (no %) | All pass: ✅ Trigger |

---

## 🎯 Key Rules

1. **ALL timeframes must pass** - Agar ek bhi fail ho, condition fail
2. **Baseline updates** - Har timeframe interval ke baad baseline update hota hai
3. **Binance Futures API** - Open Interest data Binance Futures se fetch hota hai
4. **Percentage calculation** - `((Current - Baseline) / Baseline) × 100`
5. **Timeframe intervals** - Baseline har timeframe interval par update hota hai

---

## ⚠️ Important Notes

1. **Baseline Open Interest**: Alert creation time par set hota hai
2. **Timeframe-based baseline**: Har timeframe ka apna baseline track hota hai
3. **Automatic baseline update**: Timeframe interval ke baad baseline automatically update hota hai
4. **Missing Data**: Agar fetch fail ho to condition skip hoti hai
5. **ALL Must Pass**: Sabhi selected timeframes mein condition meet honi chahiye
6. **Percentage Change**: Percentage field mein jo value di hai, wahi minimum change required hai
   - Example: 5% diya hai to Open Interest ko baseline se kam se kam 5% change hona chahiye
   - INCREASING: Change >= percentage (e.g., +6% >= 5% ✅)
   - DECREASING: Change <= -percentage (e.g., -6% <= -5% ✅)
   - ABOVE: Change >= percentage (if percentage provided)
   - BELOW: Change <= -percentage (if percentage provided)

---

## 🔄 Baseline Update Logic

### Example: 5MIN Timeframe

**10:00 AM - Alert Created:**
```
Baseline OI: 1,000,000 BTC
```

**10:05 AM - First 5MIN Interval:**
```
Current OI: 1,050,000 BTC
Baseline OI: 1,000,000 BTC (unchanged)
Change: +5%
```

**10:10 AM - Second 5MIN Interval:**
```
Previous Current OI: 1,050,000 BTC (becomes new baseline)
Current OI: 1,060,000 BTC
Baseline OI: 1,050,000 BTC (updated)
Change: +0.95% (from new baseline)
```

**10:15 AM - Third 5MIN Interval:**
```
Previous Current OI: 1,060,000 BTC (becomes new baseline)
Current OI: 1,055,000 BTC
Baseline OI: 1,060,000 BTC (updated)
Change: -0.47% (from new baseline)
```

This ensures that Open Interest changes are tracked relative to the most recent timeframe interval, not just the original alert creation time.

