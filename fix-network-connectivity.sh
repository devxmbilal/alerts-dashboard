#!/bin/bash

# 🔧 Fix Network Connectivity Script
# This script fixes IPv6 connectivity issues and network configuration

echo "🔧 Fixing Network Connectivity Issues..."

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
if [ "$EUID" -ne 0 ]; then
    print_error "This script needs to be run as root to modify network settings"
    echo "Please run: sudo ./fix-network-connectivity.sh"
    exit 1
fi

print_status "🔧 Fixing network connectivity issues..."

# 1. Disable IPv6 for better connectivity (temporary fix)
print_status "Disabling IPv6 to force IPv4 connections..."
echo 'net.ipv6.conf.all.disable_ipv6 = 1' >> /etc/sysctl.conf
echo 'net.ipv6.conf.default.disable_ipv6 = 1' >> /etc/sysctl.conf
sysctl -p

# 2. Update DNS settings
print_status "Updating DNS settings..."
echo "nameserver 8.8.8.8" > /etc/resolv.conf
echo "nameserver 8.8.4.4" >> /etc/resolv.conf
echo "nameserver 1.1.1.1" >> /etc/resolv.conf

# 3. Test connectivity
print_status "Testing network connectivity..."
if ping -c 3 8.8.8.8 > /dev/null 2>&1; then
    print_status "✅ IPv4 connectivity working"
else
    print_warning "⚠️ IPv4 connectivity issues detected"
fi

# 4. Test Binance API connectivity
print_status "Testing Binance API connectivity..."
if curl -s --connect-timeout 10 "https://api.binance.com/api/v3/ping" > /dev/null; then
    print_status "✅ Binance API accessible"
else
    print_warning "⚠️ Binance API not accessible"
fi

# 5. Install/update curl and wget
print_status "Installing network tools..."
apt-get update
apt-get install -y curl wget dnsutils

# 6. Create a network test script
print_status "Creating network test script..."
cat > /var/www/alerts-dashboard/test-network.js << 'EOF'
#!/usr/bin/env node

const https = require('https');
const http = require('http');

async function testConnectivity() {
  console.log('🌐 Testing network connectivity...');
  
  // Test IPv4 connectivity
  try {
    const response = await fetch('https://api.binance.com/api/v3/ping');
    const data = await response.json();
    console.log('✅ Binance API accessible:', data);
  } catch (error) {
    console.error('❌ Binance API error:', error.message);
  }
  
  // Test with different endpoints
  const endpoints = [
    'https://api.binance.com/api/v3/ping',
    'https://api1.binance.com/api/v3/ping',
    'https://api2.binance.com/api/v3/ping',
    'https://api3.binance.com/api/v3/ping'
  ];
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint);
      const data = await response.json();
      console.log(`✅ ${endpoint}:`, data);
      break;
    } catch (error) {
      console.log(`❌ ${endpoint}:`, error.message);
    }
  }
}

testConnectivity();
EOF

chmod +x /var/www/alerts-dashboard/test-network.js

print_status "✅ Network configuration updated!"
print_status "🔄 Restarting PM2 processes..."

# Restart PM2 processes
pm2 restart all

print_status "✅ All processes restarted"
print_status "🧪 Testing network connectivity..."

# Run network test
cd /var/www/alerts-dashboard
node test-network.js

print_status "📊 Current PM2 status:"
pm2 status

print_status "🎉 Network connectivity fix completed!"
print_status "💡 If issues persist, check your server's firewall and network configuration"
