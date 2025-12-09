# Alert Scenarios Test - Different Condition Combinations

## 📋 Test Alert Setup

**Symbol:** BTCUSDT  
**Baseline Price:** $100,000  
**Baseline Volume:** 1,000,000 USDT  
**Baseline Open Interest:** 1,000,000 BTC

---

## ✅ Scenario 1: 2 Conditions

### Alert Configuration:
```
1. Min Daily Volume: 1,000,000 USDT
2. Change Percent: 2% increase (5MIN timeframe)
```

### Test Case 1.1: Alert TRIGGERS ✅

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
```

**Result:** 🚨 **ALERT TRIGGERED** (Both conditions passed)

---

### Test Case 1.2: Alert FAILS ❌

**Market Data:**
```
Current Price: $101,500
24h Volume: 2,500,000 USDT
Price Change: +1.5%
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
❌ Change Percent: +1.5% < 2% ❌ FAIL
```

**Result:** ❌ **ALERT NOT TRIGGERED** (Change % condition failed)

---

### Test Case 1.3: Alert FAILS ❌

**Market Data:**
```
Current Price: $102,500
24h Volume: 800,000 USDT
Price Change: +2.5%
```

**Condition Check:**
```
❌ Min Daily Volume: 800,000 < 1,000,000 ❌ FAIL
✅ Change Percent: +2.5% >= 2% ✅ PASS
```

**Result:** ❌ **ALERT NOT TRIGGERED** (Min Daily Volume condition failed)

---

## ✅ Scenario 2: 3 Conditions

### Alert Configuration:
```
1. Min Daily Volume: 1,000,000 USDT
2. Change Percent: 2% increase (5MIN timeframe)
3. Alert Count: 5MIN (not locked)
```

### Test Case 2.1: Alert TRIGGERS ✅

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
Alert Lock Status: Not locked
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
✅ Alert Count: Not locked ✅ PASS
```

**Result:** 🚨 **ALERT TRIGGERED** (All 3 conditions passed)

---

### Test Case 2.2: Alert FAILS ❌ (Locked)

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
Alert Lock Status: LOCKED until 10:05 AM (current time: 10:03 AM)
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
❌ Alert Count: Alert locked for 2 minutes ❌ FAIL
```

**Result:** ❌ **ALERT NOT TRIGGERED** (Alert is locked)

---

### Test Case 2.3: Alert FAILS ❌ (Change % failed)

**Market Data:**
```
Current Price: $101,500
24h Volume: 2,500,000 USDT
Price Change: +1.5%
Alert Lock Status: Not locked
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
❌ Change Percent: +1.5% < 2% ❌ FAIL
✅ Alert Count: Not locked ✅ PASS
```

**Result:** ❌ **ALERT NOT TRIGGERED** (Change % condition failed)

---

## ✅ Scenario 3: 4 Conditions

### Alert Configuration:
```
1. Min Daily Volume: 1,000,000 USDT
2. Change Percent: 2% increase (5MIN timeframe)
3. Alert Count: 5MIN (not locked)
4. Candle Above Open: 5MIN, 15MIN, 1HR
```

### Test Case 3.1: Alert TRIGGERS ✅

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
Alert Lock Status: Not locked

Candle Data:
- 5MIN: Close $102,500 > Open $100,000 ✅
- 15MIN: Close $102,000 > Open $100,000 ✅
- 1HR: Close $101,800 > Open $100,000 ✅
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
✅ Alert Count: Not locked ✅ PASS
✅ Candle Above Open: ALL timeframes (5MIN, 15MIN, 1HR) ✅ PASS
```

**Result:** 🚨 **ALERT TRIGGERED** (All 4 conditions passed)

---

### Test Case 3.2: Alert FAILS ❌ (Candle condition failed)

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
Alert Lock Status: Not locked

Candle Data:
- 5MIN: Close $102,500 > Open $100,000 ✅
- 15MIN: Close $102,000 > Open $100,000 ✅
- 1HR: Close $99,500 < Open $100,000 ❌
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
✅ Alert Count: Not locked ✅ PASS
❌ Candle Above Open: 1HR timeframe FAILED (Close < Open) ❌ FAIL
```

**Result:** ❌ **ALERT NOT TRIGGERED** (Candle condition failed - 1HR timeframe)

---

### Test Case 3.3: Alert FAILS ❌ (Change % failed)

**Market Data:**
```
Current Price: $101,500
24h Volume: 2,500,000 USDT
Price Change: +1.5%
Alert Lock Status: Not locked

