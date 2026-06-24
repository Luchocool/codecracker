# Deploying CodeCracker

A step-by-step guide to get your game online for free so anyone can play.

## Option 1: Render (Recommended)

[Render](https://render.com) has a free tier that supports WebSockets (required for the real-time game).

### 1. Push your code to GitHub

Create a repo on [github.com](https://github.com/new), then in your project folder:

```bash
git init
git add -A
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/CodeCracker.git
git push -u origin main
```

### 2. Create a Web Service on Render

1. Go to [dashboard.render.com](https://dashboard.render.com) and click **New +** → **Web Service**
2. Connect your GitHub repo
3. Fill in:
   - **Name:** `codecracker` (or whatever you want)
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Under **Plan**, select **Free**
5. Click **Create Web Service**

Render will deploy automatically. Once done, your game is live at `https://codecracker.onrender.com`.

> **Note:** On the free plan, the server goes to sleep after 15 minutes of inactivity. The first visitor after a sleep will wait ~30 seconds while it wakes up. This only affects free tier — upgrade to keep it always-on.

### 3. (Optional) Custom domain

In your Render dashboard → your service → **Settings** → **Custom Domain**. You'll need to own a domain and point its DNS to Render.

---

## Option 2: Railway

[Railway](https://railway.com) offers $5 of free credit/month (no credit card required to start).

### 1. Push to GitHub (same as Render step 1 above)

### 2. Deploy on Railway

1. Go to [railway.com/new](https://railway.com/new) and click **Deploy from GitHub repo**
2. Select your CodeCracker repo
3. Railway auto-detects Node.js — no config needed
4. Click **Deploy**

Your app will be live at `https://codecracker.up.railway.app` (or similar).

---

## Verifying it works

1. Open the URL in one browser tab → click **PLAY** → **Create a Room**
2. Open the URL in a second tab (or on your phone on the same network) → click **PLAY** → enter the room code → **Join**
3. If both players can see each other and the game works, you're live.

---

## Known issues & fixes

| Issue | Fix |
|-------|-----|
| "This site can't be reached" | Wait 30s if on Render free plan (cold start). |
| Players can't connect | Make sure your hosting supports **WebSockets** (Render and Railway do). |
| Room doesn't appear | Both players must use the **same URL** (with `https://`). |
| Console shows CORS errors | Socket.io and Express are on the same domain, so this shouldn't happen. Check that you're using the correct URL. |

---

## Production checklist

Before sharing your link publicly:

- [ ] Test with two devices (not just two tabs on the same machine)
- [ ] Make sure the game works over HTTPS (both Render and Railway provide this automatically)
- [ ] Check that refreshing the page during a game doesn't break anything (it will reset your connection — that's expected)
- [ ] Consider adding a favicon if desired
