# 🚀 Production Deployment Guide - Hostinger VPS

## 🚨 **CRITICAL: Real-time Alerts Not Working on Server**

### **Root Cause:**
- Hardcoded `localhost` Redis configurations in API routes
- Missing environment variables in production
- Workers not starting properly

### **✅ FIXES APPLIED:**

#### **1. Fixed Hardcoded Redis Configurations**
- Updated `/app/api/market/stream/route.js`
- Updated `/app/api/market/pairs/route.js`
- Now uses `process.env.REDIS_HOST` and `process.env.REDIS_PORT`

#### **2. Updated PM2 Configuration**
- Added environment variables to `ecosystem.config.cjs`
- All workers now have proper Redis configuration

#### **3. Created Production Environment Template**
- `production.env.example` - Copy this to your server

## 🔧 **DEPLOYMENT STEPS:**

### **Step 1: Update Server Environment Variables**

Create `.env.local` on your server:
```bash
# On your Hostinger VPS
cd /var/www/alerts-dashboard
nano .env.local
```

Add these variables:
```env
# Database
MONGODB_URI=mongodb://localhost:27017/crypto-alerts

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT Secret (Change this!)
JWT_SECRET=your-super-secure-jwt-secret-key-here

# Telegram Bot (Optional)
TELEGRAM_BOT_TOKEN=your-telegram-bot-token-here

# Next.js Configuration
NODE_ENV=production
PORT=3000

# API URLs (Update with your domain)
NEXT_PUBLIC_API_URL=http://your-domain.com
NEXT_PUBLIC_DISABLE_REALTIME_NOTIFICATIONS=false
```

### **Step 2: Update PM2 Configuration**

Update `ecosystem.config.cjs` with your actual values:
```javascript
env: {
  NODE_ENV: "production",
  PORT: 3000,
  REDIS_HOST: "localhost",
  REDIS_PORT: 6379,
  MONGODB_URI: "mongodb://localhost:27017/crypto-alerts",
  JWT_SECRET: "your-actual-jwt-secret",
  TELEGRAM_BOT_TOKEN: "your-actual-telegram-token",
}
```

### **Step 3: Restart All Services**

```bash
# Stop all PM2 processes
pm2 stop all

# Delete all processes
pm2 delete all

# Start all processes with new config
pm2 start ecosystem.config.cjs

# Check status
pm2 status

# Check logs
pm2 logs
```

### **Step 4: Verify Services**

```bash
# Check if Redis is running
redis-cli ping
# Should return: PONG

# Check if MongoDB is running
mongo --eval "db.runCommand('ping')"
# Should return: { "ok" : 1 }

# Check if all PM2 processes are running
pm2 status
# Should show: alerts-dashboard, binance-worker, alert-worker, cleanup-worker
```

### **Step 5: Test Real-time Alerts**

1. **Open your dashboard** in browser
2. **Create an alert** with easy conditions (1% change)
3. **Check browser console** for connection logs:
   ```
   🔌 Connecting to alerts stream: http://your-domain.com/api/alerts/stream?userId=123
   ✅ EventSource connection opened successfully
   ```
4. **Check server logs**:
   ```bash
   pm2 logs alert-worker
   pm2 logs binance-worker
   ```

## 🔍 **DEBUGGING:**

### **Check Redis Connection:**
```bash
# Test Redis connection
redis-cli
> ping
> PONG
> subscribe alert:triggers
# Should show messages when alerts trigger
```

### **Check Worker Logs:**
```bash
# Check alert worker logs
pm2 logs alert-worker --lines 50

# Check binance worker logs
pm2 logs binance-worker --lines 50

# Check main app logs
pm2 logs alerts-dashboard --lines 50
```

### **Check Environment Variables:**
```bash
# Check if environment variables are loaded
pm2 show alerts-dashboard
# Look for env section
```

## 🚨 **Common Issues & Solutions:**

### **Issue 1: Redis Connection Failed**
```bash
# Solution: Start Redis service
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

### **Issue 2: Workers Not Starting**
```bash
# Solution: Check logs and restart
pm2 logs alert-worker
pm2 restart alert-worker
```

### **Issue 3: Environment Variables Not Loading**
```bash
# Solution: Restart PM2 with explicit env file
pm2 start ecosystem.config.cjs --env production
```

### **Issue 4: MongoDB Connection Failed**
```bash
# Solution: Start MongoDB service
sudo systemctl start mongod
sudo systemctl enable mongod
```

## 📊 **Expected Behavior After Fix:**

- ✅ **Real-time alerts** work without page refresh
- ✅ **Badge count** updates automatically (1, 2, 3...)
- ✅ **Chart switches** automatically on alert trigger
- ✅ **Header notifications** show immediately
- ✅ **Browser notifications** appear on desktop

## 🔧 **Quick Fix Commands:**

```bash
# 1. Update code on server
git pull origin main

# 2. Install dependencies
npm install

# 3. Build the app
npm run build

# 4. Restart all services
pm2 restart all

# 5. Check status
pm2 status
pm2 logs
```

## 📱 **Test Checklist:**

- [ ] Dashboard loads without errors
- [ ] Can create alerts
- [ ] Real-time badge count updates
- [ ] Chart switches on alert trigger
- [ ] Header notifications appear
- [ ] Browser notifications work
- [ ] No page refresh needed

---

**After applying these fixes, real-time alerts should work perfectly on your Hostinger VPS!** 🚀