Candle Data:
- 5MIN: Close $101,500 > Open $100,000 ✅
- 15MIN: Close $101,200 > Open $100,000 ✅
- 1HR: Close $101,000 > Open $100,000 ✅
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
❌ Change Percent: +1.5% < 2% ❌ FAIL
✅ Alert Count: Not locked ✅ PASS
✅ Candle Above Open: ALL timeframes ✅ PASS
```

**Result:** ❌ **ALERT NOT TRIGGERED** (Change % condition failed)

---

## ✅ Scenario 4: 5 Conditions

### Alert Configuration:
```
1. Min Daily Volume: 1,000,000 USDT
2. Change Percent: 2% increase (5MIN timeframe)
3. Alert Count: 5MIN (not locked)
4. Candle Above Open: 5MIN, 15MIN, 1HR
5. RSI: > 50 (5MIN, 15MIN)
```

### Test Case 4.1: Alert TRIGGERS ✅

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
Alert Lock Status: Not locked

Candle Data:
- 5MIN: Close $102,500 > Open $100,000 ✅
- 15MIN: Close $102,000 > Open $100,000 ✅
- 1HR: Close $101,800 > Open $100,000 ✅

RSI Data:
- 5MIN: RSI = 55 > 50 ✅
- 15MIN: RSI = 52 > 50 ✅
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
✅ Alert Count: Not locked ✅ PASS
✅ Candle Above Open: ALL timeframes ✅ PASS
✅ RSI: ALL timeframes (5MIN, 15MIN) RSI > 50 ✅ PASS
```

**Result:** 🚨 **ALERT TRIGGERED** (All 5 conditions passed)

---

### Test Case 4.2: Alert FAILS ❌ (RSI condition failed)

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
Alert Lock Status: Not locked

Candle Data:
- 5MIN: Close $102,500 > Open $100,000 ✅
- 15MIN: Close $102,000 > Open $100,000 ✅
- 1HR: Close $101,800 > Open $100,000 ✅

RSI Data:
- 5MIN: RSI = 55 > 50 ✅
- 15MIN: RSI = 48 < 50 ❌
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
✅ Alert Count: Not locked ✅ PASS
✅ Candle Above Open: ALL timeframes ✅ PASS
❌ RSI: 15MIN timeframe FAILED (RSI 48 < 50) ❌ FAIL
```

**Result:** ❌ **ALERT NOT TRIGGERED** (RSI condition failed - 15MIN timeframe)

---

### Test Case 4.3: Alert FAILS ❌ (Candle condition failed)

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
Alert Lock Status: Not locked

Candle Data:
- 5MIN: Close $102,500 > Open $100,000 ✅
- 15MIN: Close $99,800 < Open $100,000 ❌
- 1HR: Close $101,800 > Open $100,000 ✅

RSI Data:
- 5MIN: RSI = 55 > 50 ✅
- 15MIN: RSI = 52 > 50 ✅
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
✅ Alert Count: Not locked ✅ PASS
❌ Candle Above Open: 15MIN timeframe FAILED ❌ FAIL
✅ RSI: ALL timeframes ✅ PASS
```

**Result:** ❌ **ALERT NOT TRIGGERED** (Candle condition failed)

---

## ✅ Scenario 5: 6 Conditions

### Alert Configuration:
```
1. Min Daily Volume: 1,000,000 USDT
2. Change Percent: 2% increase (5MIN timeframe)
3. Alert Count: 5MIN (not locked)
4. Candle Above Open: 5MIN, 15MIN, 1HR
5. RSI: > 50 (5MIN, 15MIN)
6. Volume: INCREASING by 10% (5MIN, 15MIN, 1HR)
```

### Test Case 5.1: Alert TRIGGERS ✅

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
Alert Lock Status: Not locked

Candle Data:
- 5MIN: Close $102,500 > Open $100,000 ✅
- 15MIN: Close $102,000 > Open $100,000 ✅
- 1HR: Close $101,800 > Open $100,000 ✅

RSI Data:
- 5MIN: RSI = 55 > 50 ✅
- 15MIN: RSI = 52 > 50 ✅

