# Pin Studio — Engineer Onboarding Guide

This guide walks you through adding a **user account system** to Pin Studio so each person has their own private collection, with photos stored in DigitalOcean Spaces and pin data stored in a DigitalOcean Managed PostgreSQL database.

**What you will build:**
- Sign up / log in screen (email + password)
- Per-user pin collections stored in Postgres (replacing browser localStorage)
- Photo uploads stored in DigitalOcean Spaces (already wired in `server.js`)
- JWT-based authentication protecting all API routes

**Time required:** 2–3 hours
**Cost:** ~$20/month (App Platform $5 + Managed Postgres $15 + Spaces free tier)

---

## Table of Contents

1. [How the codebase works today](#1-how-the-codebase-works-today)
2. [Prerequisites](#2-prerequisites)
3. [DigitalOcean — Create a Spaces bucket](#3-digitalocean--create-a-spaces-bucket)
4. [DigitalOcean — Create a Managed PostgreSQL database](#4-digitalocean--create-a-managed-postgresql-database)
5. [Install new dependencies](#5-install-new-dependencies)
6. [Create the database schema](#6-create-the-database-schema)
7. [Update server.js — auth routes + pin API](#7-update-serverjs--auth-routes--pin-api)
8. [Update app.js — swap localStorage for the API](#8-update-appjs--swap-localstorage-for-the-api)
9. [Add the login / sign-up screen to index.html](#9-add-the-login--sign-up-screen-to-indexhtml)
10. [Test locally](#10-test-locally)
11. [Deploy to DigitalOcean App Platform](#11-deploy-to-digitalocean-app-platform)
12. [Set environment variables in App Platform](#12-set-environment-variables-in-app-platform)
13. [Verify the live app](#13-verify-the-live-app)
14. [Troubleshooting](#14-troubleshooting)
15. [Architecture reference](#15-architecture-reference)

---

## 1. How the codebase works today

```
pin-studio/
├── index.html       ← single-page app UI
├── styles.css       ← all styles (Disney-inspired design system)
├── app.js           ← all frontend logic (CRUD, modals, drag-drop photo)
├── server.js        ← Express server (DigitalOcean target)
├── api/upload.js    ← Vercel serverless function (Vercel target only)
└── package.json
```

**Current data flow:**

```
Browser  →  localStorage (pin data, base64 photos)
         →  POST /api/upload  →  DigitalOcean Spaces (deployed photo uploads)
```

**Target data flow after this guide:**

```
Browser  →  POST /api/auth/signup or /api/auth/login  →  returns JWT
         →  GET/POST/PUT/DELETE /api/pins  →  PostgreSQL (per-user pin data)
         →  POST /api/upload  →  DigitalOcean Spaces (photos → public URL)
```

The frontend detects deployment via:
```js
const IS_DEPLOYED = !['localhost', '127.0.0.1', ''].includes(window.location.hostname);
```
When `IS_DEPLOYED` is `false` (local), photos fall back to base64 in `localStorage`. When `true` (deployed), they go through `/api/upload` → Spaces.

---

## 2. Prerequisites

- [Node.js](https://nodejs.org) v18 or later (`node -v` to check)
- [Git](https://git-scm.com) installed
- A [GitHub](https://github.com) account with the `pin-studio` repo already pushed
  _(If not, follow Part 1 of `DEPLOY.md` first)_
- A [DigitalOcean](https://www.digitalocean.com) account (credit card required for signup; free trial credit available)
- A PostgreSQL client for running SQL — the free [TablePlus](https://tableplus.com) app is recommended, or you can use the DigitalOcean web console

---

## 3. DigitalOcean — Create a Spaces bucket

Spaces is where uploaded pin photos are stored as permanent public files.

### 3a. Create the Space

1. Log in to [cloud.digitalocean.com](https://cloud.digitalocean.com)
2. Left sidebar → **Spaces Object Storage** → **Create a Space**
3. Choose a region close to your users (e.g. **New York** = `nyc3`)
4. File Listing: select **Restrict File Listing**
5. Name it `pin-studio-images` _(must be globally unique — add your username if taken)_
6. Click **Create a Space**

Note down:
- **Space name:** e.g. `pin-studio-images`
- **Region slug:** visible in the Space URL, e.g. `nyc3`

### 3b. Enable CORS on the Space

The browser uploads directly to the Space, so you need to allow it.

1. Click into your Space → **Settings** tab → **CORS Configurations**
2. Click **Add** and set:

| Field | Value |
|---|---|
| Origin | `*` (or your app domain once deployed) |
| Allowed Methods | `GET`, `PUT`, `POST` |
| Allowed Headers | `*` |

3. Click **Save**

### 3c. Generate Spaces access keys

1. Left sidebar → **API** → **Spaces Keys** tab
2. Click **Generate New Key** → name it `pin-studio`
3. **Copy both values immediately** — the secret is only shown once:
   - `Access Key` (e.g. `DO00ABCDEF123456`)
   - `Secret Key` (long random string)

Store these somewhere safe (e.g. a local `.env` file — see Step 10).

---

## 4. DigitalOcean — Create a Managed PostgreSQL database

### 4a. Create the cluster

1. Left sidebar → **Databases** → **Create Database Cluster**
2. Choose **PostgreSQL** (latest version, currently 16)
3. Region: same as your Space (e.g. `nyc3`)
4. Instance size: **Basic — $15/mo** (1 GB RAM, 10 GB SSD) — sufficient for thousands of users
5. Name it `pin-studio-db`
6. Click **Create Database Cluster** — takes 3–5 minutes to provision

### 4b. Get the connection string

1. Once green/active, click into the cluster
2. Go to the **Connection Details** tab
3. From the **Connection String** dropdown, select **URI**
4. Copy the full URI — it looks like:

```
postgresql://doadmin:YOURPASSWORD@pin-studio-db-do-user-123-0.b.db.ondigitalocean.com:25060/defaultdb?sslmode=require
```

Save this — it becomes your `DATABASE_URL` environment variable.

### 4c. (Optional) Add your IP to the trusted sources

By default, Managed Postgres only accepts connections from within DigitalOcean. To connect from your laptop during development:

1. Cluster page → **Settings** tab → **Trusted Sources**
2. Click **Edit** → **Add trusted source** → enter your IP address
3. Click **Save**

Get your IP from [whatismyip.com](https://whatismyip.com).

---

## 5. Install new dependencies

In your `pin-studio` project folder, run:

```bash
npm install pg bcryptjs jsonwebtoken
```

| Package | Purpose |
|---|---|
| `pg` | PostgreSQL client for Node.js |
| `bcryptjs` | Password hashing (never store plain-text passwords) |
| `jsonwebtoken` | Creates and verifies JWT tokens for session management |

Your `package.json` dependencies section should now include all three.

---

## 6. Create the database schema

Connect to your Postgres database using TablePlus (or the DigitalOcean web console via **Databases → your cluster → Console tab**) and run the following SQL:

```sql
-- Users: one row per account
CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,          -- bcrypt hash, never plain text
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pins: one row per pin, linked to a user
CREATE TABLE pins (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  notes       TEXT,
  photo       TEXT,                  -- DigitalOcean Spaces public URL (or null)
  favourite   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index so fetching all pins for a user is fast
CREATE INDEX pins_user_id_idx ON pins(user_id);
```

> `ON DELETE CASCADE` means if a user account is deleted, all their pins are automatically deleted too.

To verify it worked, run:
```sql
\dt
```
You should see both `users` and `pins` tables listed.

---

## 7. Update server.js — auth routes + pin API

Open `server.js` and replace the entire file with the following. The key additions over the existing file are:
- `pg`, `bcryptjs`, `jsonwebtoken` imports
- `requireAuth` middleware
- Auth routes (`/api/auth/signup`, `/api/auth/login`)
- Pin CRUD routes (`/api/pins` GET/POST/PUT/DELETE)
- The existing `/api/upload` route now requires auth

```js
'use strict';

const express  = require('express');
const path     = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Database ──────────────────────────────────────────────────────────────────

const db = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Spaces client ─────────────────────────────────────────────────────────────

const spacesClient = new S3Client({
  endpoint:    `https://${process.env.DO_SPACES_REGION}.digitaloceanspaces.com`,
  region:       process.env.DO_SPACES_REGION || 'nyc3',
  credentials: {
    accessKeyId:     process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
  },
});

// ── Static files ──────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname)));

// ── Auth middleware ───────────────────────────────────────────────────────────
// Reads the JWT from the Authorization header and attaches req.user.
// Any route that calls requireAuth will return 401 if the token is missing
// or has been tampered with.

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── POST /api/auth/signup ─────────────────────────────────────────────────────

app.post('/api/auth/signup', express.json(), async (req, res) => {
  const { email, password, name } = req.body || {};

  if (!email || !password || !name)
    return res.status(400).json({ error: 'Email, password, and name are required' });

  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const hash = await bcrypt.hash(password, 12);

  try {
    const { rows } = await db.query(
      `INSERT INTO users (email, password, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [email.toLowerCase().trim(), hash, name.trim()]
    );
    const token = jwt.sign(
      { id: rows[0].id, email: rows[0].email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.status(201).json({ token, user: rows[0] });
  } catch (err) {
    if (err.code === '23505')  // unique_violation
      return res.status(409).json({ error: 'An account with that email already exists' });
    console.error('[signup]', err.message);
    res.status(500).json({ error: 'Sign up failed — please try again' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

app.post('/api/auth/login', express.json(), async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' });

  const { rows } = await db.query(
    'SELECT * FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  );

  const user = rows[0];
  if (!user || !await bcrypt.compare(password, user.password))
    return res.status(401).json({ error: 'Incorrect email or password' });

  const token = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// ── GET /api/pins — fetch the signed-in user's pins ───────────────────────────

app.get('/api/pins', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM pins WHERE user_id = $1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json(rows);
});

// ── POST /api/pins — add a pin ────────────────────────────────────────────────

app.post('/api/pins', requireAuth, express.json(), async (req, res) => {
  const { name, category, notes, photo } = req.body || {};

  if (!name || !category)
    return res.status(400).json({ error: 'Name and category are required' });

  const { rows } = await db.query(
    `INSERT INTO pins (user_id, name, category, notes, photo)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [req.user.id, name.trim(), category, notes?.trim() || null, photo || null]
  );
  res.status(201).json(rows[0]);
});

// ── PUT /api/pins/:id — update a pin ─────────────────────────────────────────

app.put('/api/pins/:id', requireAuth, express.json(), async (req, res) => {
  const { name, category, notes, photo, favourite } = req.body || {};

  const { rows } = await db.query(
    `UPDATE pins
     SET name = $1, category = $2, notes = $3, photo = $4, favourite = $5
     WHERE id = $6 AND user_id = $7
     RETURNING *`,
    [
      name?.trim(), category,
      notes?.trim() || null,
      photo || null,
      !!favourite,
      req.params.id,
      req.user.id,
    ]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Pin not found' });
  res.json(rows[0]);
});

// ── DELETE /api/pins/:id — remove a pin ──────────────────────────────────────

app.delete('/api/pins/:id', requireAuth, async (req, res) => {
  await db.query(
    'DELETE FROM pins WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

// ── POST /api/upload — upload photo to Spaces ─────────────────────────────────

app.post(
  '/api/upload',
  requireAuth,
  express.raw({ type: ['image/*', 'application/octet-stream'], limit: '10mb' }),
  async (req, res) => {
    if (!req.body?.length)
      return res.status(400).json({ error: 'No image received' });

    const rawType = (req.headers['content-type'] || '').toLowerCase();
    if (!rawType.startsWith('image/'))
      return res.status(400).json({ error: 'Invalid image type' });

    const filename    = req.query.filename
      ? decodeURIComponent(req.query.filename)
      : `pin-${Date.now()}.jpg`;
    const key         = `pins/${Date.now()}-${filename}`;
    const contentType = req.headers['content-type'] || 'image/jpeg';

    try {
      await spacesClient.send(new PutObjectCommand({
        Bucket:      process.env.DO_SPACES_BUCKET,
        Key:         key,
        Body:        req.body,
        ACL:         'public-read',
        ContentType: contentType,
      }));

      const url = `https://${process.env.DO_SPACES_BUCKET}`
                + `.${process.env.DO_SPACES_REGION}`
                + `.digitaloceanspaces.com/${key}`;

      res.json({ url });
    } catch (err) {
      console.error('[upload] Spaces error:', err.message);
      res.status(500).json({ error: 'Upload failed — please try again' });
    }
  }
);

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Pin Studio running at http://localhost:${PORT}`);
});
```

---

## 8. Update app.js — swap localStorage for the API

The frontend needs three new things:
1. A JWT stored in `localStorage` (key: `pinStudio_token`)
2. Helper functions that send the token on every API request
3. All pin CRUD calls replaced with `fetch()` calls to the server

### 8a. Add near the top of app.js (after the constants, before State)

```js
// ── Auth helpers ──────────────────────────────────────────
const AUTH_KEY = 'pinStudio_token';

function getToken()      { return localStorage.getItem(AUTH_KEY); }
function saveToken(t)    { localStorage.setItem(AUTH_KEY, t); }
function clearToken()    { localStorage.removeItem(AUTH_KEY); }
function isLoggedIn()    { return !!getToken(); }

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${getToken()}`, ...extra };
}
```

### 8b. Replace the loadPins / savePins functions

Remove:
```js
function loadPins() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function savePins() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
}
```

Replace with:
```js
async function loadPins() {
  if (!isLoggedIn()) return [];
  const res = await fetch('/api/pins', { headers: authHeaders() });
  if (res.status === 401) { handleLogout(); return []; }
  return res.ok ? res.json() : [];
}
```

### 8c. Replace the CRUD functions

```js
async function addPin(data) {
  const res = await fetch('/api/pins', {
    method:  'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to save pin');
  const pin = await res.json();
  pins.unshift(pin);
}

async function updatePin(id, data) {
  const res = await fetch(`/api/pins/${id}`, {
    method:  'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update pin');
  const updated = await res.json();
  const idx = pins.findIndex(p => p.id === id);
  if (idx !== -1) pins[idx] = updated;
}

async function deletePin(id) {
  await fetch(`/api/pins/${id}`, {
    method:  'DELETE',
    headers: authHeaders(),
  });
  pins = pins.filter(p => p.id !== id);
}

async function toggleFavourite(id) {
  const pin = pins.find(p => p.id === id);
  if (!pin) return;
  await updatePin(id, { ...pin, favourite: !pin.favourite });
  render();
  showToast(pin.favourite ? `"${pin.name}" removed from favourites` : `"${pin.name}" added to favourites ★`);
}
```

### 8d. Update the init block at the bottom

Replace `render();` with an async init:

```js
async function init() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'fun');
  if (!isLoggedIn()) {
    showAuthScreen();
    return;
  }
  pins = await loadPins();
  render();
}

function showAuthScreen() {
  document.getElementById('authScreen').style.display  = 'flex';
  document.getElementById('app').style.display         = 'none';
}

function showApp() {
  document.getElementById('authScreen').style.display  = 'none';
  document.getElementById('app').style.display         = 'block';
}

function handleLogout() {
  clearToken();
  pins = [];
  showAuthScreen();
}

init();
```

### 8e. Add auth form event listeners

```js
document.getElementById('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const isSignup = document.getElementById('authMode').dataset.mode === 'signup';
  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const name     = document.getElementById('authName')?.value.trim();

  const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login';
  const body     = isSignup ? { email, password, name } : { email, password };

  const res  = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) { showToast(data.error || 'Authentication failed'); return; }

  saveToken(data.token);
  pins = await loadPins();
  showApp();
  render();
});

document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);

document.getElementById('authToggleLink')?.addEventListener('click', e => {
  e.preventDefault();
  const modeEl = document.getElementById('authMode');
  const isSignup = modeEl.dataset.mode === 'signup';
  modeEl.dataset.mode = isSignup ? 'login' : 'signup';
  document.getElementById('authNameGroup').style.display  = isSignup ? 'none' : 'block';
  document.getElementById('authTitle').textContent        = isSignup ? 'Welcome back' : 'Create your account';
  document.getElementById('authSubmitBtn').textContent    = isSignup ? 'Log in' : 'Create account';
  document.getElementById('authToggleText').textContent   = isSignup ? "Don't have an account? " : 'Already have an account? ';
  document.getElementById('authToggleLink').textContent   = isSignup ? 'Sign up' : 'Log in';
});
```

---

## 9. Add the login / sign-up screen to index.html

Wrap your existing app content in a `<div id="app">` and add the auth screen before it. Place this inside `<body>`, before the hero section:

```html
<!-- Auth screen — shown when no JWT is present -->
<div id="authScreen" style="display:none; align-items:center; justify-content:center;
     min-height:100vh; background:linear-gradient(135deg,#2d1b69,#7c4dff,#ff6b9d);">
  <div style="background:#fff; border-radius:24px; padding:40px; width:100%;
              max-width:400px; box-shadow:0 20px 60px rgba(0,0,0,0.3);">

    <h2 id="authTitle" style="font-family:'Fredoka One',sans-serif; font-size:1.8rem;
        color:#7c4dff; margin:0 0 24px; text-align:center;">Create your account</h2>

    <form id="authForm">
      <div id="authMode" data-mode="signup"></div>

      <div id="authNameGroup" style="margin-bottom:16px;">
        <label style="display:block; font-weight:700; margin-bottom:6px; color:#555;">
          Your name
        </label>
        <input id="authName" type="text" placeholder="e.g. Alex"
          style="width:100%; padding:12px 16px; border:2px solid #e0d7ff;
                 border-radius:12px; font-size:1rem; box-sizing:border-box;"/>
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block; font-weight:700; margin-bottom:6px; color:#555;">
          Email
        </label>
        <input id="authEmail" type="email" placeholder="you@example.com" required
          style="width:100%; padding:12px 16px; border:2px solid #e0d7ff;
                 border-radius:12px; font-size:1rem; box-sizing:border-box;"/>
      </div>

      <div style="margin-bottom:24px;">
        <label style="display:block; font-weight:700; margin-bottom:6px; color:#555;">
          Password
        </label>
        <input id="authPassword" type="password" placeholder="At least 8 characters" required
          style="width:100%; padding:12px 16px; border:2px solid #e0d7ff;
                 border-radius:12px; font-size:1rem; box-sizing:border-box;"/>
      </div>

      <button id="authSubmitBtn" type="submit"
        style="width:100%; padding:14px; background:linear-gradient(135deg,#7c4dff,#ff6b9d);
               color:#fff; border:none; border-radius:12px; font-size:1.1rem;
               font-family:'Fredoka One',sans-serif; cursor:pointer;">
        Create account
      </button>
    </form>

    <p style="text-align:center; margin-top:20px; color:#777;">
      <span id="authToggleText">Already have an account? </span>
      <a id="authToggleLink" href="#"
         style="color:#7c4dff; font-weight:700; text-decoration:none;">Log in</a>
    </p>
  </div>
</div>

<!-- Main app — shown after login -->
<div id="app" style="display:none;">
  <!-- ... all existing app HTML goes here (hero, collection, modals, footer) ... -->
</div>
```

Also add a **Log out** button to the nav/toolbar inside `#app`:

```html
<button id="logoutBtn"
  style="background:transparent; border:2px solid #fff; color:#fff; border-radius:20px;
         padding:6px 16px; cursor:pointer; font-family:'Nunito',sans-serif; font-weight:700;">
  Log out
</button>
```

---

## 10. Test locally

### 10a. Create a local .env file

Create a file called `.env` in the project root (never commit this):

```
DATABASE_URL=postgresql://doadmin:YOURPASSWORD@your-db-host:25060/defaultdb?sslmode=require
JWT_SECRET=pick-a-long-random-string-at-least-32-chars
DO_SPACES_REGION=nyc3
DO_SPACES_BUCKET=pin-studio-images
DO_SPACES_KEY=your-spaces-access-key
DO_SPACES_SECRET=your-spaces-secret-key
PORT=3000
```

### 10b. Load the .env file

Install `dotenv`:
```bash
npm install dotenv
```

Add this as the very first line of `server.js`:
```js
require('dotenv').config();
```

> `dotenv` reads `.env` into `process.env` on startup. On App Platform, environment variables are injected directly and dotenv is not needed, but it won't cause any problems if present.

### 10c. Add .env to .gitignore

```bash
echo ".env" >> .gitignore
```

### 10d. Start the server

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) — you should see the sign-up screen.

**Test checklist:**
- [ ] Sign up with a new email → you're taken to the main app
- [ ] Log out → auth screen reappears
- [ ] Log in with the same email and password → collection reloads
- [ ] Add a pin (without photo) → appears in the grid
- [ ] Edit the pin → changes persist after page refresh
- [ ] Delete the pin → gone after refresh
- [ ] Upload a photo → if on localhost the photo is stored as base64 (expected)
- [ ] Try signing up again with the same email → error "already exists"

---

## 11. Deploy to DigitalOcean App Platform

### 11a. Push your changes to GitHub

```bash
git add index.html app.js server.js package.json package-lock.json .gitignore
git commit -m "Add user accounts, Postgres storage, and photo uploads"
git push
```

> Do **not** add `.env` or `node_modules/` to git.

### 11b. Create the App Platform app

1. DigitalOcean → **App Platform** → **Create App**
2. Source: **GitHub** → select your `pin-studio` repo → `main` branch
3. **Autodeploy:** leave enabled
4. Click **Next**

### 11c. Configure the component

App Platform detects `package.json` automatically. Confirm:

| Setting | Value |
|---|---|
| Type | Web Service |
| Run Command | `npm start` |
| HTTP Port | `3000` |
| Instance Size | Basic — $5/mo |

Click **Next**.

---

## 12. Set environment variables in App Platform

Click **Edit** next to your component → **Environment Variables** tab → add all six:

| Key | Value | Encrypt? |
|---|---|---|
| `DATABASE_URL` | your full Postgres URI | **Yes** |
| `JWT_SECRET` | your random secret string | **Yes** |
| `DO_SPACES_REGION` | `nyc3` | No |
| `DO_SPACES_BUCKET` | `pin-studio-images` | No |
| `DO_SPACES_KEY` | your Spaces access key | **Yes** |
| `DO_SPACES_SECRET` | your Spaces secret key | **Yes** |

> Mark the sensitive values as **Encrypted** — they'll be hidden in logs and the dashboard.

Click **Save** → **Next** → **Create Resources**.

The first deployment takes 3–5 minutes. When the status turns green, click the live URL.

---

## 13. Verify the live app

Run through this checklist on the live URL:

- [ ] Sign-up form appears on first visit
- [ ] Creating an account works and loads the app
- [ ] Adding a pin saves correctly and survives a page refresh
- [ ] Uploading a photo shows **"Uploading photo…"** toast and the image loads from a `digitaloceanspaces.com` URL
- [ ] Logging out and logging back in restores the same collection
- [ ] A second account has its own separate empty collection

---

## 14. Troubleshooting

### "Upload failed — please try again"

1. App Platform → your app → **Runtime Logs** tab
2. Look for lines starting with `[upload] Spaces error:`

| Error message | Fix |
|---|---|
| `InvalidAccessKeyId` | Wrong `DO_SPACES_KEY` — regenerate in DO API → Spaces Keys |
| `SignatureDoesNotMatch` | `DO_SPACES_SECRET` has extra whitespace — re-paste carefully |
| `NoSuchBucket` | `DO_SPACES_BUCKET` doesn't exactly match your Space name |
| `NetworkingError` | Region mismatch — confirm `DO_SPACES_REGION` matches where you created the Space |

### "Not authenticated" on all API calls

- The JWT may have expired (30-day lifetime). Log out and log in again.
- In the browser console, run `localStorage.getItem('pinStudio_token')` — if it's `null` the token was cleared.

### Database connection errors on startup

- Check `DATABASE_URL` is correct and the full URI is pasted without line breaks
- Confirm App Platform's outbound IPs are in your Postgres cluster's **Trusted Sources**. In App Platform → your app → **Settings** → **Info** you can see the outgoing IP range to whitelist.

### "An account with that email already exists" but I didn't create one

- Check the `users` table directly: `SELECT email, created_at FROM users;`
- Use the DigitalOcean database console (Databases → your cluster → Console tab)

### Pins from localStorage are gone

This is expected — the new system uses Postgres, not localStorage. Pins created before the user system was added are not migrated automatically. If you need to preserve them, they can be re-added through the UI or migrated manually via a one-time import script.

---

## 15. Architecture reference

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (index.html + app.js + styles.css)                     │
│                                                                  │
│  1. No JWT → show auth screen                                    │
│  2. Sign up/login → receive JWT → store in localStorage         │
│  3. All API calls send:  Authorization: Bearer <jwt>            │
└───────────────────┬─────────────────────────────────────────────┘
                    │  HTTPS
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  DigitalOcean App Platform  (server.js — Node.js / Express)     │
│                                                                  │
│  POST /api/auth/signup  → hash password → INSERT users         │
│  POST /api/auth/login   → verify password → return JWT         │
│  GET  /api/pins         → SELECT * FROM pins WHERE user_id=…   │
│  POST /api/pins         → INSERT INTO pins …                   │
│  PUT  /api/pins/:id     → UPDATE pins WHERE id=… AND user_id=… │
│  DELETE /api/pins/:id   → DELETE FROM pins WHERE …             │
│  POST /api/upload       → stream image → Spaces → return URL   │
└──────────┬────────────────────────────┬────────────────────────┘
           │                            │
           ▼                            ▼
┌──────────────────────┐   ┌────────────────────────────────┐
│  Managed PostgreSQL  │   │  DigitalOcean Spaces            │
│                      │   │                                │
│  Table: users        │   │  pins/timestamp-filename.jpg  │
│  Table: pins         │   │  (public CDN URLs)            │
└──────────────────────┘   └────────────────────────────────┘
```

### Environment variables summary

| Variable | Where it's used | Example |
|---|---|---|
| `DATABASE_URL` | `server.js` — Postgres connection | `postgresql://…` |
| `JWT_SECRET` | `server.js` — sign/verify tokens | `my-super-secret-32char+` |
| `DO_SPACES_REGION` | `server.js` — Spaces endpoint | `nyc3` |
| `DO_SPACES_BUCKET` | `server.js` — target bucket | `pin-studio-images` |
| `DO_SPACES_KEY` | `server.js` — Spaces auth | `DO00ABC…` |
| `DO_SPACES_SECRET` | `server.js` — Spaces auth | `xyz123…` |
| `PORT` | `server.js` — listen port | `3000` (App Platform sets this automatically) |

### API endpoints summary

| Method | Path | Auth required | Description |
|---|---|---|---|
| `POST` | `/api/auth/signup` | No | Create account, returns JWT |
| `POST` | `/api/auth/login` | No | Log in, returns JWT |
| `GET` | `/api/pins` | Yes | Fetch all pins for current user |
| `POST` | `/api/pins` | Yes | Add a pin |
| `PUT` | `/api/pins/:id` | Yes | Update a pin |
| `DELETE` | `/api/pins/:id` | Yes | Delete a pin |
| `POST` | `/api/upload` | Yes | Upload photo → Spaces, returns URL |
