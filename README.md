# SalesDesk — Deployment Guide

## Files in this project
```
salesdesk/
├── api/
│   └── extract.js        ← Backend (keeps your API key secret)
├── src/
│   ├── main.jsx          ← Entry point
│   └── App.jsx           ← Main app
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
└── .gitignore
```

---

## Step 1 — Get your Anthropic API key
1. Go to https://console.anthropic.com
2. Sign up / log in
3. Click **API Keys** → **Create Key**
4. Copy the key — you'll need it in Step 4

---

## Step 2 — Upload to GitHub
1. Go to https://github.com and create a **New repository** called `salesdesk`
2. Upload all the files from this folder into that repo (drag and drop works)
3. Click **Commit changes**

---

## Step 3 — Deploy to Vercel
1. Go to https://vercel.com and log in with GitHub
2. Click **Add New Project**
3. Select your `salesdesk` repository
4. Click **Deploy** — Vercel auto-detects Vite

---

## Step 4 — Add your API key to Vercel
1. In Vercel, go to your project → **Settings** → **Environment Variables**
2. Add a new variable:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** your key from Step 1
3. Click **Save**
4. Go to **Deployments** → click **Redeploy**

---

## Done!
Your app is now live at `https://salesdesk.vercel.app` (or similar).

## Optional — Custom domain
1. Buy a domain at https://namecheap.com (around $10-15/year)
2. In Vercel → **Settings** → **Domains** → add your domain
3. Follow Vercel's instructions to point your domain to Vercel
