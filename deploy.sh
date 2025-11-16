#!/bin/bash


echo "Pulling latest code..."
git pull origin main

echo "Installing dependencies..."
npm install

echo "Building project..."
npm run build

echo "Restarting PM2..."
pm2 restart all

echo "Deployment completed!"
