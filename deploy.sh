#!/bin/bash

# 🚀 Alerts Dashboard Deployment Script
# Run this script on your production server

echo "🚀 Starting Alerts Dashboard Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
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

# Update system packages
print_status "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
print_status "Installing Node.js 18+..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
print_status "Installing PM2..."
sudo npm install -g pm2

# Install MongoDB
print_status "Installing MongoDB..."
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org

# Install Redis
print_status "Installing Redis..."
sudo apt install redis-server -y

# Start services
print_status "Starting MongoDB and Redis..."
sudo systemctl start mongod
sudo systemctl enable mongod
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Create application directory
print_status "Setting up application directory..."
sudo mkdir -p /var/www/alerts-dashboard
sudo chown -R $USER:$USER /var/www/alerts-dashboard

# Create logs directory
mkdir -p /var/www/alerts-dashboard/logs

print_status "Deployment script completed!"
print_warning "Next steps:"
echo "1. Copy your application files to /var/www/alerts-dashboard"
echo "2. Run 'npm install' in the application directory"
echo "3. Create .env.production file with your configuration"
echo "4. Run 'npm run build' to build the application"
echo "5. Start with PM2: 'pm2 start ecosystem.config.js'"
echo "6. Save PM2 configuration: 'pm2 save'"
echo "7. Setup PM2 startup: 'sudo pm2 startup'"

print_status "For detailed instructions, see DEPLOYMENT_GUIDE.md"
