#!/bin/bash

# ============================================
# Crypto Alerts Dashboard - Production Deploy
# ============================================
# 
# This script ensures:
# 1. Code is pulled from git
# 2. Dependencies are installed
# 3. App is built
# 4. Redis is warmed up (ALL pairs cached instantly)
# 5. PM2 processes are restarted
# 
# Usage: ./deploy.sh
# ============================================

set -e  # Exit on error

echo "🚀 Starting deployment..."
cd /var/www/alerts-dashboard

# Step 1: Pull latest code
echo "📥 Pulling latest code..."
git pull origin main

# Step 2: Install dependencies
echo "📦 Installing dependencies..."
npm ci --production=false

# Step 3: Build the app
echo "🔨 Building production app..."
npm run build

# Step 4: CRITICAL - Warmup Redis BEFORE starting workers
echo "🔥 Warming up Redis with ALL market data..."
node scripts/warmup-redis.js

# Step 5: Restart PM2 processes
echo "♻️ Restarting PM2 processes..."
pm2 restart all

# Step 6: Verify
echo "✅ Deployment complete!"
echo ""
echo "📊 Checking Redis data..."
redis-cli KEYS "crypto:*" | wc -l
echo "pairs cached in Redis"

echo ""
echo "✅ Dashboard should now load ALL pairs instantly!"
echo "🌐 Visit: https://smartaiprobot.com/dashboard"
