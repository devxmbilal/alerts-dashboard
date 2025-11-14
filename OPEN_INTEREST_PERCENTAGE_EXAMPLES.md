# Open Interest Percentage Change Examples

## 📊 How Percentage Change Works

### Formula:
```
OI Change % = ((Current OI - Baseline OI) / Baseline OI) × 100
```

### Condition Check:
- **INCREASING**: `OI Change >= Required Percentage`
- **DECREASING**: `OI Change <= -Required Percentage`
- **ABOVE**: `OI Change >= Required Percentage` (if percentage provided)
- **BELOW**: `OI Change <= -Required Percentage` (if percentage provided)

---

## ✅ Example 1: INCREASING by 5% - PASSES

### Setup:
- Baseline Open Interest: 1,000,000 BTC
- Required Percentage: 5%
- Condition: INCREASING

### Current Market:
```
Current Open Interest: 1,060,000 BTC
```

### Calculation:
```
OI Change = ((1,060,000 - 1,000,000) / 1,000,000) × 100
          = (60,000 / 1,000,000) × 100
          = 6%
```

### Check:
```
Required: 5% increase
Actual: 6% increase
6% >= 5%? TRUE ✅
```

### Result:
```
✅ Condition PASSED
Open Interest increased by 6%, which is >= required 5%
```

---

## ❌ Example 2: INCREASING by 5% - FAILS

### Setup:
- Baseline Open Interest: 1,000,000 BTC
- Required Percentage: 5%
- Condition: INCREASING

### Current Market:
```
Current Open Interest: 1,040,000 BTC
```

### Calculation:
```
OI Change = ((1,040,000 - 1,000,000) / 1,000,000) × 100
          = (40,000 / 1,000,000) × 100
          = 4%
```

### Check:
```
Required: 5% increase
Actual: 4% increase
4% >= 5%? FALSE ❌
```

### Result:
```
❌ Condition FAILED
Open Interest increased by only 4%, which is < required 5%
```

---

## ✅ Example 3: DECREASING by 3% - PASSES

### Setup:
- Baseline Open Interest: 1,000,000 BTC
- Required Percentage: 3%
- Condition: DECREASING

### Current Market:
```
Current Open Interest: 970,000 BTC
```

### Calculation:
```
OI Change = ((970,000 - 1,000,000) / 1,000,000) × 100
          = (-30,000 / 1,000,000) × 100
          = -3%
```

### Check:
```
Required: -3% decrease (or more)
Actual: -3% decrease
-3% <= -3%? TRUE ✅
```

### Result:
```
✅ Condition PASSED
Open Interest decreased by 3%, which meets required 3% decrease
```

---

## ❌ Example 4: DECREASING by 3% - FAILS

### Setup:
- Baseline Open Interest: 1,000,000 BTC
- Required Percentage: 3%
- Condition: DECREASING

### Current Market:
```
Current Open Interest: 980,000 BTC
```

### Calculation:
```
OI Change = ((980,000 - 1,000,000) / 1,000,000) × 100
          = (-20,000 / 1,000,000) × 100
          = -2%
```

### Check:
```
Required: -3% decrease (or more)
Actual: -2% decrease
-2% <= -3%? FALSE ❌
```

### Result:
```
❌ Condition FAILED
Open Interest decreased by only 2%, which is < required 3% decrease
```

---

## ✅ Example 5: ABOVE by 5% - PASSES

### Setup:
- Baseline Open Interest: 1,000,000 BTC
- Required Percentage: 5%
- Condition: ABOVE

### Current Market:
```
Current Open Interest: 1,060,000 BTC
```

### Calculation:
```
OI Change = ((1,060,000 - 1,000,000) / 1,000,000) × 100
          = 6%
```

### Check:
```
Required: 5% above baseline
Actual: 6% above baseline
6% >= 5%? TRUE ✅
```

### Result:
```
✅ Condition PASSED
Open Interest is 6% above baseline, which is >= required 5%
```