Volume Data (Baseline: 1,000,000 USDT):
- 5MIN: Current 1,150,000, Change +15% >= 10% ✅
- 15MIN: Current 1,120,000, Change +12% >= 10% ✅
- 1HR: Current 1,110,000, Change +11% >= 10% ✅
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
✅ Alert Count: Not locked ✅ PASS
✅ Candle Above Open: ALL timeframes ✅ PASS
✅ RSI: ALL timeframes (5MIN, 15MIN) RSI > 50 ✅ PASS
✅ Volume: ALL timeframes (5MIN, 15MIN, 1HR) change >= 10% ✅ PASS
```

**Result:** 🚨 **ALERT TRIGGERED** (All 6 conditions passed)

---

### Test Case 5.2: Alert FAILS ❌ (Volume condition failed)

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
Alert Lock Status: Not locked

Candle Data:
- 5MIN: Close $102,500 > Open $100,000 ✅
- 15MIN: Close $102,000 > Open $100,000 ✅
- 1HR: Close $101,800 > Open $100,000 ✅

RSI Data:
- 5MIN: RSI = 55 > 50 ✅
- 15MIN: RSI = 52 > 50 ✅

Volume Data (Baseline: 1,000,000 USDT):
- 5MIN: Current 1,150,000, Change +15% >= 10% ✅
- 15MIN: Current 1,120,000, Change +12% >= 10% ✅
- 1HR: Current 1,080,000, Change +8% < 10% ❌
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
✅ Alert Count: Not locked ✅ PASS
✅ Candle Above Open: ALL timeframes ✅ PASS
✅ RSI: ALL timeframes ✅ PASS
❌ Volume: 1HR timeframe FAILED (Change +8% < 10%) ❌ FAIL
```

**Result:** ❌ **ALERT NOT TRIGGERED** (Volume condition failed - 1HR timeframe)

---

### Test Case 5.3: Alert FAILS ❌ (RSI condition failed)

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
Alert Lock Status: Not locked

Candle Data:
- 5MIN: Close $102,500 > Open $100,000 ✅
- 15MIN: Close $102,000 > Open $100,000 ✅
- 1HR: Close $101,800 > Open $100,000 ✅

RSI Data:
- 5MIN: RSI = 55 > 50 ✅
- 15MIN: RSI = 48 < 50 ❌

Volume Data (Baseline: 1,000,000 USDT):
- 5MIN: Current 1,150,000, Change +15% >= 10% ✅
- 15MIN: Current 1,120,000, Change +12% >= 10% ✅
- 1HR: Current 1,110,000, Change +11% >= 10% ✅
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
✅ Alert Count: Not locked ✅ PASS
✅ Candle Above Open: ALL timeframes ✅ PASS
❌ RSI: 15MIN timeframe FAILED (RSI 48 < 50) ❌ FAIL
✅ Volume: ALL timeframes ✅ PASS
```

**Result:** ❌ **ALERT NOT TRIGGERED** (RSI condition failed)

---

## ✅ Scenario 6: 7 Conditions (ALL CONDITIONS)

### Alert Configuration:
```
1. Min Daily Volume: 1,000,000 USDT
2. Change Percent: 2% increase (5MIN timeframe)
3. Alert Count: 5MIN (not locked)
4. Candle Above Open: 5MIN, 15MIN, 1HR
5. RSI: > 50 (5MIN, 15MIN)
6. Volume: INCREASING by 10% (5MIN, 15MIN, 1HR)
7. Open Interest: INCREASING by 5% (1MIN, 5MIN, 15MIN, 1HR, 4H)
```

### Test Case 6.1: Alert TRIGGERS ✅ (ALL CONDITIONS PASS)

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
Alert Lock Status: Not locked

Candle Data:
- 5MIN: Close $102,500 > Open $100,000 ✅
- 15MIN: Close $102,000 > Open $100,000 ✅
- 1HR: Close $101,800 > Open $100,000 ✅

RSI Data:
- 5MIN: RSI = 55 > 50 ✅
- 15MIN: RSI = 52 > 50 ✅

Volume Data (Baseline: 1,000,000 USDT):
- 5MIN: Current 1,150,000, Change +15% >= 10% ✅
- 15MIN: Current 1,120,000, Change +12% >= 10% ✅
- 1HR: Current 1,110,000, Change +11% >= 10% ✅

Open Interest Data (Baseline: 1,000,000 BTC):
- 1MIN: Current 1,060,000, Change +6% >= 5% ✅
- 5MIN: Current 1,055,000, Change +5.5% >= 5% ✅
- 15MIN: Current 1,052,000, Change +5.2% >= 5% ✅
- 1HR: Current 1,051,000, Change +5.1% >= 5% ✅
- 4H: Current 1,050,000, Change +5% >= 5% ✅
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
✅ Alert Count: Not locked ✅ PASS
✅ Candle Above Open: ALL timeframes ✅ PASS
✅ RSI: ALL timeframes (5MIN, 15MIN) RSI > 50 ✅ PASS
✅ Volume: ALL timeframes (5MIN, 15MIN, 1HR) change >= 10% ✅ PASS
✅ Open Interest: ALL timeframes (1MIN, 5MIN, 15MIN, 1HR, 4H) change >= 5% ✅ PASS
```

