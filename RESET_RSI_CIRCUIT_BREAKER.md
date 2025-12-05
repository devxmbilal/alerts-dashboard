# 🛡️ RSI Circuit Breaker Reset Guide

## Problem
RSI circuit breaker activate ho gaya hai aur alerts miss ho rahe hain:
```
⚠️ RSI circuit breaker active for SXTUSDT_5MIN (5 failures)
❌ Timeframe 5MIN: RSI data not available, FAILING condition
```

## ✅ Solutions

### **Solution 1: Automatic Reset (Wait 10 Minutes)**
Circuit breaker automatically reset ho jayega 10 minutes ke baad.

### **Solution 2: Manual Reset via Redis**
Redis CLI se manually reset karein:

```bash
# Redis CLI open karein
redis-cli

# System control message send karein
PUBLISH system:control '{"command":"reset_rsi_circuit_breaker"}'

# Ya complete RSI ban reset karein (queue bhi clear hoga)
PUBLISH system:control '{"command":"reset_rsi_ban"}'
```

### **Solution 3: Node.js Script**
Quick reset script:

```javascript
// reset-rsi.js
import Redis from 'ioredis';

const redis = new Redis({
  host: 'localhost',
  port: 6379
});

// Reset circuit breaker
await redis.publish('system:control', JSON.stringify({
  command: 'reset_rsi_circuit_breaker'
}));

console.log('✅ RSI circuit breaker reset command sent');
await redis.quit();
```

Run karein:
```bash
node reset-rsi.js
```

### **Solution 4: Restart Worker**
Worker restart karne se sab kuch reset ho jayega:

```bash
# Worker stop karein (Ctrl+C)
# Phir restart karein
npm run worker
```

## 🔍 Check Circuit Breaker Status

### Via Logs
Worker logs mein dekhein:
```
⚠️ RSI circuit breaker active for SYMBOL_TIMEFRAME (X failures)
```

### Via Redis
```bash
redis-cli
PUBLISH system:control '{"command":"get_stats"}'
SUBSCRIBE system:stats
```

## 📊 Understanding Circuit Breaker

### Why It Activates
- **5 consecutive failures** for same symbol+timeframe
- Prevents infinite retry loops
- Protects against API rate limits

### What Happens
- RSI calculation skipped for that pair
- Alert condition evaluation continues for other pairs
- **Alert will NOT trigger** if RSI condition is set

### Auto-Reset
- **10 minutes** after last failure
- Automatic retry after cooldown
- No manual intervention needed

## 🚀 Improved Features

### 1. **Auto-Reset After 10 Minutes**
```javascript
// Circuit breaker automatically resets
if (failures >= 5 && timeSinceLastFailure >= 10 * 60 * 1000) {
  console.log(`🔄 RSI circuit breaker reset for ${key} after 10 minutes`);
  this.rsiFailures.delete(failureKey);
}
```

### 2. **Graceful Degradation**
```javascript
// If RSI data not available, skip that timeframe
if (!rsiData || rsiData.current === null) {
  console.log(`⚠️ Timeframe ${timeframe}: RSI data not available (queued for fetch)`);
  continue; // Don't fail entire alert
}
```

### 3. **Partial Success**
```javascript
// Alert can trigger if SOME timeframes have data
if (availableTimeframes === 0) {
  return false; // No data, skip for now
}

// All AVAILABLE timeframes must pass
return passedTimeframes === availableTimeframes;
```

## 🎯 Best Practices

### 1. **Use Multiple Timeframes Carefully**
- More timeframes = more API calls
- Start with 1-2 timeframes
- Add more only if needed

### 2. **Monitor Circuit Breaker**
```bash
# Check logs regularly
tail -f worker.log | grep "circuit breaker"
```

### 3. **Use VPN if Needed**
- If circuit breaker activates frequently
- Binance may be rate limiting your IP
- VPN can help avoid 418 errors

### 4. **Avoid Low-Volume Pairs**
- Some pairs have limited data
- Stick to popular pairs (BTC, ETH, BNB)
- Check pair availability on Binance

## 📝 Example: Good vs Bad Configuration

### ❌ Bad (Too Many Timeframes)
```javascript
{
  rsiRange: {
    timeframes: ['1MIN', '5MIN', '15MIN', '1HR', '4HR'], // 5 timeframes!
    condition: 'ABOVE',
    level: 70,
    period: 14
  }
}
```

### ✅ Good (Optimal Timeframes)
```javascript
{
  rsiRange: {
    timeframes: ['5MIN', '15MIN'], // 2 timeframes only
    condition: 'ABOVE',
    level: 70,
    period: 14
  }
}
```

## 🆘 Still Having Issues?

### Check These:
1. **Internet Connection** - Stable hai?
2. **Binance API Status** - https://www.binance.com/en/support/announcement
3. **Redis Running** - `redis-cli ping` should return `PONG`
4. **Worker Running** - `npm run worker` active hai?
5. **VPN/Proxy** - Try different network

### Get Help:
1. Check worker logs: `tail -f worker.log`
2. Check Redis: `redis-cli MONITOR`
3. Test Binance API: `curl https://api.binance.com/api/v3/ping`

---

**Happy Trading! 🚀**