---

## ❌ Example 6: ABOVE by 5% - FAILS

### Setup:
- Baseline Open Interest: 1,000,000 BTC
- Required Percentage: 5%
- Condition: ABOVE

### Current Market:
```
Current Open Interest: 1,040,000 BTC
```

### Calculation:
```
OI Change = ((1,040,000 - 1,000,000) / 1,000,000) × 100
          = 4%
```

### Check:
```
Required: 5% above baseline
Actual: 4% above baseline
4% >= 5%? FALSE ❌
```

### Result:
```
❌ Condition FAILED
Open Interest is only 4% above baseline, which is < required 5%
```

---

## ✅ Example 7: BELOW by 3% - PASSES

### Setup:
- Baseline Open Interest: 1,000,000 BTC
- Required Percentage: 3%
- Condition: BELOW

### Current Market:
```
Current Open Interest: 970,000 BTC
```

### Calculation:
```
OI Change = ((970,000 - 1,000,000) / 1,000,000) × 100
          = -3%
```

### Check:
```
Required: 3% below baseline (or more)
Actual: -3% below baseline
-3% <= -3%? TRUE ✅
```

### Result:
```
✅ Condition PASSED
Open Interest is 3% below baseline, which meets required 3% decrease
```

---

## 📊 Multi-Timeframe Example with Percentage

### Alert Setup:
- Open Interest Condition: INCREASING by 5%
- Timeframes: 5MIN, 15MIN, 1HR
- Baseline Open Interest: 1,000,000 BTC

### Check Process:

#### Timeframe 5MIN:
```
Current OI: 1,060,000 BTC
Baseline OI: 1,000,000 BTC
OI Change: +6%
Required: +5%
6% >= 5%? ✅ PASS
```

#### Timeframe 15MIN:
```
Current OI: 1,055,000 BTC
Baseline OI: 1,000,000 BTC
OI Change: +5.5%
Required: +5%
5.5% >= 5%? ✅ PASS
```

#### Timeframe 1HR:
```
Current OI: 1,040,000 BTC
Baseline OI: 1,000,000 BTC
OI Change: +4%
Required: +5%
4% >= 5%? ❌ FAIL
```

### Result:
```
✅ 5MIN PASSED (6% >= 5%)
✅ 15MIN PASSED (5.5% >= 5%)
❌ 1HR FAILED (4% < 5%)
❌ Overall Condition FAILED (one timeframe failed)
```

---

## 🎯 Key Points

1. **Percentage = Minimum Change Required**
   - Agar 5% diya hai, to Open Interest ko baseline se kam se kam 5% change hona chahiye
   - Exact 5% ya usse zyada change = ✅ PASS
   - 5% se kam change = ❌ FAIL

2. **INCREASING Condition:**
   - `OI Change >= Required Percentage`
   - Example: 5% required, 6% actual = ✅ PASS
   - Example: 5% required, 4% actual = ❌ FAIL

3. **DECREASING Condition:**
   - `OI Change <= -Required Percentage`
   - Example: 3% required, -3% actual = ✅ PASS
   - Example: 3% required, -2% actual = ❌ FAIL

4. **ABOVE Condition (with percentage):**
   - `OI Change >= Required Percentage`
   - Same as INCREASING

5. **BELOW Condition (with percentage):**
   - `OI Change <= -Required Percentage`
   - Same as DECREASING

6. **Multi-Timeframe:**
   - Sabhi selected timeframes mein required percentage change hona chahiye
   - Agar ek bhi timeframe mein percentage requirement meet nahi hoti, condition fail

---

## 📝 Summary

**Percentage field ka matlab:**
- Jo percentage di hai, wahi **minimum change** required hai
- Open Interest ko baseline se **exactly that percentage ya usse zyada** change hona chahiye
- Example: 5% diya hai to:
  - INCREASING: +5% ya zyada = ✅
  - DECREASING: -5% ya zyada = ✅
  - 5% se kam change = ❌

