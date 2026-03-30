# Tutorial: Adding a User System to Pin Studio

Move Pin Studio from single-user localStorage to a multi-user app with accounts, login, and a cloud database — all hosted on DigitalOcean.

**Time required:** ~2–3 hours
**Cost:** ~$20/month (App Platform $5 + Managed PostgreSQL $15)
**Prerequisite:** Complete [DEPLOY_DIGITALOCEAN.md](DEPLOY_DIGITALOCEAN.md) first — your app must already be live on App Platform before adding a database.

---

## How the architecture changes

**Before (current):**
```
Browser → localStorage (pins saved per device, per browser)
```

**After:**
```
Browser → Express server → PostgreSQL database (pins saved per account, any device)
             └── Auth: register / login → JWT token stored in browser
```

Each user gets their own account. Their pins are stored in the database under their user ID.

---

## Part 1 — Create the Database

### 1. Create a Managed PostgreSQL cluster

1. Log in to [cloud.digitalocean.com](https://cloud.digitalocean.com)
2. In the left sidebar, click **Databases**
3. Click **Create Database**
4. Choose **PostgreSQL** (version 16 is fine)
5. Select the **same region** as your App Platform app (e.g. `nyc3`)
6. Choose **Basic** plan — **$15/mo** (1 GB RAM, 10 GB storage — plenty for a pin collection)
7. Name it `pin-studio-db`
8. Click **Create Database Cluster**

This takes 3–5 minutes to provision.

### 2. Note your connection details

Once the cluster is ready, click into it and go to the **Connection Details** tab. You'll see:

- **Host** — something like `pin-studio-db-do-user-xxx.db.ondigitalocean.com`
- **Port** — `25060`
- **Database** — `defaultdb`
- **User** — `doadmin`
- **Password** — shown on screen (copy it now)

DigitalOcean also provides a **Connection String** that looks like:
```
postgresql://doadmin:PASSWORD@HOST:25060/defaultdb?sslmode=require
```

Copy this string — you'll add it as an environment variable in App Platform.

### 3. Allow your app to connect

By default the database blocks all connections. You need to trust your App Platform app.

1. Go to the **Trusted Sources** tab of your database cluster
2. Click **Add trusted source**
3. In the dropdown, select your **App Platform app** (it appears by name)
4. Click **Save**

Your app can now connect. External connections (your local machine) are blocked for security.

---

## Part 2 — Design the Database Schema

You need two tables: one for users, one for pins.

### The SQL to create your tables

```sql
-- Users table
CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,           -- bcrypt hash, never plain text
  username   TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pins table (replaces localStorage)
CREATE TABLE pins (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT,
  photo_url   TEXT,                   -- URL from Spaces (or base64 for old pins)
  date_added  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index so "get all pins for user X" is fast
CREATE INDEX idx_pins_user_id ON pins(user_id);
```

### How to run this SQL

**Option A — DigitalOcean console (easiest):**
1. Go to your database cluster → **Databases** tab
2. Click the **>_ Console** button
3. Paste the SQL above and press Enter

**Option B — psql from your terminal:**
```bash
psql "postgresql://doadmin:PASSWORD@HOST:25060/defaultdb?sslmode=require"
```
Then paste the SQL.

---

## Part 3 — Update the Backend

Install the required packages in your project:

```bash
npm install pg bcryptjs jsonwebtoken
```

These do:
- `pg` — connects to PostgreSQL
- `bcryptjs` — hashes passwords (never store plain text)
- `jsonwebtoken` — creates JWT tokens for auth

### Update `package.json` scripts

Make sure this is in your `package.json`:
```json
{
  "scripts": {
    "start": "node server.js"
  }
}
```

### Create `server.js`

Replace your existing `server.js` with this complete version:

```javascript
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));

// --- Database connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }  // required for DO managed postgres
});

// --- JWT secret (set this as an env var) ---
const JWT_SECRET = process.env.JWT_SECRET;

// --- Spaces client (same as before) ---
const s3 = new S3Client({
  endpoint: `https://${process.env.DO_SPACES_REGION}.digitaloceanspaces.com`,
  region: process.env.DO_SPACES_REGION,
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET
  }
});

// --- Auth middleware ---
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const token = header.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ============================================================
// AUTH ROUTES
// ============================================================

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { email, username, password } = req.body;

  if (!email || !username || !password) {
    return res.status(400).json({ error: 'Email, username, and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, username, password) VALUES ($1, $2, $3) RETURNING id, email, username',
      [email.toLowerCase().trim(), username.trim(), hash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email, username: user.username } });
  } catch (err) {
    if (err.code === '23505') {  // unique_violation
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    console.error('[register]', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, username, password FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email, username: user.username } });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me  (verify token and return current user)
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, username, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ============================================================
// PINS ROUTES  (all require auth)
// ============================================================

// GET /api/pins  — get all pins for the logged-in user
app.get('/api/pins', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM pins WHERE user_id = $1 ORDER BY date_added DESC',
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[get pins]', err);
    res.status(500).json({ error: 'Failed to fetch pins' });
  }
});