**Result:** 🚨 **ALERT TRIGGERED** (All 7 conditions passed)

---

### Test Case 6.2: Alert FAILS ❌ (Open Interest failed)

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
Alert Lock Status: Not locked

Candle Data:
- 5MIN: Close $102,500 > Open $100,000 ✅
- 15MIN: Close $102,000 > Open $100,000 ✅
- 1HR: Close $101,800 > Open $100,000 ✅

RSI Data:
- 5MIN: RSI = 55 > 50 ✅
- 15MIN: RSI = 52 > 50 ✅

Volume Data (Baseline: 1,000,000 USDT):
- 5MIN: Current 1,150,000, Change +15% >= 10% ✅
- 15MIN: Current 1,120,000, Change +12% >= 10% ✅
- 1HR: Current 1,110,000, Change +11% >= 10% ✅

Open Interest Data (Baseline: 1,000,000 BTC):
- 1MIN: Current 1,060,000, Change +6% >= 5% ✅
- 5MIN: Current 1,055,000, Change +5.5% >= 5% ✅
- 15MIN: Current 1,052,000, Change +5.2% >= 5% ✅
- 1HR: Current 1,051,000, Change +5.1% >= 5% ✅
- 4H: Current 1,040,000, Change +4% < 5% ❌
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
✅ Alert Count: Not locked ✅ PASS
✅ Candle Above Open: ALL timeframes ✅ PASS
✅ RSI: ALL timeframes ✅ PASS
✅ Volume: ALL timeframes ✅ PASS
❌ Open Interest: 4H timeframe FAILED (Change +4% < 5%) ❌ FAIL
```

**Result:** ❌ **ALERT NOT TRIGGERED** (Open Interest condition failed - 4H timeframe)

---

### Test Case 6.3: Alert FAILS ❌ (Volume failed)

**Market Data:**
```
Current Price: $102,500
24h Volume: 2,500,000 USDT
Price Change: +2.5%
Alert Lock Status: Not locked

Candle Data:
- 5MIN: Close $102,500 > Open $100,000 ✅
- 15MIN: Close $102,000 > Open $100,000 ✅
- 1HR: Close $101,800 > Open $100,000 ✅

RSI Data:
- 5MIN: RSI = 55 > 50 ✅
- 15MIN: RSI = 52 > 50 ✅

Volume Data (Baseline: 1,000,000 USDT):
- 5MIN: Current 1,150,000, Change +15% >= 10% ✅
- 15MIN: Current 1,120,000, Change +12% >= 10% ✅
- 1HR: Current 1,080,000, Change +8% < 10% ❌

