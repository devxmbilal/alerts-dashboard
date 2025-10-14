#!/bin/bash

# 🔧 Fix Market Data Script
# This script will populate Redis with all USDT pairs from Binance

echo "🔧 Fixing Market Data - Populating All USDT Pairs..."

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

# Check if Redis is running
print_status "Checking Redis connection..."
if ! redis-cli ping > /dev/null 2>&1; then
    print_error "Redis is not running. Please start Redis first:"
    echo "sudo systemctl start redis-server"
    exit 1
fi

print_status "✅ Redis is running"

# Install node-fetch if not already installed
print_status "Installing required dependencies..."
npm install node-fetch

# Run the population script
print_status "🚀 Populating market data..."
node scripts/populate-market-data.js

if [ $? -eq 0 ]; then
    print_status "✅ Market data populated successfully!"
    print_status "🔄 Restarting PM2 processes to pick up new data..."
    
    # Restart PM2 processes
    pm2 restart all
    
    print_status "✅ All processes restarted"
    print_status "🌐 Your dashboard should now show all USDT pairs!"
    
    # Show status
    echo ""
    print_status "📊 Current PM2 status:"
    pm2 status
    
    echo ""
    print_status "🔍 Redis cache status:"
    redis-cli get "crypto:usdt_pairs" | jq '. | length' 2>/dev/null || echo "Run: redis-cli get 'crypto:usdt_pairs' to check"
    
else
    print_error "❌ Market data population failed"
    exit 1
fi
