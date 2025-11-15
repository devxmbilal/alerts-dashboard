#!/bin/bash
cd /var/www/alerts-dashboard

echo "Pulling latest code..."
git pull origin main

echo "Installing dependencies..."
npm install

echo "Building project..."
npm run build

echo "Restarting PM2..."
pm2 restart ecosystem.config.cjs

echo "Deployment completed!"
