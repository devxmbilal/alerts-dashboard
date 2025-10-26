#!/bin/bash

# 🔧 Fix PM2 Configuration Script
# Run this on your server to fix the ecosystem config issue

echo "🔧 Fixing PM2 Configuration..."

# Remove old .js file if it exists
if [ -f "ecosystem.config.js" ]; then
    echo "Removing old ecosystem.config.js..."
    rm ecosystem.config.js
fi

# Create the .cjs file
echo "Creating ecosystem.config.cjs..."
cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [
    {
      name: "alerts-dashboard",
      script: "npm",
      args: "start",
      cwd: "/var/www/alerts-dashboard",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      error_file: "./logs/alerts-dashboard-error.log",
      out_file: "./logs/alerts-dashboard-out.log",
      log_file: "./logs/alerts-dashboard-combined.log",
      time: true,
    },
    {
      name: "binance-worker",
      script: "workers/binance-worker.js",
      cwd: "/var/www/alerts-dashboard",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/binance-worker-error.log",
      out_file: "./logs/binance-worker-out.log",
      log_file: "./logs/binance-worker-combined.log",
      time: true,
    },
    {
      name: "alert-worker",
      script: "workers/alert-worker.js",
      cwd: "/var/www/alerts-dashboard",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/alert-worker-error.log",
      out_file: "./logs/alert-worker-out.log",
      log_file: "./logs/alert-worker-combined.log",
      time: true,
    },
  ],
};
EOF

echo "✅ Fixed! Now you can run:"
echo "pm2 start ecosystem.config.cjs"
echo ""
echo "Or if you want to restart everything:"
echo "pm2 delete all"
echo "pm2 start ecosystem.config.cjs"
echo "pm2 save"
