# 🚀 CI/CD Setup Guide - AWS EC2 Deployment

Yeh guide aapko AWS EC2 par CI/CD implement karne mein madad karega.

## 📋 Prerequisites (Zaroori Cheezein)

1. **GitHub Repository** - Code GitHub par hona chahiye
2. **AWS EC2 Instance** - Running aur accessible
3. **SSH Access** - EC2 instance par SSH key se access
4. **Node.js & PM2** - EC2 par already installed hona chahiye

---

## 🔧 Step 1: EC2 Par SSH Key Setup

### Option A: Existing SSH Key Use Karein

Agar aapke paas already SSH key hai:

```bash
# Local machine par check karein
ls -la ~/.ssh/
```

### Option B: Naya SSH Key Generate Karein

```bash
# Naya SSH key generate karein
ssh-keygen -t rsa -b 4096 -C "github-actions-deploy" -f ~/.ssh/ec2_deploy_key

# Public key ko EC2 par add karein
ssh-copy-id -i ~/.ssh/ec2_deploy_key.pub ubuntu@YOUR_EC2_IP
```

**Important:** Private key ko GitHub Secrets mein add karna hai!

---

## 🔐 Step 2: GitHub Secrets Setup

GitHub repository mein jao aur yeh secrets add karein:

### GitHub Repository → Settings → Secrets and variables → Actions

**Add these secrets:**

1. **`EC2_SSH_PRIVATE_KEY`**
   - Value: Private SSH key ka complete content
   - How to get:
     ```bash
     cat ~/.ssh/ec2_deploy_key
     # Ya jo bhi key file hai uska content copy karein
     ```

2. **`EC2_HOST`**
   - Value: EC2 instance ka IP address ya domain
   - Example: `54.123.45.67` ya `ec2.example.com`

3. **`EC2_USER`**
   - Value: EC2 par user ka naam
   - Usually: `ubuntu` (Ubuntu), `ec2-user` (Amazon Linux), `admin` (Debian)

### Optional (Agar staging environment hai):

4. **`EC2_STAGING_HOST`** - Staging server IP
5. **`EC2_STAGING_USER`** - Staging server user

---

## 📁 Step 3: Project Structure Check

Ensure yeh files exist:

```
alerts-dashboard/
├── .github/
│   └── workflows/
│       ├── deploy.yml              # Production deployment
│       └── deploy-staging.yml      # Staging deployment (optional)
├── scripts/
│   └── deploy-to-ec2.sh            # Manual deployment script
└── ecosystem.config.cjs            # PM2 configuration
```

---

## 🚀 Step 4: First Manual Deployment

Pehli baar manually deploy karein taake sab setup ho jaye:

### EC2 Par Initial Setup:

```bash
# EC2 par SSH karein
ssh ubuntu@YOUR_EC2_IP

# Application directory create karein
sudo mkdir -p /var/www/alerts-dashboard
sudo chown -R $USER:$USER /var/www/alerts-dashboard

# Logs directory
mkdir -p /var/www/alerts-dashboard/logs
mkdir -p /var/www/alerts-dashboard/tmp

# .env file create karein (important!)
cd /var/www/alerts-dashboard
nano .env
# Apne environment variables add karein
```

### .env File Example:

```env
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb://localhost:27017/crypto-alerts
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your-secret-key-here
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-chat-id
EMAIL_HOST=smtp.gmail.com
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
```

---

## ✅ Step 5: GitHub Actions Test

1. **Code push karein** `main` branch par:
   ```bash
   git add .
   git commit -m "Setup CI/CD"
   git push origin main
   ```

2. **GitHub Actions check karein:**
   - Repository → Actions tab
   - "Deploy to AWS EC2" workflow run hoga
   - Logs check karein agar koi error ho

3. **Manual trigger (optional):**
   - Actions tab → "Deploy to AWS EC2" → "Run workflow"

---

## 🔄 Step 6: Deployment Process

### Automatic Deployment:

