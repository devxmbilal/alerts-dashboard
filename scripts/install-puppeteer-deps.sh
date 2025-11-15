#!/bin/bash

# 🚀 Install Puppeteer Dependencies for EC2 (Ubuntu/Debian)
# Run this script on your EC2 instance to install required dependencies

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Installing Puppeteer Dependencies"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Update package list
echo "📦 Updating package list..."
sudo apt-get update

# Install Chromium and required dependencies
echo "📦 Installing Chromium and dependencies..."
sudo apt-get install -y \
  chromium-browser \
  chromium-chromedriver \
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

# Alternative: Install Google Chrome (if Chromium doesn't work)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 Installing Google Chrome (alternative)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Download and install Google Chrome
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt-get update
sudo apt-get install -y google-chrome-stable || echo "⚠️ Chrome installation failed, using Chromium"

# Verify installation
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v chromium-browser &> /dev/null; then
  echo "✅ Chromium installed: $(chromium-browser --version)"
else
  echo "⚠️ Chromium not found"
fi

if command -v google-chrome &> /dev/null; then
  echo "✅ Google Chrome installed: $(google-chrome --version)"
else
  echo "⚠️ Google Chrome not found"
fi

# Set permissions
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔐 Setting permissions..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Allow running without sandbox (for Puppeteer)
sudo chmod 4755 /usr/bin/chromium-browser 2>/dev/null || true
sudo chmod 4755 /usr/bin/google-chrome 2>/dev/null || true

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Installation Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Next steps:"
echo "1. Restart PM2 processes: pm2 restart all"
echo "2. Check logs: pm2 logs alert-worker"
echo "3. Test screenshot: npm run test-chart-screenshot"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

