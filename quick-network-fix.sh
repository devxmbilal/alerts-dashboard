#!/bin/bash

# 🚀 Quick Network Fix Script
# Run this to fix the immediate network connectivity issue

echo "🔧 Quick Network Fix for Binance Worker..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

print_status "🔧 Applying quick network fixes..."

# 1. Test current connectivity
print_status "Testing current network connectivity..."
node test-network.js

# 2. Restart PM2 processes to pick up changes
print_status "🔄 Restarting PM2 processes..."
pm2 restart binance-worker
pm2 restart alert-worker
pm2 restart alerts-dashboard

# 3. Check PM2 status
print_status "📊 Current PM2 status:"
pm2 status

# 4. Show logs
print_status "📋 Recent logs from binance-worker:"
pm2 logs binance-worker --lines 20

print_status "✅ Quick network fix applied!"
print_status "💡 If issues persist, run: sudo ./fix-network-connectivity.sh"
