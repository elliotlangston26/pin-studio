'use strict';

require('dotenv').config();

const express      = require('express');
const path         = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Pool }     = require('pg');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const nodemailer   = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Database ──────────────────────────────────────────────────────────────────

const db = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Email (optional — only active when EMAIL_USER + EMAIL_PASS are set) ───────

const mailer = (process.env.EMAIL_USER && process.env.EMAIL_PASS)
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    })
  : null;

function notifySignup(name, email) {
  if (!mailer) return;
  mailer.sendMail({
    from:    process.env.EMAIL_USER,
    to:      'elliotlangston21@gmail.com',
    subject: 'New Pin Studio sign-up',
    text:    `New user signed up:\n\nName:  ${name}\nEmail: ${email}\nDate:  ${new Date().toUTCString()}`,
  }).catch(err => console.error('[email]', err.message));
}

// ── Spaces client (DigitalOcean Spaces is S3-compatible) ──────────────────────

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
// Any route that calls requireAuth returns 401 if the token is missing or invalid.

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
    notifySignup(rows[0].name, rows[0].email);
    res.status(201).json({ token, user: rows[0] });
  } catch (err) {
    if (err.code === '23505')
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
