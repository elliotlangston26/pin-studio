# Deploying Pin Studio to Vercel

This guide takes you from local files to a live public URL with permanent image storage via **Vercel Blob**.

**Time required:** ~20 minutes
**Cost:** Free (Vercel Hobby plan)

---

## What changes when deployed

| Feature | Local (dev) | Deployed (Vercel) |
|---|---|---|
| Pin data | Browser `localStorage` | Browser `localStorage` |
| Photos | Base64 in `localStorage` | Permanent URL in **Vercel Blob** |
| URL | `http://localhost` | `https://your-app.vercel.app` |

Photos uploaded locally are stored as base64 in your browser — they stay on your machine. Once deployed, photos are uploaded to Vercel Blob and stored permanently as public URLs, so your collection works on any device and survives browser clears.

---

## Prerequisites

- A free account at [github.com](https://github.com)
- A free account at [vercel.com](https://vercel.com) — sign up with your GitHub account
- [Git](https://git-scm.com/downloads) installed on your machine
- [Node.js](https://nodejs.org) (v18 or later) installed — needed for Vercel CLI

---

## Part 1 — Push to GitHub

### 1. Create a new repository

1. Go to [github.com/new](https://github.com/new)
2. Name it `pin-studio`
3. Leave it **Public** (required for the free Vercel Hobby plan)
4. Do **not** add a README or .gitignore — your files already exist
5. Click **Create repository**

### 2. Initialise Git and push your files

Open Terminal in your Pin Studio folder and run:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/pin-studio.git
git push -u origin main
```

> Replace `YOUR_USERNAME` with your GitHub username. The exact command is shown on the GitHub page after you create the repo.

Your files are now on GitHub. You should see `index.html`, `styles.css`, `app.js`, `api/upload.js`, and `package.json` in the repository.

---

## Part 2 — Deploy on Vercel

### 3. Import the repository

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Continue with GitHub** and authorise Vercel
3. Find `pin-studio` in the list and click **Import**

### 4. Configure the project

Vercel will detect this as a static site. Use these settings:

| Setting | Value |
|---|---|
| Framework Preset | **Other** |
| Root Directory | `.` (leave as-is) |
| Build Command | *(leave empty)* |
| Output Directory | `.` (or leave empty) |

Click **Deploy**.

Vercel will build and deploy in about 30 seconds. You'll get a live URL like `https://pin-studio-abc123.vercel.app`.

> **Test it:** Open the URL, add a pin without a photo, and confirm everything works. Photo uploads will fail at this stage until you set up Blob storage in the next step.

---

## Part 3 — Add Image Storage (Vercel Blob)

### 5. Create a Blob store

1. In your Vercel dashboard, click your `pin-studio` project
2. Go to the **Storage** tab
3. Click **Create Database** → choose **Blob**
4. Name it `pin-studio-images` and click **Create**
5. On the next screen click **Connect Project** and select `pin-studio`

Vercel automatically adds the `BLOB_READ_WRITE_TOKEN` environment variable to your project. The `api/upload.js` function reads this token automatically — you don't need to paste it anywhere in your code.

### 6. Trigger a redeploy

The environment variable is only picked up by a fresh deployment.

1. Go to the **Deployments** tab in your Vercel project
2. Click the three-dot menu on the most recent deployment
3. Click **Redeploy** → confirm

### 7. Test photo uploads

1. Open your live URL
2. Click **Add Pin Badge**
3. Upload a photo
4. You should see **"Uploading photo…"** briefly, then the image appears
5. Save the pin

The photo is now stored permanently at a `public.blob.vercel-storage.com` URL. It will survive browser clears, work on any device, and never expire.

---

## Part 4 — Custom Domain (optional)

1. In your Vercel project, go to **Settings → Domains**
2. Click **Add Domain** and type your domain (e.g. `pinstudio.com`)
3. Follow the DNS instructions shown for your registrar (Vercel supports Namecheap, GoDaddy, Cloudflare, etc.)
4. HTTPS is configured automatically — no extra steps

---

## Ongoing workflow

After making code changes locally:

```bash
git add .
git commit -m "describe your change"
git push
```

Vercel detects the push and automatically redeploys in about 30 seconds. Your live URL stays the same.

---

## Troubleshooting

### Photo upload fails with an error toast

- Check the Vercel dashboard → your project → **Logs** tab for the error
- Most common cause: the Blob store was created but not connected to the project, so `BLOB_READ_WRITE_TOKEN` is missing
- Fix: **Storage** tab → your Blob store → **Projects** → connect `pin-studio` → redeploy

### The site loads but shows a blank page

- Open browser DevTools → **Console** for JavaScript errors
- Most common cause: a file path is wrong in `index.html`
- Check that `styles.css` and `app.js` are referenced with relative paths (they already are)

### Changes aren't showing up after a push

- Check the **Deployments** tab — the deployment may have failed
- Click the failed deployment to see the build log

### I want to delete uploaded test photos

1. In Vercel dashboard → **Storage** → your Blob store → **Browse**
2. Select files and delete them
3. Or use the Vercel CLI: `vercel blob rm pins/filename.jpg`

---

## File structure summary

```
pin-studio/
├── index.html          ← app UI
├── styles.css          ← all styles
├── app.js              ← app logic (auto-detects local vs deployed)
├── package.json        ← declares @vercel/blob dependency
├── api/
│   └── upload.js       ← Vercel Serverless Function: receives image → stores in Blob → returns URL
└── DEPLOY.md           ← this file
```

The `api/upload.js` function is only called when the app is running on Vercel. When you open `index.html` locally, photos are stored as base64 in your browser as before.
