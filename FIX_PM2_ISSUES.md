# 🔧 PM2 Server Issues - Complete Fix Guide

## 🚨 **Problem Identified:**
- PM2 logs showing empty (no logs being written)
- Server not starting properly
- Next.js app not running

## ✅ **SOLUTIONS:**

### **Solution 1: Direct Next.js Binary (RECOMMENDED)**

The PM2 config has been updated to use the direct Next.js binary instead of npx.

**Update Made:**
```javascript
{
  name: "alerts-dashboard",
  script: "node_modules/.bin/next",
  args: "start -p 3000",
  // ... rest of config
}
```

### **Solution 2: Verify Build**

Before starting with PM2, make sure the app is built:

```bash
# SSH into your server
ssh user@your-server

# Go to project directory
cd /var/www/alerts-dashboard

# Check if build exists
ls -la .next

# If .next folder doesn't exist, build the app
npm run build
```

### **Solution 3: Complete Server Restart**

```bash
# 1. Stop all PM2 processes
pm2 stop all
pm2 delete all

# 2. Clear logs (optional)
rm -rf logs/*
mkdir -p logs

# 3. Build the application
cd /var/www/alerts-dashboard
npm run build

# 4. Start with PM2
pm2 start ecosystem.config.cjs

# 5. Check status
pm2 status

# 6. View logs
pm2 logs alerts-dashboard --lines 50
```

### **Solution 4: Alternative PM2 Configuration**

If the above doesn't work, try this alternative config:

```javascript
{
  name: "alerts-dashboard",
  script: "npm",
  args: "run start",
  cwd: "/var/www/alerts-dashboard",
  instances: 1,
  autorestart: true,
  watch: false,
  max_memory_restart: "1G",
  env: {
    NODE_ENV: "production",
    PORT: 3000,
    REDIS_HOST: "localhost",
    REDIS_PORT: 6379,
    MONGODB_URI: "mongodb://localhost:27017/crypto-alerts",
    JWT_SECRET: "your-super-secret-jwt-key-change-in-production",
    TELEGRAM_BOT_TOKEN: "8305959326:AAHDT8CW0BPFXJK5RdNP_0c62agwoKraG50",
  },
  error_file: "./logs/alerts-dashboard-error.log",
  out_file: "./logs/alerts-dashboard-out.log",
  log_file: "./logs/alerts-dashboard-combined.log",
  time: true,
  merge_logs: true,
  log_date_format: "YYYY-MM-DD HH:mm:ss Z",
},
```

## 🔍 **Debugging Steps:**

### **Step 1: Check if Next.js is installed**
```bash
cd /var/www/alerts-dashboard
ls node_modules/.bin/next
```

If it doesn't exist:
```bash
npm install
```

### **Step 2: Test Next.js manually**
```bash
cd /var/www/alerts-dashboard
npm run build
npm run start
```

If this works, the issue is with PM2 configuration.

### **Step 3: Check PM2 logs**
```bash
# Check detailed logs
pm2 logs alerts-dashboard --lines 100 --raw

# Check PM2 process info
pm2 show alerts-dashboard

# Check PM2 environment
pm2 env alerts-dashboard
```

### **Step 4: Verify permissions**
```bash
# Check if logs directory has write permissions
ls -la logs/
chmod 755 logs/
```

## 🚀 **Quick Fix Commands:**

```bash
# Complete reset and restart
pm2 kill
cd /var/www/alerts-dashboard
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## 📋 **Checklist:**

- [ ] Next.js build exists (`.next` folder present)
- [ ] Node.js version is correct (v18+)
- [ ] All npm packages installed (`npm install`)
- [ ] PM2 is installed globally (`npm install -g pm2`)
- [ ] Logs directory has write permissions
- [ ] Redis is running (`redis-cli ping`)
- [ ] MongoDB is running (`mongo --eval "db.runCommand('ping')"`)
- [ ] Environment variables are set in ecosystem.config.cjs
- [ ] Port 3000 is not occupied by another process

## 🔧 **Manual Testing:**

```bash
# Test if Next.js starts manually
cd /var/www/alerts-dashboard
NODE_ENV=production npm run start

# If this works but PM2 doesn't, the issue is PM2 config
# If this doesn't work, check build errors
```

## 📊 **Expected Logs:**

After successful start, you should see:
```
✅ Ready in 2s
✅ Starting server on port 3000
```

If you see errors like:
```
❌ Error: Cannot find module '.next'
```
Run: `npm run build`

If you see:
```
❌ Error: Port 3000 is already in use
```
Run: `lsof -i :3000` and kill the process

## 🎯 **Complete Server Restart Script:**

Save this as `restart-server.sh`:

```bash
#!/bin/bash
echo "🔄 Restarting Alerts Dashboard..."

# Stop all PM2 processes
pm2 stop all
pm2 delete all

# Go to project directory
cd /var/www/alerts-dashboard

# Install dependencies
npm install

# Build the application
echo "📦 Building application..."
npm run build

# Start with PM2
echo "🚀 Starting with PM2..."
pm2 start ecosystem.config.cjs

# Save PM2 configuration
pm2 save

# Check status
pm2 status
pm2 logs alerts-dashboard --lines 20

echo "✅ Server restarted successfully!"
```

Run with:
```bash
chmod +x restart-server.sh
./restart-server.sh
```

---

**After following these steps, your server should be running properly!** 🚀

