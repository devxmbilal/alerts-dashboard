# 🚀 Quick Deployment Guide

## **One-Command Deployment**

### **Step 1: Prepare Your Server**
```bash
# On your Ubuntu server, run:
wget https://raw.githubusercontent.com/your-repo/alerts-dashboard/main/deploy.sh
chmod +x deploy.sh
./deploy.sh
```

### **Step 2: Upload Your Application**
```bash
# Upload your application files to:
/var/www/alerts-dashboard/

# Or clone from Git:
cd /var/www/alerts-dashboard
git clone <your-repository-url> .
```

### **Step 3: Configure Environment**
```bash
# Create production environment file
nano .env.production
```

**Add your configuration:**
```env
MONGODB_URI=mongodb://localhost:27017/crypto-alerts-prod
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your-super-secure-jwt-secret-key
JWT_EXPIRES_IN=7d
NODE_ENV=production
PORT=3000
```

### **Step 4: Build and Start**
```bash
# Install dependencies
npm install

# Build application
npm run build

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 startup
sudo pm2 startup
```

### **Step 5: Configure Domain (Optional)**
```bash
# Install Nginx
sudo apt install nginx

# Create Nginx config
sudo nano /etc/nginx/sites-available/alerts-dashboard
```

**Add Nginx configuration:**
```nginx
server {
    listen 80;
    server_name yourdomain.com;

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
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/alerts-dashboard /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## **🎯 Your Application is Live!**

- **Main App**: http://yourdomain.com
- **PM2 Status**: `pm2 status`
- **Logs**: `pm2 logs`
- **Restart**: `pm2 restart all`

## **📊 Monitoring Commands**

```bash
# Check all services
pm2 status
systemctl status mongod
systemctl status redis-server

# View logs
pm2 logs alerts-dashboard
pm2 logs binance-worker
pm2 logs alert-worker

# Monitor resources
pm2 monit
```

## **🔄 Update Application**

```bash
cd /var/www/alerts-dashboard
git pull origin main
npm install
npm run build
pm2 restart all
```

## **🆘 Troubleshooting**

### **Check Services:**
```bash
# PM2 processes
pm2 status

# Database
mongo --eval "db.adminCommand('ping')"

# Redis
redis-cli ping

# Application
curl http://localhost:3000
```

### **Common Issues:**
1. **Port 3000 in use**: Change PORT in .env.production
2. **MongoDB not running**: `sudo systemctl start mongod`
3. **Redis not running**: `sudo systemctl start redis-server`
4. **PM2 not starting**: Check logs with `pm2 logs`

## **🔒 Security Checklist**

- [ ] Change default JWT secret
- [ ] Setup MongoDB authentication
- [ ] Configure Redis password
- [ ] Setup SSL certificate
- [ ] Configure firewall
- [ ] Setup regular backups

Your alerts dashboard is now live! 🚀
