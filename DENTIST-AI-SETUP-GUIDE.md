# 🦷 Dentist AI Voice Agent - Complete Setup Guide

## 📊 SERVICES OVERVIEW

| Service | Free Tier | Paid | Required? |
|---------|-----------|------|-----------|
| **n8n** | ✅ Self-hosted FREE | $20/mo cloud | ✅ Yes |
| **VAPI.ai** | ✅ $10 FREE credits | Pay-as-you-go | ✅ Yes |
| **OpenAI** | ❌ No | Pay-as-you-go | ✅ Yes |
| **Google Calendar** | ✅ FREE | - | ✅ Yes |
| **Google Sheets** | ✅ FREE | - | ✅ Yes |
| **WhatsApp Business** | ✅ 1000 free/mo | Pay-per-msg | ✅ Yes |
| **Twilio (Phone)** | ✅ $15 Trial | Pay-as-you-go | 🔶 Optional |

---

## 💰 ESTIMATED MONTHLY COST

### Minimum Setup (Low Volume):
| Service | Cost |
|---------|------|
| n8n (self-hosted) | FREE |
| VAPI (~100 calls) | ~$15 |
| OpenAI | ~$2 |
| WhatsApp | FREE (under 1000) |
| **TOTAL** | **~$17/month** |

### Medium Volume (~500 calls/month):
| Service | Cost |
|---------|------|
| n8n Cloud | $20 |
| VAPI | ~$75 |
| OpenAI | ~$10 |
| WhatsApp | ~$25 |
| **TOTAL** | **~$130/month** |

---

## 🔧 STEP-BY-STEP SETUP

---

## STEP 1: n8n Setup (FREE Self-Hosted)

### Option A: Local Computer (Testing)
```bash
# Install Node.js first from nodejs.org

# Install n8n globally
npm install -g n8n

# Run n8n
n8n start
```
Open: http://localhost:5678

### Option B: Free Cloud Options
1. **Railway.app** (Free tier)
   - Go to: https://railway.app
   - Deploy n8n template
   - Get free subdomain

2. **Render.com** (Free tier)
   - Go to: https://render.com
   - Create Web Service
   - Use Docker image: n8nio/n8n

### Option C: n8n Cloud ($20/month)
- Go to: https://n8n.io/cloud
- Sign up & get hosted n8n
- Easiest option, no setup needed

---

## STEP 2: OpenAI API Setup

### 2.1 Create Account
1. Go to: https://platform.openai.com
2. Sign up with email
3. Verify phone number

### 2.2 Add Payment Method
1. Go to: Settings → Billing
2. Add credit card
3. Add $10-20 credit (minimum)

### 2.3 Get API Key
1. Go to: API Keys
2. Click "Create new secret key"
3. Name it: "Dentist AI"
4. Copy the key: `sk-xxxxxxxxxxxxxxxx`

### 2.4 Add to n8n
1. n8n → Credentials → Add
2. Type: OpenAI
3. Paste API Key
4. Save

**Cost:** ~$0.002 per call (very cheap!)

---

## STEP 3: Google Setup (FREE)

### 3.1 Create Google Cloud Project
1. Go to: https://console.cloud.google.com
2. Create New Project: "Dentist AI"
3. Select the project

### 3.2 Enable APIs
1. Go to: APIs & Services → Library
2. Search & Enable:
   - ✅ Google Calendar API
   - ✅ Google Sheets API

### 3.3 Create OAuth Credentials
1. Go to: APIs & Services → Credentials
2. Click: Create Credentials → OAuth Client ID
3. Configure Consent Screen:
   - User Type: External
   - App Name: Dentist AI
   - Email: Your email
   - Save
4. Create OAuth Client:
   - Application Type: Web Application
   - Name: n8n
   - Redirect URI: (get from n8n credential setup)
5. Copy: Client ID & Client Secret

### 3.4 Add to n8n
1. n8n → Credentials → Add
2. Type: Google Calendar OAuth2
3. Paste Client ID & Secret
4. Click Connect → Authorize
5. Repeat for Google Sheets OAuth2

---

## STEP 4: WhatsApp Business API Setup (FREE to Start)

### 4.1 Meta Developer Account
1. Go to: https://developers.facebook.com
2. Login with Facebook
3. Accept Developer Terms

### 4.2 Create App
1. My Apps → Create App
2. Select: Business
3. App Name: "Dental Clinic Bot"
4. Create App

### 4.3 Add WhatsApp
1. Add Products → WhatsApp → Set Up
2. Accept Terms

### 4.4 Get Credentials
Go to: WhatsApp → API Setup

| Info | Where |
|------|-------|
| Phone Number ID | "From" field |
| Access Token | Generate Token |