Jab bhi aap `main` branch par code push karte hain:
1. ✅ Code checkout hoga
2. ✅ Dependencies install hongi
3. ✅ Next.js build hoga
4. ✅ Deployment package banega
5. ✅ EC2 par deploy hoga
6. ✅ PM2 processes restart hongi

### Manual Deployment Script:

Agar manually deploy karna ho:

```bash
# Script ko executable banaein
chmod +x scripts/deploy-to-ec2.sh

# Deploy karein
EC2_HOST=your-ec2-ip EC2_USER=ubuntu ./scripts/deploy-to-ec2.sh
```

---

## 🛠️ Troubleshooting

### Issue 1: SSH Connection Failed

**Error:** `Permission denied (publickey)`

**Solution:**
```bash
# SSH key permissions check karein
chmod 600 ~/.ssh/ec2_deploy_key

# GitHub Secret mein complete key content hai ya nahi check karein
# (including -----BEGIN and -----END lines)
```

### Issue 2: PM2 Not Found

**Error:** `pm2: command not found`

**Solution:**
```bash
# EC2 par PM2 install karein
npm install -g pm2

# Ya ecosystem.config.cjs mein full path use karein
```

### Issue 3: Build Fails

**Error:** Build errors during `npm run build`

**Solution:**
- Local par pehle test karein: `npm run build`
- Environment variables check karein
- Node.js version match karein (18.x)

### Issue 4: Permission Denied

**Error:** `Permission denied` during file operations

**Solution:**
```bash
# EC2 par permissions fix karein
sudo chown -R $USER:$USER /var/www/alerts-dashboard
chmod -R 755 /var/www/alerts-dashboard
```

### Issue 5: .env File Missing

**Warning:** `.env file not found`

**Solution:**
- EC2 par manually .env file create karein
- Ya deployment script mein .env copy ka step add karein
- **Important:** .env file ko git mein commit mat karein! (security risk)

---

## 🔒 Security Best Practices

1. **❌ .env file ko git mein commit mat karein**
   - `.gitignore` mein add karein:
     ```
     .env
     .env.local
     .env.production
     ```

2. **✅ SSH keys ko secure rakhein**
   - Private key ko share mat karein
   - GitHub Secrets use karein, hardcode mat karein

3. **✅ Environment variables ko encrypt karein**
   - Sensitive data ke liye GitHub Secrets use karein

4. **✅ EC2 Security Groups check karein**
   - Sirf zaroori ports open rakhein
   - SSH (22) aur Application port (3000)

---

## 📊 Monitoring Deployment

### PM2 Status Check:

```bash
# EC2 par SSH karein
ssh ubuntu@18.139.210.2


# PM2 status
pm2 status

# PM2 logs
pm2 logs alerts-dashboard
pm2 logs binance-worker
pm2 logs alert-worker
```

### Application Health Check:

```bash
# Application running hai ya nahi
curl http://localhost:3000/api/health

# Ya browser mein
http://YOUR_EC2_IP:3000
```

---

## 🎯 Workflow Customization

### Different Branches ke liye:

`.github/workflows/deploy.yml` mein branches change karein:

```yaml
on:
  push:
    branches:
      - main      # Production
      - master    # Production (alternative)
      - develop   # Development
```

### Staging Environment:

Agar separate staging server hai, `deploy-staging.yml` use karein.

### Deployment Notifications:

Slack, Discord, ya Email notifications add kar sakte hain:

```yaml
- name: Send Notification
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    text: 'Deployment completed!'
```

---

## 📝 Summary

✅ **Setup Complete!** Ab aap:

1. Code push kar sakte hain → Automatic deployment
2. GitHub Actions se monitor kar sakte hain
3. Manual deployment script use kar sakte hain
4. PM2 se processes manage kar sakte hain

**Next Steps:**
- First deployment test karein
- Monitoring setup karein
- Backup strategy implement karein
- Error alerts setup karein

---

## 🆘 Help & Support

Agar koi issue ho:
1. GitHub Actions logs check karein
2. EC2 par PM2 logs check karein
3. SSH connection test karein
4. Environment variables verify karein

**Happy Deploying! 🚀**

