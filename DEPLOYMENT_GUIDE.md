# 🚀 Production Deployment Guide

## 📋 **Prerequisites**

### **Server Requirements:**
- **Node.js**: v18+ 
- **MongoDB**: v6+
- **Redis**: v6+
- **PM2**: Process manager
- **Nginx**: Reverse proxy (optional)
- **SSL Certificate**: For HTTPS

### **Recommended Server Specs:**
- **CPU**: 2+ cores
- **RAM**: 4GB+ 
- **Storage**: 20GB+ SSD
- **OS**: Ubuntu 20.04+ / CentOS 8+

## 🔧 **Step 1: Server Setup**

### **1.1 Update System**
```bash
sudo apt update && sudo apt upgrade -y
```

### **1.2 Install Node.js**
```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### **1.3 Install MongoDB**
```bash
# Import MongoDB public key
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -

# Add MongoDB repository
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list

# Install MongoDB
sudo apt-get update
sudo apt-get install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod
```

### **1.4 Install Redis**
```bash
# Install Redis
sudo apt install redis-server

# Start Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Test Redis
redis-cli ping
```

### **1.5 Install PM2**
```bash
# Install PM2 globally
sudo npm install -g pm2

# Install PM2 startup script
sudo pm2 startup
```

## 📁 **Step 2: Application Deployment**

### **2.1 Clone Repository**
```bash
# Create application directory
sudo mkdir -p /var/www/alerts-dashboard
sudo chown -R $USER:$USER /var/www/alerts-dashboard
cd /var/www/alerts-dashboard

# Clone your repository
git clone <your-repository-url> .

# Install dependencies
npm install
```

### **2.2 Environment Configuration**
```bash
# Create production environment file
nano .env.production
```

**Add the following content:**
```env
# Database
MONGODB_URI=mongodb://localhost:27017/crypto-alerts-prod
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your-super-secure-jwt-secret-key-change-this-in-production
JWT_EXPIRES_IN=7d

# Next.js
NODE_ENV=production
NEXTAUTH_URL=https://yourdomain.com
NEXTAUTH_SECRET=your-nextauth-secret-key

# Server
PORT=3000
HOST=0.0.0.0
```

### **2.3 Build Application**
```bash
# Build the application
npm run build

# Test the build
npm start
```

## 🔄 **Step 3: Process Management with PM2**

### **3.1 Create PM2 Ecosystem File**
```bash
nano ecosystem.config.js
```

**Add the following content:**
```javascript
module.exports = {
  apps: [
    {
      name: 'alerts-dashboard',
      script: 'npm',
      args: 'start',
      cwd: '/var/www/alerts-dashboard',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'binance-worker',
      script: 'workers/binance-worker.js',
      cwd: '/var/www/alerts-dashboard',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'alert-worker',
      script: 'workers/alert-worker.js',
      cwd: '/var/www/alerts-dashboard',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
```

### **3.2 Start Applications with PM2**
```bash
# Start all applications
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Check status
pm2 status
pm2 logs
```

## 🌐 **Step 4: Nginx Configuration (Optional)**

### **4.1 Install Nginx**
```bash
sudo apt install nginx
```

### **4.2 Create Nginx Configuration**
```bash
sudo nano /etc/nginx/sites-available/alerts-dashboard
```

**Add the following content:**
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

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

### **4.3 Enable Site**
```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/alerts-dashboard /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

## 🔒 **Step 5: SSL Certificate (Optional)**

### **5.1 Install Certbot**
```bash
sudo apt install certbot python3-certbot-nginx
```

### **5.2 Get SSL Certificate**
```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

## 🛡️ **Step 6: Security Configuration**

### **6.1 Firewall Setup**
```bash
# Install UFW
sudo apt install ufw

# Configure firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

### **6.2 MongoDB Security**
```bash
# Enable MongoDB authentication
sudo nano /etc/mongod.conf
```

**Add authentication:**
```yaml
security:
  authorization: enabled
```

### **6.3 Redis Security**
```bash
# Configure Redis password
sudo nano /etc/redis/redis.conf
```

**Add password:**
```
requirepass your-redis-password
```

## 📊 **Step 7: Monitoring & Logs**

### **7.1 PM2 Monitoring**
```bash
# Install PM2 monitoring
pm2 install pm2-logrotate

# View logs
pm2 logs alerts-dashboard
pm2 logs binance-worker
pm2 logs alert-worker

# Monitor resources
pm2 monit
```

### **7.2 System Monitoring**
```bash
# Install monitoring tools
sudo apt install htop iotop

# Check system resources
htop
df -h
free -h
```

## 🔄 **Step 8: Backup Strategy**

### **8.1 Database Backup**
```bash
# Create backup script
nano backup.sh
```

**Add backup script:**
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/alerts-dashboard"
mkdir -p $BACKUP_DIR

# MongoDB backup
mongodump --db crypto-alerts-prod --out $BACKUP_DIR/mongodb_$DATE

# Application backup
tar -czf $BACKUP_DIR/app_$DATE.tar.gz /var/www/alerts-dashboard

# Clean old backups (keep 7 days)
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
find $BACKUP_DIR -name "mongodb_*" -mtime +7 -delete
```

### **8.2 Setup Cron Job**
```bash
# Add to crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * /var/www/alerts-dashboard/backup.sh
```

## 🚀 **Step 9: Deployment Commands**

### **9.1 Update Application**
```bash
# Pull latest changes
cd /var/www/alerts-dashboard
git pull origin main

# Install new dependencies
npm install

# Build application
npm run build

# Restart PM2 processes
pm2 restart all
```

### **9.2 Health Checks**
```bash
# Check application status
pm2 status

# Check logs for errors
pm2 logs --lines 100

# Test database connection
mongo --eval "db.adminCommand('ping')"

# Test Redis connection
redis-cli ping
```

## 📱 **Step 10: Domain & DNS**

### **10.1 Domain Configuration**
1. **Point your domain** to your server IP
2. **Update DNS records** (A record)
3. **Wait for propagation** (up to 48 hours)

### **10.2 Final Testing**
```bash
# Test application
curl http://localhost:3000
curl https://yourdomain.com

# Check all services
pm2 status
systemctl status mongod
systemctl status redis-server
systemctl status nginx
```

## 🎯 **Quick Deployment Checklist**

- [ ] Server setup complete
- [ ] MongoDB installed and running
- [ ] Redis installed and running
- [ ] Application cloned and built
- [ ] Environment variables configured
- [ ] PM2 processes running
- [ ] Nginx configured (optional)
- [ ] SSL certificate installed (optional)
- [ ] Firewall configured
- [ ] Backup strategy implemented
- [ ] Domain pointing to server
- [ ] All services tested

## 🆘 **Troubleshooting**

### **Common Issues:**
1. **Port conflicts**: Check if ports 3000, 27017, 6379 are free
2. **Permission issues**: Ensure proper file permissions
3. **Memory issues**: Monitor RAM usage with `htop`
4. **Database connection**: Check MongoDB logs
5. **Redis connection**: Check Redis logs

### **Useful Commands:**
```bash
# Check PM2 logs
pm2 logs --lines 50

# Restart specific service
pm2 restart alerts-dashboard

# Check system resources
htop
df -h
free -h

# Check network connections
netstat -tulpn
```

Your alerts dashboard is now ready for production! 🚀
