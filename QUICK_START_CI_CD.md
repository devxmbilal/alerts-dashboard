# ⚡ Quick Start - CI/CD Setup (Urdu/Hindi Guide)

## 🎯 3 Simple Steps

### Step 1: GitHub Secrets Add Karein

1. GitHub repository mein jao
2. **Settings** → **Secrets and variables** → **Actions**
3. **New repository secret** click karein

**3 Secrets add karein:**

```
Name: EC2_SSH_PRIVATE_KEY
Value: [Aapki SSH private key ka complete content]
```

```
Name: EC2_HOST  
Value: [Aapka EC2 IP address, example: 54.123.45.67]
```

```
Name: EC2_USER
Value: ubuntu (ya jo bhi user hai)
```

### Step 2: EC2 Par Setup

EC2 par SSH karein aur yeh commands run karein:

```bash
ssh ubuntu@YOUR_EC2_IP

# Directory create karein
sudo mkdir -p /var/www/alerts-dashboard
sudo chown -R $USER:$USER /var/www/alerts-dashboard
mkdir -p /var/www/alerts-dashboard/logs

# .env file create karein (IMPORTANT!)
cd /var/www/alerts-dashboard
nano .env
# Apne environment variables paste karein aur save karein (Ctrl+X, Y, Enter)
```

### Step 3: Code Push Karein

```bash
git add .
git commit -m "Add CI/CD setup"
git push origin main
```

**Done!** 🎉 

Ab automatically deploy ho jayega. GitHub Actions tab mein check karein.

---

## 🔍 Check Karne Ke Liye

### Deployment Status:
- GitHub → **Actions** tab → Latest workflow run

### Application Running:
- Browser mein: `http://YOUR_EC2_IP:3000`

### PM2 Status (EC2 par):
```bash
ssh ubuntu@YOUR_EC2_IP
pm2 status
pm2 logs
```

---

## ❌ Agar Error Aaye

### SSH Error:
- GitHub Secret mein private key complete hai ya nahi check karein
- EC2 Security Group mein port 22 open hai ya nahi

### Build Error:
- Local par pehle test karein: `npm run build`
- Node.js version 18.x honi chahiye

### PM2 Error:
- EC2 par PM2 install karein: `npm install -g pm2`

---

## 📞 Detailed Guide

Complete guide ke liye `CI_CD_SETUP_GUIDE.md` file dekhein.

