# 🚀 AI Campaign Manager — Railway Deployment Guide

## Overview

This backend connects WhatsApp Business → Claude AI → Meta Marketing API, letting you manage your ad campaigns through a WhatsApp chat interface.

---

## 📋 Prerequisites

- [x] WhatsApp Business Account ID
- [x] Phone Number ID
- [x] Meta Access Token (permanent token recommended)
- [x] Anthropic API Key → https://console.anthropic.com
- [x] Railway account → https://railway.app
- [x] GitHub account (for deployment)

---

## 🔑 Your Credentials to Fill In

| Variable | Where to find it |
|---|---|
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta Business Suite → WhatsApp → Account ID |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Developer Console → WhatsApp → Phone Number ID |
| `WHATSAPP_ACCESS_TOKEN` | Meta Developer Console → Permanent Token |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/keys |
| `META_ACCESS_TOKEN` | Same as WhatsApp token (usually) |
| `WHATSAPP_VERIFY_TOKEN` | **You choose this** — any secret string, e.g. `my_secret_token_2024` |
| `ADMIN_PHONE_NUMBERS` | Your WhatsApp number(s) with country code, e.g. `+1234567890` |

---

## 🚂 Step-by-Step Railway Deployment

### Step 1 — Push to GitHub

```bash
cd ai-campaign-manager
git init
git add .
git commit -m "Initial commit — AI Campaign Manager"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ai-campaign-manager.git
git push -u origin main
```

### Step 2 — Create Railway Project

1. Go to https://railway.app → **New Project**
2. Select **Deploy from GitHub repo**
3. Choose your `ai-campaign-manager` repository
4. Railway will auto-detect Node.js and start building

### Step 3 — Set Environment Variables

In Railway dashboard → your service → **Variables** tab, add:

```
WHATSAPP_BUSINESS_ACCOUNT_ID=your_value
WHATSAPP_PHONE_NUMBER_ID=your_value
WHATSAPP_ACCESS_TOKEN=your_value
ANTHROPIC_API_KEY=your_value
META_ACCESS_TOKEN=your_value
META_APP_ID=your_value
META_APP_SECRET=your_value
WHATSAPP_VERIFY_TOKEN=my_secure_verify_token_2024
ADMIN_PHONE_NUMBERS=+1234567890
PORT=3000
NODE_ENV=production
```

### Step 4 — Get Your Railway URL

1. Go to **Settings** → **Networking** → **Generate Domain**
2. Your URL will be: `https://ai-campaign-manager-production-XXXX.up.railway.app`

---

## 📱 WhatsApp Webhook Configuration

### Your Callback URL
```
https://YOUR-RAILWAY-DOMAIN.up.railway.app/webhook
```

### Your Verify Token
```
my_secure_verify_token_2024
```
*(Change this in your .env to match whatever you set in Railway)*

### How to Configure in Meta Developer Console

1. Go to https://developers.facebook.com
2. Select your App → **WhatsApp** → **Configuration**
3. Under **Webhook**, click **Edit**
4. Set:
   - **Callback URL**: `https://YOUR-RAILWAY-DOMAIN.up.railway.app/webhook`
   - **Verify Token**: `my_secure_verify_token_2024`
5. Click **Verify and Save**
6. Subscribe to these webhook fields:
   - ✅ `messages`
   - ✅ `messaging_postbacks`

---

## ✅ Testing Your Deployment

### 1. Health Check
```bash
curl https://YOUR-RAILWAY-DOMAIN.up.railway.app/health
```
Expected response:
```json
{
  "status": "healthy",
  "env": { "whatsapp": true, "claude": true, "meta": true }
}
```

### 2. Webhook Verification
```bash
curl "https://YOUR-RAILWAY-DOMAIN.up.railway.app/webhook?hub.mode=subscribe&hub.verify_token=my_secure_verify_token_2024&hub.challenge=test123"
```
Expected response: `test123`

### 3. WhatsApp Test
Send "hi" or "hello" to your WhatsApp Business number — you should receive a welcome message within seconds.

---

## 💬 Usage Examples

Once deployed, message your WhatsApp Business number:

| You say | What happens |
|---|---|
| "hi" | Welcome message with menu |
| "List all my ad accounts" | Shows all managed accounts |
| "Show campaign performance this week" | Performance metrics with ROAS, CTR, CPC |
| "Generate a report for last 30 days" | Full performance report |
| "How can I improve my ROAS?" | AI-powered optimization suggestions |
| "Change Campaign X budget to $500" | Sends approval buttons → you approve/reject |
| /help | Full command reference |

---

## 🔒 Security Notes

- Only phone numbers in `ADMIN_PHONE_NUMBERS` can use the bot
- Budget changes require explicit WhatsApp button approval
- Approval requests expire after 10 minutes
- Access token is never exposed to end users

---

## 📊 Architecture

```
WhatsApp User
    ↓ (sends message)
Meta WhatsApp Cloud API
    ↓ (POST /webhook)
Railway — Express Server
    ↓ (processes message)
Claude AI (with tool use)
    ↓ (calls tools)
Meta Marketing API
    ↑ (returns data)
Claude AI (formats response)
    ↓ (sends reply)
Meta WhatsApp Cloud API
    ↓
WhatsApp User
```

---

## 🔧 Troubleshooting

| Problem | Solution |
|---|---|
| Webhook verification fails | Check `WHATSAPP_VERIFY_TOKEN` matches exactly |
| No response to messages | Check `ADMIN_PHONE_NUMBERS` includes your number with country code |
| "No performance data" | Ensure your Meta token has `ads_read` and `ads_management` permissions |
| Budget change fails | Token needs `ads_management` permission |
| Build fails on Railway | Check Node.js version ≥18 in package.json engines |

---

## 📦 Required Meta Token Permissions

Your access token needs these permissions:
- `whatsapp_business_messaging`
- `whatsapp_business_management`
- `ads_read`
- `ads_management`
- `business_management`

---

## 🔄 Updating the Bot

```bash
git add .
git commit -m "Update bot"
git push origin main
```
Railway auto-deploys on every push to `main`.

---

## 📞 Support

Check Railway logs: Dashboard → your service → **Logs** tab for real-time debugging.
