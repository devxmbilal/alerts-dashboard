# 🔧 Puppeteer Error Fix Guide

## ❌ Error: TargetCloseError - Protocol error

Agar aapko yeh error aa raha hai:
```
TargetCloseError: Protocol error (Target.setDiscoverTargets): Target closed
```

Yeh error EC2 server par Puppeteer Chrome browser launch nahi kar pa raha.

---

## 🔧 Solution: EC2 Par Dependencies Install Karein

### Step 1: EC2 Par SSH Karein

```bash
ssh ubuntu@YOUR_EC2_IP
```

### Step 2: Dependencies Install Karein

**Option A: Quick Install (Recommended)**

```bash
# Script run karein
cd /var/www/alerts-dashboard
chmod +x scripts/install-puppeteer-deps.sh
sudo ./scripts/install-puppeteer-deps.sh
```

**Option B: Manual Install**

```bash
# Update packages
sudo apt-get update

# Install Chromium and dependencies
sudo apt-get install -y \
  chromium-browser \
  libgbm1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libxss1 \
  libgconf-2-4 \
  libxkbcommon0 \
  libgtk-3-0 \
  fonts-liberation \
  libappindicator3-1 \
  xdg-utils
```

### Step 3: PM2 Restart Karein

```bash
cd /var/www/alerts-dashboard
pm2 restart alert-worker
pm2 restart all  # Ya sab processes restart karein
pm2 logs alert-worker  # Logs check karein
```

---

## ✅ Verification

### Check Chromium Installation:

```bash
chromium-browser --version
# Ya
google-chrome --version
```

### Test Screenshot:

```bash
cd /var/www/alerts-dashboard
npm run test-chart-screenshot
```

---

## 🔍 What Was Fixed

### 1. **Better Error Handling**
- Browser initialization retry logic (3 attempts)
- Browser health check before use
- Automatic browser restart on failure

### 2. **Improved Browser Configuration**
- Added `--single-process` mode for stability
- More Chrome flags for server environment
- Better timeout handling

### 3. **Browser Lifecycle Management**
- Verify browser is alive before use
- Automatic cleanup on errors
- Page creation timeout protection

---

## 🐛 If Still Having Issues

### Check Logs:

```bash
pm2 logs alert-worker --lines 100
```

### Check Chrome/Chromium:

```bash
which chromium-browser
which google-chrome
```

### Test Manually:

```bash
cd /var/www/alerts-dashboard
node -e "
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({headless: 'new', args: ['--no-sandbox']});
console.log('✅ Browser launched successfully');
await browser.close();
"
```

### Memory Check:

```bash
free -h
df -h
```

Agar memory full hai, to:
- Old screenshots delete karein: `rm -rf tmp/*`
- PM2 processes restart karein

---

## 📝 Changes Made

1. ✅ **chartScreenshot.js** - Better error handling aur retry logic
2. ✅ **install-puppeteer-deps.sh** - Dependencies install script
3. ✅ **deploy.yml** - Automatic dependencies check during deployment

---

## 🚀 After Fix

Ab Puppeteer properly kaam karega aur chart screenshots capture ho jayenge. Agar koi issue ho, logs check karein aur verify karein ke Chromium properly installed hai.

**Happy Screenshotting! 📸**