### 4.5 Test Phone Number (FREE)
- Meta gives you a TEST phone number
- You can send to 5 numbers for FREE
- Add your numbers in "To" section

### 4.6 Production (Later)
When ready for production:
1. Add real business phone number
2. Verify Business on Meta
3. Get approved for messaging

### 4.7 Add to n8n
1. n8n → Credentials → Add
2. Type: WhatsApp Business Cloud
3. Add:
   - Access Token
   - Business Account ID

**Pricing:**
- First 1000 conversations/month: FREE
- After: ~$0.05 per conversation

---

## STEP 5: VAPI.ai Setup (Voice AI)

### 5.1 Create Account
1. Go to: https://vapi.ai
2. Click: Get Started
3. Sign up with Google/Email
4. You get **$10 FREE credits!**

### 5.2 Dashboard Overview
After login you'll see:
- Assistants (your AI agents)
- Phone Numbers
- Call Logs
- Usage & Billing

### 5.3 Create Assistant
1. Click: Assistants → Create
2. Choose: Blank/Custom

### 5.4 Configure Assistant

#### Basic Settings:
```
Name: Dr. Ahmed Dental Care AI
First Message: Assalam o Alaikum! Dr. Ahmed Dental Care mein khush aamdeed. Main Ayesha hoon, aapki AI receptionist. Aaj main aapki kya madad kar sakti hoon?
```

#### Model:
```
Provider: OpenAI
Model: gpt-4o-mini (cheaper) or gpt-4o (better)
Temperature: 0.7
```

#### System Prompt:
```
You are Ayesha, the friendly AI receptionist at Dr. Ahmed Dental Care clinic in Lahore, Pakistan.

PERSONALITY:
- Warm, professional, helpful
- Speak in Roman Urdu (Urdu in English letters)
- Use: "Ji", "Zaroor", "Bilkul", "Insha'Allah"
- Be empathetic if patient mentions pain

CLINIC INFO:
- Name: Dr. Ahmed Dental Care
- Location: Main Boulevard, Gulberg III, Lahore
- Phone: 042-35761234
- Hours: Mon-Sat 9AM-8PM, Sunday Closed
- Emergency: 24/7 for severe cases

SERVICES:
- Checkup: Rs. 1,000
- Cleaning: Rs. 3,000
- Filling: Rs. 2,500-5,000
- Extraction: Rs. 3,000-8,000
- Root Canal: Rs. 15,000-25,000
- Braces: Rs. 80,000-150,000
- Whitening: Rs. 10,000-15,000

TASKS:
1. Greet warmly
2. Understand their need (booking or question)
3. If booking: Get name, service, date/time
4. Confirm details
5. Say goodbye warmly

IMPORTANT:
- Never make up information
- If unsure, ask them to call clinic
```

#### Voice:
```
Provider: 11labs or PlayHT
Voice: Choose a female voice for "Ayesha"
```

#### Transcriber:
```
Provider: Deepgram
Model: nova-2
Language: hi (Hindi/Urdu compatible)
```

### 5.5 Server URL (Connect to n8n)
1. In VAPI Assistant settings
2. Find: Server URL / Webhook
3. Paste your n8n webhook URL:
   ```
   https://your-n8n-url.com/webhook/vapi-webhook
   ```

### 5.6 Structured Data Extraction
In Advanced Settings → Analysis:
```
Extract from conversation:
- patient_name: Full name
- phone_number: Phone number
- appointment_type: Service type
- preferred_date: YYYY-MM-DD format
- preferred_time: HH:MM format
- urgency: normal/urgent/emergency
- symptoms: Any problems mentioned
- is_booking: true if booking, false if question

Respond in JSON only.
```

### 5.7 Get Phone Number

#### Option A: VAPI Number ($2-5/month)
1. Dashboard → Phone Numbers
2. Buy Number
3. Select country (US numbers available, no Pakistan yet)
4. Assign to your Assistant

#### Option B: Import Twilio Number
1. Get Twilio number first (see Step 6)
2. VAPI → Phone Numbers → Import
3. Add Twilio credentials
4. Import your number

### 5.8 Test Your Assistant
1. Dashboard → Assistants → Your Assistant
2. Click: Test Call (in browser)
3. Talk to it and test!

**VAPI Pricing:**
- $10 FREE credits to start
- ~$0.05/minute for calls
- 100 calls (~3 min each) = ~$15

---

## STEP 6: Twilio Setup (Optional - For Phone Number)

### 6.1 Create Account
1. Go to: https://twilio.com
2. Sign up (FREE trial with $15 credit)
3. Verify phone & email

