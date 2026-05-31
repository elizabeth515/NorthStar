# Build the House — Setup Guide

## Step 1: Run the database setup

1. Go to your Supabase project → **SQL Editor**
2. Open `setup.sql` from this repo
3. Paste the entire contents and click **Run**

## Step 2: Enable Email Auth in Supabase

1. In Supabase, go to **Authentication → Providers**
2. Make sure **Email** is enabled
3. Optional: turn off "Confirm email" for easier testing (Authentication → Settings → uncheck "Enable email confirmations")

## Step 3: Push to GitHub

Push all these files to your GitHub repo as-is.

## Step 4: Deploy on Vercel

1. Go to vercel.com and sign in
2. Click **Add New → Project**
3. Import your GitHub repo
4. Vercel auto-detects Vite — no build settings needed
5. Click **Deploy**

That's it. Your app will be live at a `*.vercel.app` URL.

## Adding agents

Each agent creates their own account at your app URL using **Create account**. Their name and email are stored automatically. They'll appear in the agent filter sidebar immediately.

## Local development (optional)

```bash
npm install
npm run dev
```
