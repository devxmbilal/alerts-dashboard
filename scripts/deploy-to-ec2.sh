#!/bin/bash

# 🚀 EC2 Deployment Script
# This script can be used for manual deployment or called by CI/CD

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration (can be overridden by environment variables)
EC2_HOST="${EC2_HOST:-}"
EC2_USER="${EC2_USER:-ubuntu}"
APP_DIR="${APP_DIR:-/var/www/alerts-dashboard}"
SSH_KEY="${SSH_KEY:-~/.ssh/id_rsa}"

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Check if EC2_HOST is set
if [ -z "$EC2_HOST" ]; then
    print_error "EC2_HOST environment variable is not set!"
    echo "Usage: EC2_HOST=your-ec2-ip ./scripts/deploy-to-ec2.sh"
    exit 1
fi

print_step "🚀 Starting deployment to EC2: $EC2_HOST"

# Build the application
print_step "📦 Building Next.js application..."
npm run build

# Create deployment package
print_step "📦 Creating deployment package..."
DEPLOY_DIR="deploy-package"
rm -rf $DEPLOY_DIR
mkdir -p $DEPLOY_DIR

# Copy necessary files
cp -r app components contexts models services utils workers public scripts $DEPLOY_DIR/ 2>/dev/null || true
cp package.json package-lock.json ecosystem.config.cjs next.config.mjs postcss.config.mjs jsconfig.json $DEPLOY_DIR/ 2>/dev/null || true
cp -r .next $DEPLOY_DIR/ 2>/dev/null || print_warning ".next directory not found"

# Create necessary directories
mkdir -p $DEPLOY_DIR/logs $DEPLOY_DIR/tmp

# Compress package
print_step "📦 Compressing deployment package..."
cd $DEPLOY_DIR
tar -czf ../deployment.tar.gz .
cd ..
rm -rf $DEPLOY_DIR

# Deploy to EC2
print_step "🚀 Deploying to EC2..."
scp -i $SSH_KEY -o StrictHostKeyChecking=no deployment.tar.gz $EC2_USER@$EC2_HOST:/tmp/

# SSH and deploy
ssh -i $SSH_KEY -o StrictHostKeyChecking=no $EC2_USER@$EC2_HOST << ENDSSH
set -e

echo "🚀 Starting deployment on EC2..."

# Create backup
BACKUP_DIR="$APP_DIR-backup-\$(date +%Y%m%d-%H%M%S)"
if [ -d "$APP_DIR" ]; then
  echo "📦 Creating backup..."
  sudo cp -r $APP_DIR \$BACKUP_DIR
  echo "✅ Backup created at \$BACKUP_DIR"
fi

# Stop PM2 processes
echo "⏸️ Stopping PM2 processes..."
cd $APP_DIR || true
pm2 stop all || true
pm2 delete all || true

# Extract new deployment
echo "📦 Extracting deployment package..."
cd /tmp
sudo rm -rf $APP_DIR/*
sudo tar -xzf deployment.tar.gz -C $APP_DIR
sudo chown -R \$USER:\$USER $APP_DIR

# Install dependencies
echo "📥 Installing dependencies..."
cd $APP_DIR
npm ci --production

# Ensure .env file exists
if [ ! -f "$APP_DIR/.env" ]; then
  echo "⚠️ Warning: .env file not found. Please create it manually."
fi

# Create necessary directories
mkdir -p $APP_DIR/logs $APP_DIR/tmp

# Restart PM2 processes
echo "🔄 Starting PM2 processes..."
pm2 start ecosystem.config.cjs
pm2 save

# Cleanup
rm -f /tmp/deployment.tar.gz

echo "✅ Deployment completed successfully!"
echo "📊 PM2 Status:"
pm2 status
ENDSSH

# Cleanup local files
rm -f deployment.tar.gz

print_status "✅ Deployment completed successfully!"
print_status "🌐 Application should be running on: http://$EC2_HOST:3000"

