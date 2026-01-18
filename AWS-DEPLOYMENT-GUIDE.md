# 🚀 Crypto Alerts Dashboard - AWS Deployment Guide

## 📋 Prerequisites Checklist

- [x] AWS EC2 Instance (t3.large) - Running
- [x] Domain: cryptoaibot.online (Namecheap)
- [x] PEM file for SSH access
- [ ] Server setup (this guide)

---

## 🔐 Step 1: Connect to AWS Server

### On Windows (PowerShell):
```powershell
# Navigate to folder with PEM file
cd C:\path\to\your\pem\file

# Connect to server (replace YOUR_IP with EC2 Public IP)
ssh -i "your-key.pem" ubuntu@YOUR_PUBLIC_IP
```

### On Windows (using PuTTY):
1. Convert .pem to .ppk using PuTTYgen
2. Open PuTTY
3. Host: YOUR_PUBLIC_IP
4. Connection > SSH > Auth > Private key: your-key.ppk
5. Click Open

---

## 🛠️ Step 2: Server Initial Setup

Once connected via SSH, run these commands:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify Node.js
node -v  # Should show v20.x.x
npm -v   # Should show 10.x.x

# Install PM2 (Process Manager)
sudo npm install -g pm2

# Install Redis
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Verify Redis
redis-cli ping  # Should return PONG

# Install MongoDB
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable mongod
sudo systemctl start mongod

# Verify MongoDB
mongosh --eval "db.version()"

# Install Git
sudo apt install -y git

# Install Nginx (reverse proxy)
sudo apt install -y nginx
sudo systemctl enable nginx
```

---

## 📦 Step 3: Clone & Setup Project

```bash
# Create app directory
sudo mkdir -p /var/www/crypto-alerts
sudo chown -R $USER:$USER /var/www/crypto-alerts
cd /var/www/crypto-alerts

# Clone repository
git clone https://github.com/devxmbilal/alerts-dashboard.git .
git checkout Arslan

# Install dependencies
npm install

# Create .env file
nano .env
```

### .env File Content:
```env
# Database
MONGODB_URI=mongodb://localhost:27017/crypto-alerts

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT Secret (generate random string)
JWT_SECRET=your-super-secret-jwt-key-change-this

# Server
NODE_ENV=production
PORT=3000

# Domain
NEXT_PUBLIC_API_URL=https://cryptoaibot.online
NEXT_PUBLIC_WS_URL=wss://cryptoaibot.online

# Telegram Bot (if using)
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-chat-id

# Email (if using)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
```

Save: `Ctrl + X`, then `Y`, then `Enter`

---

## 🏗️ Step 4: Build Application

```bash
# Build Next.js app
npm run build

# Warmup Redis (load initial data)
node scripts/warmup-redis.js
```

---

## 🚀 Step 5: Start with PM2

```bash
# Create PM2 ecosystem config (if not exists)
# Start all services
pm2 start ecosystem.config.cjs

# Or start manually:
pm2 start npm --name "nextjs" -- start
pm2 start npm --name "worker" -- run worker
pm2 start npm --name "alert-worker" -- run alert-worker

# Save PM2 config (auto-start on reboot)
pm2 save
pm2 startup
# Copy and run the command it shows

# Check status
pm2 status
pm2 logs
```

---

## 🌐 Step 6: Configure Nginx (Reverse Proxy)

```bash
# Create Nginx config
sudo nano /etc/nginx/sites-available/crypto-alerts
```

### Nginx Config Content:
```nginx
server {
    listen 80;
    server_name cryptoaibot.online www.cryptoaibot.online;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

Save and enable:
```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/crypto-alerts /etc/nginx/sites-enabled/

# Remove default site
sudo rm /etc/nginx/sites-enabled/default

# Test config
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

---

## 🔒 Step 7: Setup SSL (HTTPS)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d cryptoaibot.online -d www.cryptoaibot.online

# Follow prompts:
# - Enter email
# - Agree to terms
# - Choose redirect HTTP to HTTPS (recommended)

# Auto-renewal test
sudo certbot renew --dry-run
```

---

## 🌍 Step 8: Point Domain to Server

### In Namecheap:
1. Go to **Domain List** → **cryptoaibot.online** → **Manage**
2. Click **Advanced DNS**
3. Add these records:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | @ | YOUR_EC2_PUBLIC_IP | Automatic |
| A | www | YOUR_EC2_PUBLIC_IP | Automatic |

4. **Wait 5-30 minutes** for DNS propagation

---

## 🔥 Step 9: AWS Security Group

Make sure your EC2 Security Group allows:

| Type | Port | Source |
|------|------|--------|
| SSH | 22 | Your IP |
| HTTP | 80 | 0.0.0.0/0 |
| HTTPS | 443 | 0.0.0.0/0 |

### How to check:
1. AWS Console → EC2 → Instances
2. Select "crypto bot" instance
3. Security tab → Click Security Group
4. Inbound rules → Edit → Add rules if missing

---

## ✅ Step 10: Verify Deployment

```bash
# Check all services
pm2 status

# Check logs
pm2 logs

# Check website
curl -I https://cryptoaibot.online
```

### Test in browser:
- https://cryptoaibot.online
- Should show login page or dashboard

---

## 🔧 Useful Commands

```bash
# View logs
pm2 logs
pm2 logs nextjs
pm2 logs worker

# Restart services
pm2 restart all
pm2 restart nextjs

# Stop services
pm2 stop all

# Update code
cd /var/www/crypto-alerts
git pull origin Arslan
npm install
npm run build
pm2 restart all

# Check Redis
redis-cli
> KEYS crypto:*
> GET crypto:BTCUSDT

# Check MongoDB
mongosh
> use crypto-alerts
> db.users.find()
```

---

## 🚨 Troubleshooting

### Website not loading:
```bash
# Check Nginx
sudo systemctl status nginx
sudo nginx -t
sudo tail -f /var/log/nginx/error.log

# Check PM2
pm2 status
pm2 logs
```

### SSL not working:
```bash
sudo certbot --nginx -d cryptoaibot.online
```

### Database connection failed:
```bash
sudo systemctl status mongod
sudo systemctl restart mongod
```

### Redis not working:
```bash
sudo systemctl status redis-server
redis-cli ping
```

---

## 📱 Quick Reference

| Service | Command |
|---------|---------|
| Start all | `pm2 start all` |
| Stop all | `pm2 stop all` |
| Restart all | `pm2 restart all` |
| View logs | `pm2 logs` |
| Check status | `pm2 status` |
| Update code | `git pull && npm run build && pm2 restart all` |

---

## 🎉 Done!

Your Crypto Alerts Dashboard is now live at:
# https://cryptoaibot.online

---