### 6.2 Get Phone Number
1. Console → Phone Numbers → Buy
2. Select Country (US recommended - works globally)
3. Buy number (~$1/month)

### 6.3 Get Credentials
1. Console → Account Info
2. Copy:
   - Account SID
   - Auth Token

### 6.4 Connect to VAPI
1. VAPI → Phone Numbers → Import from Twilio
2. Add Account SID & Auth Token
3. Import your number
4. Assign to Assistant

---

## STEP 7: Google Sheet Setup

### 7.1 Create Sheet
1. Go to: https://sheets.google.com
2. Create: Blank spreadsheet
3. Name: "Dentist AI CRM"

### 7.2 Create Headers (Row 1):
Column A: Booking Ref
Column B: Date
Column C: Time
Column D: Patient Name
Column E: Phone
Column F: Service
Column G: Duration
Column H: Urgency
Column I: Symptoms
Column J: Status
Column K: Call ID
Column L: Recording
Column M: Created At
Column N: Calendar Event

### 7.3 Get Sheet ID
From URL:
```
https://docs.google.com/spreadsheets/d/[SHEET_ID_HERE]/edit
```
Copy the ID part.

---

## STEP 8: Connect Everything in n8n

### 8.1 Import Workflow
1. n8n → Import Workflow
2. Select: `dentist-ai-whatsapp-agent.json`

### 8.2 Update All Values

In each node, update:
| Find | Replace |
|------|---------|
| YOUR_GOOGLE_SHEET_ID | Your actual Sheet ID |
| YOUR_WHATSAPP_PHONE_NUMBER_ID | Meta Phone Number ID |
| STAFF_WHATSAPP_NUMBER | 923001234567 |
| DOCTOR_WHATSAPP_NUMBER | 923009876543 |

### 8.3 Connect Credentials
Click each node and select credentials:
- Google Calendar nodes → Google Calendar OAuth2
- Google Sheets node → Google Sheets OAuth2
- WhatsApp nodes → WhatsApp Business Cloud

### 8.4 Get Webhook URL
1. Click: VAPI Call Webhook node
2. Copy: Production URL
3. Paste in VAPI Assistant → Server URL

### 8.5 Activate Workflow
Toggle: Active → ON

---

## STEP 9: Final Testing

### 9.1 Test WhatsApp (Manual)
In n8n, create a test workflow:
1. Manual Trigger → WhatsApp node
2. Test send message to yourself

### 9.2 Test VAPI Call
1. VAPI Dashboard → Your Assistant
2. Click: Test Call
3. Say: "Mujhe appointment lena hai kal 3 baje"

### 9.3 Check Everything
After test call, verify:
- ✅ Calendar event created
- ✅ Google Sheet row added
- ✅ WhatsApp received

---

## 🚀 YOU'RE READY!

Share your VAPI phone number with customers.
When they call:
1. 🤖 AI will answer in Urdu
2. 📝 Collect appointment details
3. 📅 Book in calendar
4. 📱 Send WhatsApp confirmation
5. 📊 Save to CRM sheet

---

## 💡 TIPS & TRICKS

### Save Money:
1. Use `gpt-4o-mini` instead of `gpt-4o` (5x cheaper)
2. Keep calls short (3-4 min average)
3. Use WhatsApp (cheaper than SMS)

### Improve Quality:
1. Test different voices in VAPI
2. Refine the system prompt based on real calls
3. Check call recordings to improve

### Scale Up:
1. Multiple phone numbers for different clinics
2. Add more services/doctors
3. Integrate with real booking systems

---

## ❓ COMMON ISSUES

### WhatsApp not sending?
- Check if number format is correct (923xxxxxxxxx)
- Verify Meta Business account
- Check 24-hour messaging window

### VAPI calls failing?
- Check webhook URL is correct
- Ensure n8n workflow is ACTIVE
- Check VAPI logs for errors

### Calendar not creating events?
- Re-authorize Google Calendar
- Check date/time format
- Verify calendar permissions

---

## 📞 SUPPORT

- **VAPI Discord:** https://discord.gg/vapi
- **n8n Community:** https://community.n8n.io
- **WhatsApp Docs:** https://developers.facebook.com/docs/whatsapp

---

## ✅ CHECKLIST

- [ ] n8n installed/running
- [ ] OpenAI API key added
- [ ] Google Calendar connected
- [ ] Google Sheets connected
- [ ] WhatsApp Business configured
- [ ] VAPI account created
- [ ] VAPI Assistant configured
- [ ] Phone number purchased/imported
- [ ] n8n webhook URL in VAPI
- [ ] Workflow activated
- [ ] Test call successful
- [ ] WhatsApp confirmation received

---

Good luck bhai! 🚀
