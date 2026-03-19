# Deploying Pin Studio to DigitalOcean

This guide deploys Pin Studio as a **Node.js app on DigitalOcean App Platform** with photos stored permanently in **DigitalOcean Spaces** (S3-compatible object storage).

**Time required:** ~25 minutes
**Cost:** ~$5/month (App Platform Basic) + Spaces free tier (250 GB included)

> If you're already set up on Vercel and just want a DO alternative, this is a fully independent path — both deployments can exist at the same time.

---

## How it works

```
Browser  →  App Platform (serves HTML/CSS/JS + Node.js server)
               └─ POST /api/upload  →  DigitalOcean Spaces (stores image)
                                           └─ returns public URL  →  saved in pin
```

The Express server in `server.js` does two things:
1. Serves your static files (`index.html`, `styles.css`, `app.js`)
2. Handles `POST /api/upload` — receives the image, uploads it to Spaces, returns the permanent public URL

`app.js` already detects when it's deployed (not localhost) and routes photo uploads to `/api/upload` automatically.

---

## Prerequisites

- A free [DigitalOcean account](https://www.digitalocean.com) (credit card required, but won't be charged for the free trial)
- A [GitHub account](https://github.com) with your Pin Studio repo already pushed
  - If you haven't done this yet, follow **Part 1** of [DEPLOY.md](DEPLOY.md) first

---

## Part 1 — Create a Space for image storage

DigitalOcean Spaces is where your uploaded photos will live.

### 1. Create the Space

1. Log in to [cloud.digitalocean.com](https://cloud.digitalocean.com)
2. In the left sidebar, click **Spaces Object Storage**
3. Click **Create a Space**
4. Choose a region close to you (e.g. **New York** = `nyc3`, **Amsterdam** = `ams3`, **Singapore** = `sgp1`)
5. Under **File Listing**, select **Restrict File Listing** (your individual files will still be public; this just hides directory browsing)
6. Name your Space — e.g. `pin-studio-images` (must be globally unique; add your username if needed)
7. Click **Create a Space**

Note down:
- **Space name** (e.g. `pin-studio-images`)
- **Region slug** — shown in the Space URL, e.g. `nyc3` from `pin-studio-images.nyc3.digitaloceanspaces.com`

### 2. Enable CDN (recommended)

1. Click into your new Space
2. Go to the **Settings** tab
3. Under **CDN**, click **Enable CDN**
4. Leave the subdomain as auto-generated and click **Enable CDN**

This gives your images a faster delivery URL. The server already uses the standard endpoint; CDN works automatically for the same files.

### 3. Generate Spaces access keys

Spaces has its own API keys, separate from your main DigitalOcean account.

1. In the left sidebar, go to **API**
2. Click the **Spaces Keys** tab
3. Click **Generate New Key**
4. Name it `pin-studio`
5. Copy both values immediately — **the secret is only shown once**:
   - `Access Key` (starts with something like `DO00...`)
   - `Secret Key` (a long random string)

Keep these safe. You'll paste them into App Platform in Part 2.

---

## Part 2 — Deploy with App Platform

### 4. Create a new App

1. In the left sidebar, click **App Platform**
2. Click **Create App**
3. Choose **GitHub** as the source
4. Authorise DigitalOcean to access your GitHub if prompted
5. Select your `pin-studio` repository
6. Choose the `main` branch
7. Leave **Autodeploy** enabled (every push to `main` will redeploy automatically)
8. Click **Next**

### 5. Configure the component

App Platform detects `package.json` and proposes a Node.js component. Confirm or set:

| Setting | Value |
|---|---|
| **Type** | Web Service |
| **Run Command** | `npm start` |
| **HTTP Port** | `3000` |
| **Instance Size** | Basic — $5/mo (512 MB RAM) |

Click **Next**.

### 6. Set environment variables

This is the critical step. Click **Edit** next to the component, then go to **Environment Variables** and add all four:

| Key | Value | Encrypted? |
|---|---|---|
| `DO_SPACES_REGION` | `nyc3` (or your region slug) | No |
| `DO_SPACES_BUCKET` | `pin-studio-images` (your Space name) | No |
| `DO_SPACES_KEY` | your Spaces access key | **Yes** |
| `DO_SPACES_SECRET` | your Spaces secret key | **Yes** |

> Mark `DO_SPACES_KEY` and `DO_SPACES_SECRET` as **Encrypted** so they're hidden in logs and the dashboard.

Click **Save**, then **Next**, then **Create Resources**.

### 7. Wait for the build

App Platform will:
1. Clone your repo
2. Run `npm install` (installs Express, AWS SDK)
3. Run `npm start` (starts `server.js`)

This takes 2–3 minutes. When the status turns green and shows **Deployed**, click the live URL shown at the top (e.g. `https://pin-studio-abc12.ondigitalocean.app`).

---

## Part 3 — Test it

1. Open your live URL
2. Click **Add Pin Badge**
3. Upload a photo — you'll see **"Uploading photo…"** briefly, then the image appears
4. Save the pin
5. The photo URL in your saved pin will start with `https://pin-studio-images.nyc3.digitaloceanspaces.com/pins/...`

To verify the image is in your Space:
1. Go back to DigitalOcean → **Spaces** → your Space
2. Open the `pins/` folder — your uploaded files appear there

---

## Part 4 — Ongoing deploys

Every time you push code to GitHub, App Platform automatically rebuilds and redeploys. No manual steps needed.

```bash
git add .
git commit -m "your change"
git push
```

You can watch the deployment in the **Activity** tab of your App Platform dashboard.

---

## Part 5 — Custom domain (optional)

1. In App Platform, go to your app → **Settings** → **Domains**
2. Click **Add Domain**
3. Enter your domain (e.g. `pinstudio.com`)
4. DigitalOcean shows you the DNS records to add at your registrar
5. HTTPS is provisioned automatically via Let's Encrypt

---

## Troubleshooting

### "Upload failed — please try again"

The server logged the real error. To see it:
1. App Platform dashboard → your app → **Runtime Logs** tab
2. Look for `[upload] Spaces error:` lines

Common causes:
| Error | Fix |
|---|---|
| `InvalidAccessKeyId` | `DO_SPACES_KEY` value is wrong — regenerate keys in DO API → Spaces Keys |
| `SignatureDoesNotMatch` | `DO_SPACES_SECRET` was copied with extra whitespace — re-paste it |
| `NoSuchBucket` | `DO_SPACES_BUCKET` value doesn't match the actual Space name exactly |
| `RequestTimeout` | Temporary network issue — try again |

### The app loads but photos from localStorage don't appear

If you had pins with base64 photos saved locally and export/imported them into the deployed version, those base64 strings will still display fine — they're embedded in the pin data. Only **new** uploads on the deployed site go through Spaces.

### I need to delete uploaded images

1. Go to DigitalOcean → Spaces → your Space → `pins/` folder
2. Select files and click **Delete**

Or use the DigitalOcean CLI:
```bash
doctl compute spaces delete-object pin-studio-images pins/your-file.jpg
```

---

## File structure summary

```
pin-studio/
├── index.html                    ← app UI
├── styles.css                    ← all styles
├── app.js                        ← app logic (auto-detects local vs deployed)
├── server.js                     ← Express server (used by DigitalOcean only)
├── api/
│   └── upload.js                 ← Vercel serverless function (used by Vercel only)
├── package.json                  ← dependencies for both deployment targets
├── DEPLOY.md                     ← Vercel deployment tutorial
└── DEPLOY_DIGITALOCEAN.md        ← this file
```

### Which server runs where

| Platform | What runs | Image storage |
|---|---|---|
| **Local** (`localhost`) | Open `index.html` directly in browser | base64 in localStorage |
| **Vercel** | `api/upload.js` (serverless function) | Vercel Blob |
| **DigitalOcean** | `server.js` (Express, port 3000) | DigitalOcean Spaces |

`app.js` is the same in all three cases — it just posts to `/api/upload` when not on localhost, and whichever server is running handles it.

---

## Cost reference

| Resource | Free tier | Paid |
|---|---|---|
| App Platform | 3 static sites free; Node.js from $5/mo | $5/mo (Basic, 512 MB) |
| Spaces | First 250 GB storage + 1 TB transfer free | $0.02/GB after |
| CDN | Included with Spaces | — |

For a personal pin collection, you'll realistically stay within the free Spaces tier indefinitely.
