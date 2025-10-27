#!/bin/bash

# 🚀 Complete Server Setup Script for Real-time Alerts
# Run this on your Hostinger VPS to fix all issues

echo "🚀 Starting Complete Server Setup..."

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

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    print_error "Please don't run this script as root. Use a regular user with sudo privileges."
    exit 1
fi

# Navigate to project directory
cd /var/www/alerts-dashboard || {
    print_error "Project directory not found at /var/www/alerts-dashboard"
    exit 1
}

print_status "Current directory: $(pwd)"

# Step 1: Create .env.local file
print_status "Creating .env.local file..."
cat > .env.local << 'EOF'
# Database
MONGODB_URI=mongodb://localhost:27017/crypto-alerts

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT Secret (Change this!)
JWT_SECRET=your-super-secure-jwt-secret-key-change-in-production

# Telegram Bot
TELEGRAM_BOT_TOKEN=8305959326:AAHDT8CW0BPFXJK5RdNP_0c62agwoKraG50

# Next.js Configuration
NODE_ENV=production
PORT=3000

# API URLs (Update with your domain)
NEXT_PUBLIC_API_URL=http://your-domain.com
NEXT_PUBLIC_DISABLE_REALTIME_NOTIFICATIONS=false
EOF

print_status "✅ Created .env.local file"

# Step 2: Check Redis service
print_status "Checking Redis service..."
if systemctl is-active --quiet redis-server; then
    print_status "✅ Redis is running"
else
    print_warning "Redis is not running, starting it..."
    sudo systemctl start redis-server
    sudo systemctl enable redis-server
    print_status "✅ Redis started and enabled"
fi

# Step 3: Check MongoDB service
print_status "Checking MongoDB service..."
if systemctl is-active --quiet mongod; then
    print_status "✅ MongoDB is running"
else
    print_warning "MongoDB is not running, starting it..."
    sudo systemctl start mongod
    sudo systemctl enable mongod
    print_status "✅ MongoDB started and enabled"
fi

# Step 4: Test Redis connection
print_status "Testing Redis connection..."
if redis-cli ping | grep -q "PONG"; then
    print_status "✅ Redis connection successful"
else
    print_error "❌ Redis connection failed"
    exit 1
fi

# Step 5: Install dependencies
print_status "Installing dependencies..."
npm install

# Step 6: Build the application
print_status "Building application..."
npm run build

# Step 7: Stop all PM2 processes
print_status "Stopping all PM2 processes..."
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true

# Step 8: Start all processes with new configuration
print_status "Starting all processes with PM2..."
pm2 start ecosystem.config.cjs

# Step 9: Check status
print_status "Checking PM2 status..."
pm2 status

# Step 10: Show logs for verification
print_status "Showing recent logs..."
echo ""
print_status "=== ALERTS DASHBOARD LOGS ==="
pm2 logs alerts-dashboard --lines 10

echo ""
print_status "=== BINANCE WORKER LOGS ==="
pm2 logs binance-worker --lines 10

echo ""
print_status "=== ALERT WORKER LOGS ==="
pm2 logs alert-worker --lines 10

echo ""
print_status "=== CLEANUP WORKER LOGS ==="
pm2 logs cleanup-worker --lines 10

# Step 11: Test Redis pub/sub
print_status "Testing Redis pub/sub functionality..."
redis-cli publish "test:channel" "Hello from server setup!" &
sleep 1

# Step 12: Final verification
print_status "Final verification..."
echo ""
print_status "✅ Setup completed! Check the following:"
echo "1. All PM2 processes should be 'online'"
echo "2. No Redis connection errors in logs"
echo "3. Binance worker should be fetching data"
echo "4. Alert worker should be connected to Redis"
echo ""
print_status "To monitor logs in real-time:"
echo "pm2 logs"
echo ""
print_status "To restart all services:"
echo "pm2 restart all"
echo ""
print_status "To check Redis:"
echo "redis-cli ping"
echo ""
print_status "🚀 Your real-time alerts should now work without page refresh!"