// POST /api/pins  — create a new pin
app.post('/api/pins', requireAuth, async (req, res) => {
  const { name, category, description, photo_url } = req.body;
  if (!name || !category) {
    return res.status(400).json({ error: 'Name and category are required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO pins (user_id, name, category, description, photo_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.userId, name.trim(), category, description || '', photo_url || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[create pin]', err);
    res.status(500).json({ error: 'Failed to create pin' });
  }
});

// PUT /api/pins/:id  — update a pin (only the owner can)
app.put('/api/pins/:id', requireAuth, async (req, res) => {
  const { name, category, description, photo_url } = req.body;
  try {
    const result = await pool.query(
      `UPDATE pins SET name=$1, category=$2, description=$3, photo_url=$4, updated_at=NOW()
       WHERE id=$5 AND user_id=$6 RETURNING *`,
      [name, category, description || '', photo_url || null, req.params.id, req.user.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Pin not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[update pin]', err);
    res.status(500).json({ error: 'Failed to update pin' });
  }
});

// DELETE /api/pins/:id  — delete a pin (only the owner can)
app.delete('/api/pins/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM pins WHERE id=$1 AND user_id=$2 RETURNING id',
      [req.params.id, req.user.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Pin not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[delete pin]', err);
    res.status(500).json({ error: 'Failed to delete pin' });
  }
});

// ============================================================
// PHOTO UPLOAD (unchanged from existing server)
// ============================================================

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.post('/api/upload', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const key = `pins/${Date.now()}-${req.file.originalname.replace(/[^a-z0-9.]/gi, '_')}`;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'public-read'
    }));
    const url = `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_REGION}.digitaloceanspaces.com/${key}`;
    res.json({ url });
  } catch (err) {
    console.error('[upload] Spaces error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ============================================================
// START
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pin Studio running on port ${PORT}`));
```

---

## Part 4 — Add Environment Variables to App Platform

In addition to the Spaces variables already set, you need two more.

1. Go to App Platform → your app → **Settings** → **App-Level Environment Variables**
2. Add:

| Key | Value | Encrypted? |
|---|---|---|
| `DATABASE_URL` | your PostgreSQL connection string | **Yes** |
| `JWT_SECRET` | a long random string (see below) | **Yes** |

**Generating a good JWT secret** — run this in your terminal:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Copy the output and paste it as the `JWT_SECRET` value.

3. Click **Save** — App Platform will automatically redeploy.

---

## Part 5 — Update the Frontend

The frontend (`app.js`) needs to:
1. Show a login/register screen if the user is not logged in
2. Send the JWT token with every API request
3. Load pins from the API instead of localStorage

### Strategy for updating `app.js`

At the top of `app.js`, add an auth layer that runs before the main app:

```javascript
// ============================================================
// AUTH LAYER  — add this at the very top of app.js
// ============================================================

const AUTH = {
  token: localStorage.getItem('pin_studio_token'),
  user: JSON.parse(localStorage.getItem('pin_studio_user') || 'null'),

  isLoggedIn() { return !!this.token; },

  async login(email, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    this.token = data.token;
    this.user = data.user;
    localStorage.setItem('pin_studio_token', data.token);
    localStorage.setItem('pin_studio_user', JSON.stringify(data.user));
    return data.user;
  },

  async register(email, username, password) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    this.token = data.token;
    this.user = data.user;
    localStorage.setItem('pin_studio_token', data.token);
    localStorage.setItem('pin_studio_user', JSON.stringify(data.user));
    return data.user;
  },

  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('pin_studio_token');
    localStorage.removeItem('pin_studio_user');
    location.reload();
  },

  // Use this for every authenticated API call
  async apiFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        ...(options.headers || {})
      }
    });
    if (res.status === 401) {
      this.logout();
      return;
    }
    return res;
  }
};

// ============================================================
// REPLACE all localStorage pin reads/writes with API calls:
// ============================================================

// Instead of: const pins = JSON.parse(localStorage.getItem('pinStudio_collection') || '[]')
// Use:
async function loadPins() {
  const res = await AUTH.apiFetch('/api/pins');
  return res.ok ? await res.json() : [];
}

// Instead of: localStorage.setItem('pinStudio_collection', JSON.stringify(pins))
// Use:
async function savePin(pinData) {
  const res = await AUTH.apiFetch('/api/pins', {
    method: 'POST',
    body: JSON.stringify(pinData)
  });
  return res.ok ? await res.json() : null;
}

async function updatePin(id, pinData) {
  const res = await AUTH.apiFetch(`/api/pins/${id}`, {
    method: 'PUT',
    body: JSON.stringify(pinData)
  });
  return res.ok ? await res.json() : null;
}

async function deletePin(id) {
  await AUTH.apiFetch(`/api/pins/${id}`, { method: 'DELETE' });
}
```

### Add login/register UI to `index.html`

Add this modal before your main content. It only shows when the user is not logged in:

```html
<!-- Auth Modal -->
<div id="authModal" class="modal" style="display:none;">
  <div class="modal-content" style="max-width:420px;">
    <div style="text-align:center; margin-bottom:1.5rem;">
      <h2 class="modal-title" id="authTitle">Sign in to Pin Studio</h2>
    </div>

    <div id="loginForm">
      <input type="email" id="authEmail" class="form-input" placeholder="Email address">
      <input type="password" id="authPassword" class="form-input" placeholder="Password" style="margin-top:.75rem;">
      <button class="btn btn-primary" style="width:100%;margin-top:1rem;" onclick="handleLogin()">Sign In</button>
      <p style="text-align:center;margin-top:1rem;font-size:.9rem;">
        No account? <a href="#" onclick="showRegister()">Create one</a>
      </p>
    </div>

    <div id="registerForm" style="display:none;">
      <input type="text" id="authUsername" class="form-input" placeholder="Display name">
      <input type="email" id="authEmailReg" class="form-input" placeholder="Email address" style="margin-top:.75rem;">
      <input type="password" id="authPasswordReg" class="form-input" placeholder="Password (8+ characters)" style="margin-top:.75rem;">
      <button class="btn btn-primary" style="width:100%;margin-top:1rem;" onclick="handleRegister()">Create Account</button>
      <p style="text-align:center;margin-top:1rem;font-size:.9rem;">
        Already have an account? <a href="#" onclick="showLogin()">Sign in</a>
      </p>
    </div>

    <p id="authError" style="color:#e53e3e;text-align:center;display:none;"></p>
  </div>
</div>
```

Add this JS to handle the auth modal flow:

```javascript
function showAuthModal() {
  document.getElementById('authModal').style.display = 'flex';
}

function showLogin() {
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('authTitle').textContent = 'Sign in to Pin Studio';
}

function showRegister() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
  document.getElementById('authTitle').textContent = 'Create your account';
}

async function handleLogin() {
  const email = document.getElementById('authEmail').value;
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';
  try {
    await AUTH.login(email, password);
    document.getElementById('authModal').style.display = 'none';
    initApp();  // load pins and render
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

async function handleRegister() {
  const username = document.getElementById('authUsername').value;
  const email = document.getElementById('authEmailReg').value;
  const password = document.getElementById('authPasswordReg').value;
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';
  try {
    await AUTH.register(email, username, password);
    document.getElementById('authModal').style.display = 'none';
    initApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

// On page load:
if (!AUTH.isLoggedIn()) {
  showAuthModal();
} else {
  initApp();  // your existing app init function
}
```

---

## Part 6 — Migrate existing pins (optional)

If you have pins saved in localStorage that you want to move to your account:

```javascript
// Run this once in the browser console after logging in
async function migrateFromLocalStorage() {
  const old = JSON.parse(localStorage.getItem('pinStudio_collection') || '[]');
  if (!old.length) return console.log('No pins to migrate');

  let count = 0;
  for (const pin of old) {
    await AUTH.apiFetch('/api/pins', {
      method: 'POST',
      body: JSON.stringify({
        name: pin.name,
        category: pin.category,
        description: pin.description || '',
        photo_url: pin.photo || null
      })
    });
    count++;
  }
  console.log(`Migrated ${count} pins. You can now clear localStorage.`);
  localStorage.removeItem('pinStudio_collection');
}

migrateFromLocalStorage();
```

---

## Part 7 — Test locally

To test the full stack locally before deploying:

1. Create a `.env` file in your project root (never commit this):

```
DATABASE_URL=postgresql://doadmin:PASSWORD@HOST:25060/defaultdb?sslmode=require
JWT_SECRET=any-long-random-string-for-local-testing
DO_SPACES_REGION=nyc3
DO_SPACES_BUCKET=pin-studio-images
DO_SPACES_KEY=your-key
DO_SPACES_SECRET=your-secret
PORT=3000
```

2. Install `dotenv`:
```bash
npm install dotenv
```

3. Add to the very top of `server.js`:
```javascript
require('dotenv').config();
```

4. Run:
```bash
node server.js
```

5. Open `http://localhost:3000` — you should see the login screen.

> Add `.env` to your `.gitignore` if it isn't there already.

---

## Security checklist

Before going live with real users, confirm:

- [ ] Passwords are hashed with bcrypt (not stored plain) — handled by the code above
- [ ] `JWT_SECRET` is a long random string set as an encrypted env var
- [ ] `DATABASE_URL` is set as an encrypted env var
- [ ] Database only accepts connections from your App Platform app (Trusted Sources)
- [ ] All pin mutations check `user_id = req.user.userId` — users can only touch their own pins
- [ ] `.env` is in `.gitignore`

---

## Cost summary

| Resource | Cost |
|---|---|
| App Platform (Node.js Basic) | $5/month |
| Managed PostgreSQL (Basic 1 GB) | $15/month |
| Spaces (images) | Free up to 250 GB |
| **Total** | **~$20/month** |

---

## What to build next

Once users and pins are in the database, natural next steps are:

- **Password reset** via email (add SendGrid or Resend for transactional email)
- **Public collection URLs** — `yoursite.com/u/username` — a read-only view of someone's pins
- **Pin import/export** — download your collection as JSON
- **Collections / folders** — group pins within an account
