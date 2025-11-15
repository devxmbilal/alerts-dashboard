#!/bin/bash

# Enable debug mode
set -e  # Exit on error
set -x  # Show all commands

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Starting Deployment Script"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📍 Current directory: $(pwd)"
echo "👤 Current user: $(whoami)"
echo "📅 Date: $(date)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Change to application directory
cd /var/www/alerts-dashboard || {
  echo "❌ ERROR: Cannot change to /var/www/alerts-dashboard"
  echo "📂 Current directory: $(pwd)"
  echo "📂 Directory exists: $(test -d /var/www/alerts-dashboard && echo 'YES' || echo 'NO')"
  exit 1
}

echo "✅ Changed to: $(pwd)"
echo "📂 Directory contents:"
ls -la

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Git Status Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if git is available
if ! command -v git &> /dev/null; then
  echo "❌ ERROR: Git is not installed!"
  exit 1
fi

# Check if it's a git repository
if [ ! -d ".git" ]; then
  echo "❌ ERROR: Not a git repository!"
  echo "📂 Current directory contents:"
  ls -la
  exit 1
fi

# Show git status
echo "📊 Git status:"
git status || echo "⚠️ Git status failed"

# Show current branch
echo "🌿 Current branch:"
git branch --show-current || echo "⚠️ Cannot determine branch"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 Pulling Latest Code"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Pull latest code
echo "📥 Fetching from origin..."
git fetch origin main || {
  echo "⚠️ Git fetch failed, trying to continue..."
}

echo "📥 Pulling latest changes..."
git pull origin main || {
  echo "❌ ERROR: Git pull failed!"
  echo "🔍 Git remote info:"
  git remote -v
  echo "🔍 Current branch info:"
  git branch -a
  exit 1
}

echo "✅ Code pulled successfully"
echo "📝 Latest commit:"
git log -1 --oneline || echo "⚠️ Cannot show commit"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 Installing Dependencies"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if npm is available
if ! command -v npm &> /dev/null; then
  echo "❌ ERROR: npm is not installed!"
  echo "🔍 Node.js version: $(node --version 2>/dev/null || echo 'NOT FOUND')"
  exit 1
fi

echo "📦 Node.js version: $(node --version)"
echo "📦 npm version: $(npm --version)"

# Check if package.json exists
if [ ! -f "package.json" ]; then
  echo "❌ ERROR: package.json not found!"
  echo "📂 Current directory: $(pwd)"
  echo "📂 Files in directory:"
  ls -la
  exit 1
fi

echo "📦 Installing dependencies..."
npm install || {
  echo "❌ ERROR: npm install failed!"
  echo "🔍 Checking npm cache..."
  npm cache verify || true
  exit 1
}

echo "✅ Dependencies installed"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏗️ Building Project"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Build the project
echo "🏗️ Building Next.js application..."
npm run build || {
  echo "❌ ERROR: Build failed!"
  echo "🔍 Checking for build errors..."
  exit 1
}

echo "✅ Build completed successfully"
echo "📂 Checking .next directory:"
if [ -d ".next" ]; then
  echo "✅ .next directory exists"
  ls -la .next | head -10
else
  echo "⚠️ WARNING: .next directory not found!"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 Restarting PM2"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if PM2 is available
if ! command -v pm2 &> /dev/null; then
  echo "❌ ERROR: PM2 is not installed!"
  echo "💡 Install PM2: npm install -g pm2"
  exit 1
fi

echo "📊 PM2 version: $(pm2 --version)"

# Check if ecosystem.config.cjs exists
if [ ! -f "ecosystem.config.cjs" ]; then
  echo "❌ ERROR: ecosystem.config.cjs not found!"
  echo "📂 Current directory: $(pwd)"
  echo "📂 Files in directory:"
  ls -la *.cjs *.js 2>/dev/null || echo "No config files found"
  exit 1
fi

echo "📊 Current PM2 status:"
pm2 status || echo "⚠️ PM2 not running"

echo "🔄 Restarting PM2 processes..."
pm2 restart ecosystem.config.cjs || {
  echo "⚠️ PM2 restart failed, trying to start..."
  pm2 start ecosystem.config.cjs || {
    echo "❌ ERROR: PM2 start failed!"
    echo "🔍 PM2 logs:"
    pm2 logs --lines 20 --nostream || true
    exit 1
  }
}

# Save PM2 configuration
pm2 save || {
  echo "⚠️ WARNING: PM2 save failed (might need to run 'pm2 startup')"
}

echo "📊 PM2 Status after restart:"
pm2 status

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Deployment Completed Successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Final PM2 Status:"
pm2 list
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
