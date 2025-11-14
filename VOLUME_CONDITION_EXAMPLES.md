# Volume Condition Examples - Multi-Timeframe Scenarios

## 📋 Volume Condition Setup

**Alert Configuration:**
- Symbol: BTCUSDT
- Volume Condition: INCREASING by 10%
- Timeframes: 5MIN, 15MIN, 1HR
- Baseline Volume: 1,000,000 USDT (when alert was created)

---

## ✅ Scenario 1: Alert TRIGGERS (All Timeframes Pass)

### Current Market Data:
```
Baseline Volume: 1,000,000 USDT (from alert creation)
```

### Condition Check:

#### Timeframe 5MIN:
```
Current Candle Volume: 1,150,000 USDT
Baseline Volume: 1,000,000 USDT

Volume Change = ((1,150,000 - 1,000,000) / 1,000,000) × 100
              = (150,000 / 1,000,000) × 100
              = 15%

Required: 10% increase
Actual: 15% increase
15% >= 10%? TRUE ✅
```

#### Timeframe 15MIN:
```
Current Candle Volume: 1,120,000 USDT
Baseline Volume: 1,000,000 USDT

Volume Change = ((1,120,000 - 1,000,000) / 1,000,000) × 100
              = 12%

Required: 10% increase
Actual: 12% increase
12% >= 10%? TRUE ✅
```

#### Timeframe 1HR:
```
Current Candle Volume: 1,110,000 USDT
Baseline Volume: 1,000,000 USDT

Volume Change = ((1,110,000 - 1,000,000) / 1,000,000) × 100
              = 11%

Required: 10% increase
Actual: 11% increase
11% >= 10%? TRUE ✅
```

### Result:
```
✅✅✅ ALL TIMEFRAMES PASSED!
📈 Volume condition PASSED: INCREASING met for all timeframes
🚨 ALERT TRIGGERED! (if other conditions also pass)
```

---

## ❌ Scenario 2: Alert FAILS - One Timeframe Failed

### Current Market Data:
```
Baseline Volume: 1,000,000 USDT
```

### Condition Check:

#### Timeframe 5MIN: ✅
```
Current Candle Volume: 1,150,000 USDT
Volume Change: 15%
15% >= 10%? TRUE ✅
```

#### Timeframe 15MIN: ✅
```
Current Candle Volume: 1,120,000 USDT
Volume Change: 12%
12% >= 10%? TRUE ✅
```

#### Timeframe 1HR: ❌
```
Current Candle Volume: 1,080,000 USDT
Baseline Volume: 1,000,000 USDT

Volume Change = ((1,080,000 - 1,000,000) / 1,000,000) × 100
              = 8%

Required: 10% increase
Actual: 8% increase
8% >= 10%? FALSE ❌
```

### Result:
```
✅ 5MIN PASSED
✅ 15MIN PASSED
❌ 1HR FAILED (8% < 10%)
❌ Volume condition FAILED: INCREASING not met for 1HR timeframe
❌ ALERT NOT TRIGGERED
```

---

## ✅ Scenario 3: DECREASING Condition - All Pass

### Alert Configuration:
- Volume Condition: DECREASING by 15%
- Timeframes: 5MIN, 15MIN
- Baseline Volume: 1,000,000 USDT

### Condition Check:

#### Timeframe 5MIN:
```
Current Candle Volume: 840,000 USDT
Baseline Volume: 1,000,000 USDT

Volume Change = ((840,000 - 1,000,000) / 1,000,000) × 100
              = -16%

Required: -15% (decrease)
Actual: -16% (decrease)
-16% <= -15%? TRUE ✅
```

#### Timeframe 15MIN:
```
Current Candle Volume: 830,000 USDT
Baseline Volume: 1,000,000 USDT

Volume Change = ((830,000 - 1,000,000) / 1,000,000) × 100
              = -17%

Required: -15% (decrease)
Actual: -17% (decrease)
-17% <= -15%? TRUE ✅
```

### Result:
```
✅✅ ALL TIMEFRAMES PASSED!
📉 Volume condition PASSED: DECREASING met for all timeframes
```

---

## ✅ Scenario 4: ABOVE Condition - All Pass

### Alert Configuration:
- Volume Condition: ABOVE 1,200,000 USDT
- Timeframes: 5MIN, 15MIN, 1HR

### Condition Check:

#### Timeframe 5MIN:
```
Current Candle Volume: 1,350,000 USDT
Required: > 1,200,000 USDT
1,350,000 > 1,200,000? TRUE ✅
```

#### Timeframe 15MIN:
```
Current Candle Volume: 1,280,000 USDT
Required: > 1,200,000 USDT
1,280,000 > 1,200,000? TRUE ✅
```

#### Timeframe 1HR:
```
Current Candle Volume: 1,250,000 USDT
Required: > 1,200,000 USDT
1,250,000 > 1,200,000? TRUE ✅
```

### Result:
```
✅✅✅ ALL TIMEFRAMES PASSED!
📈 Volume condition PASSED: ABOVE met for all timeframes
```

---

## ❌ Scenario 5: ABOVE Condition - One Failed

### Alert Configuration:
- Volume Condition: ABOVE 1,200,000 USDT
- Timeframes: 5MIN, 15MIN, 1HR

### Condition Check:

#### Timeframe 5MIN: ✅
```
Current Candle Volume: 1,350,000 USDT
1,350,000 > 1,200,000? TRUE ✅
```

#### Timeframe 15MIN: ✅
```
Current Candle Volume: 1,280,000 USDT
1,280,000 > 1,200,000? TRUE ✅
```

#### Timeframe 1HR: ❌
```
Current Candle Volume: 1,150,000 USDT
Required: > 1,200,000 USDT
1,150,000 > 1,200,000? FALSE ❌
```

### Result:
```
✅ 5MIN PASSED
✅ 15MIN PASSED
❌ 1HR FAILED (1,150,000 < 1,200,000)
❌ Volume condition FAILED
```

---

## ✅ Scenario 6: BELOW Condition - All Pass

### Alert Configuration:
- Volume Condition: BELOW 800,000 USDT
- Timeframes: 5MIN, 15MIN

### Condition Check:

#### Timeframe 5MIN:
```
Current Candle Volume: 750,000 USDT
Required: < 800,000 USDT
750,000 < 800,000? TRUE ✅
```

#### Timeframe 15MIN:
```
Current Candle Volume: 780,000 USDT
Required: < 800,000 USDT
780,000 < 800,000? TRUE ✅
```

### Result:
```
✅✅ ALL TIMEFRAMES PASSED!
📉 Volume condition PASSED: BELOW met for all timeframes
```

---

## 📊 Complete Example Flow

### Alert Setup:
```
Symbol: BTCUSDT
Volume Condition: INCREASING by 10%
Timeframes: 5MIN, 15MIN, 1HR
Baseline Volume: 1,000,000 USDT (set at alert creation)
```

### Check Process:

```
1. Check Timeframe 5MIN
   📈 Fetch candle volume from Binance
   Current Volume: 1,150,000
   Baseline: 1,000,000
   Change: +15%
   Required: +10%
   15% >= 10%? ✅ PASS

2. Check Timeframe 15MIN
   📈 Fetch candle volume from Binance
   Current Volume: 1,120,000
   Baseline: 1,000,000
   Change: +12%
   Required: +10%
   12% >= 10%? ✅ PASS

3. Check Timeframe 1HR
   📈 Fetch candle volume from Binance
   Current Volume: 1,110,000
   Baseline: 1,000,000
   Change: +11%
   Required: +10%
   11% >= 10%? ✅ PASS

Result: ✅✅✅ ALL TIMEFRAMES PASSED!
Volume condition: PASSED
```

---

## 🔄 Real-Time Flow Example

### Timeline:

**10:00 AM - Alert Created:**
```
Baseline Volume: 1,000,000 USDT
```

**10:05 AM - First Check:**
```
5MIN Candle Volume: 1,150,000 (+15%) ✅
15MIN Candle Volume: 1,120,000 (+12%) ✅
1HR Candle Volume: 1,110,000 (+11%) ✅

Result: ✅ ALL PASSED - Alert can trigger
```

**10:10 AM - Second Check:**
```
5MIN Candle Volume: 1,080,000 (+8%) ❌
15MIN Candle Volume: 1,120,000 (+12%) ✅
1HR Candle Volume: 1,110,000 (+11%) ✅

Result: ❌ 5MIN FAILED - Alert won't trigger
```

**10:15 AM - Third Check:**
```
5MIN Candle Volume: 1,130,000 (+13%) ✅
15MIN Candle Volume: 1,125,000 (+12.5%) ✅
1HR Candle Volume: 1,115,000 (+11.5%) ✅

Result: ✅ ALL PASSED - Alert can trigger again
```

---

## 📝 Summary Table

| Condition | Timeframes | Required | Example Result |
|-----------|-----------|----------|----------------|
| **INCREASING** | 5MIN, 15MIN, 1HR | +10% | All pass: ✅ Trigger |
| **INCREASING** | 5MIN, 15MIN, 1HR | +10% | 1HR fails: ❌ No Trigger |
| **DECREASING** | 5MIN, 15MIN | -15% | All pass: ✅ Trigger |
| **ABOVE** | 5MIN, 15MIN, 1HR | >1,200,000 | All pass: ✅ Trigger |
| **ABOVE** | 5MIN, 15MIN, 1HR | >1,200,000 | 1HR fails: ❌ No Trigger |
| **BELOW** | 5MIN, 15MIN | <800,000 | All pass: ✅ Trigger |

---

## 🎯 Key Rules

1. **ALL timeframes must pass** - Agar ek bhi fail ho, condition fail
2. **Volume from candle data** - Har timeframe ka apna candle volume use hota hai
3. **Baseline comparison** - INCREASING/DECREASING ke liye baseline volume compare hota hai
4. **Direct value comparison** - ABOVE/BELOW ke liye direct value check hota hai
5. **Binance integration** - Missing data ho to Binance se fetch karta hai

---

## ⚠️ Important Notes

1. **Baseline Volume**: Alert creation time par set hota hai
2. **Candle Volume**: Har timeframe ka separate candle volume hota hai
3. **Missing Data**: Agar candle data missing ho to Binance se fetch karta hai
4. **ALL Must Pass**: Sabhi selected timeframes mein condition meet honi chahiye
5. **Percentage Calculation**: `((Current - Baseline) / Baseline) × 100`