Open Interest Data (Baseline: 1,000,000 BTC):
- 1MIN: Current 1,060,000, Change +6% >= 5% ✅
- 5MIN: Current 1,055,000, Change +5.5% >= 5% ✅
- 15MIN: Current 1,052,000, Change +5.2% >= 5% ✅
- 1HR: Current 1,051,000, Change +5.1% >= 5% ✅
- 4H: Current 1,050,000, Change +5% >= 5% ✅
```

**Condition Check:**
```
✅ Min Daily Volume: 2,500,000 >= 1,000,000 ✅ PASS
✅ Change Percent: +2.5% >= 2% (increase) ✅ PASS
✅ Alert Count: Not locked ✅ PASS
✅ Candle Above Open: ALL timeframes ✅ PASS
✅ RSI: ALL timeframes ✅ PASS
❌ Volume: 1HR timeframe FAILED (Change +8% < 10%) ❌ FAIL
✅ Open Interest: ALL timeframes ✅ PASS
```

**Result:** ❌ **ALERT NOT TRIGGERED** (Volume condition failed)

---

## 📊 Summary Table

| Scenario | Conditions | Passed | Failed | Result |
|----------|-----------|--------|--------|--------|
| 1.1 | 2 (Min Daily, Change %) | 2 | 0 | ✅ TRIGGERED |
| 1.2 | 2 (Min Daily, Change %) | 1 | 1 (Change %) | ❌ NOT TRIGGERED |
| 1.3 | 2 (Min Daily, Change %) | 1 | 1 (Min Daily) | ❌ NOT TRIGGERED |
| 2.1 | 3 (Min Daily, Change %, Alert Count) | 3 | 0 | ✅ TRIGGERED |
| 2.2 | 3 (Min Daily, Change %, Alert Count) | 2 | 1 (Alert Count) | ❌ NOT TRIGGERED |
| 2.3 | 3 (Min Daily, Change %, Alert Count) | 2 | 1 (Change %) | ❌ NOT TRIGGERED |
| 3.1 | 4 (Min Daily, Change %, Alert Count, Candle) | 4 | 0 | ✅ TRIGGERED |
| 3.2 | 4 (Min Daily, Change %, Alert Count, Candle) | 3 | 1 (Candle) | ❌ NOT TRIGGERED |
| 3.3 | 4 (Min Daily, Change %, Alert Count, Candle) | 3 | 1 (Change %) | ❌ NOT TRIGGERED |
| 4.1 | 5 (Min Daily, Change %, Alert Count, Candle, RSI) | 5 | 0 | ✅ TRIGGERED |
| 4.2 | 5 (Min Daily, Change %, Alert Count, Candle, RSI) | 4 | 1 (RSI) | ❌ NOT TRIGGERED |
| 4.3 | 5 (Min Daily, Change %, Alert Count, Candle, RSI) | 4 | 1 (Candle) | ❌ NOT TRIGGERED |
| 5.1 | 6 (Min Daily, Change %, Alert Count, Candle, RSI, Volume) | 6 | 0 | ✅ TRIGGERED |
| 5.2 | 6 (Min Daily, Change %, Alert Count, Candle, RSI, Volume) | 5 | 1 (Volume) | ❌ NOT TRIGGERED |
| 5.3 | 6 (Min Daily, Change %, Alert Count, Candle, RSI, Volume) | 5 | 1 (RSI) | ❌ NOT TRIGGERED |
| 6.1 | 7 (ALL CONDITIONS) | 7 | 0 | ✅ TRIGGERED |
| 6.2 | 7 (ALL CONDITIONS) | 6 | 1 (Open Interest) | ❌ NOT TRIGGERED |
| 6.3 | 7 (ALL CONDITIONS) | 6 | 1 (Volume) | ❌ NOT TRIGGERED |

---

## 🎯 Key Findings

### ✅ **Alert Triggers When:**
- **ALL** conditions pass
- No single condition fails
- All multi-timeframe conditions pass for ALL selected timeframes

### ❌ **Alert Does NOT Trigger When:**
- **ANY** single condition fails
- Even if 6 out of 7 conditions pass, alert won't trigger
- If ANY timeframe fails in multi-timeframe conditions, entire condition fails

### 📌 **Important Rules:**
1. **ALL must pass** - No exceptions
2. **Multi-timeframe = ALL timeframes must pass** - If one timeframe fails, condition fails
3. **Early exit** - System stops checking on first failure (performance optimization)
4. **No partial triggers** - Either all conditions pass or alert doesn't trigger

---

## 🔍 Testing Checklist

When testing alerts, verify:

- [ ] Min Daily Volume condition
- [ ] Change Percent condition (with direction)
- [ ] Alert Count condition (lock status)
- [ ] Candle Above Open condition (ALL timeframes)
- [ ] RSI condition (ALL timeframes)
- [ ] Volume condition (ALL timeframes)
- [ ] Open Interest condition (ALL timeframes)

**Remember:** If ANY condition fails, alert will NOT trigger! 🚫

