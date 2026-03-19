// server.js
// Express server for DigitalOcean App Platform deployment.
//
// What it does:
//   - Serves index.html, styles.css, app.js as a static site
//   - Exposes POST /api/upload — receives a raw image from the browser,
//     stores it in a DigitalOcean Space, and returns the public URL
//
// Required environment variables (set in DO App Platform dashboard):
//   DO_SPACES_REGION   e.g. nyc3
//   DO_SPACES_BUCKET   e.g. pin-studio-images
//   DO_SPACES_KEY      Spaces access key ID
//   DO_SPACES_SECRET   Spaces secret access key

'use strict';

const express = require('express');
const path    = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Spaces client (DigitalOcean Spaces is S3-compatible) ──────────────────

const spacesClient = new S3Client({
  endpoint:    `https://${process.env.DO_SPACES_REGION}.digitaloceanspaces.com`,
  region:       process.env.DO_SPACES_REGION || 'nyc3',
  credentials: {
    accessKeyId:     process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
  },
});

// ── Static files ──────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname)));

// ── Upload endpoint ───────────────────────────────────────────────────────
// The frontend (app.js) sends the image as a raw POST body with
// ?filename=original-name.jpg in the query string.
// express.raw() buffers it so we can pass it straight to S3.

app.post(
  '/api/upload',
  express.raw({ type: 'image/*', limit: '5mb' }),
  async (req, res) => {
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'No image received' });
    }

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

      return res.status(200).json({ url });
    } catch (err) {
      console.error('[upload] Spaces error:', err.message);
      return res.status(500).json({ error: 'Upload failed. Please try again.' });
    }
  }
);

// ── Start ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Pin Studio running at http://localhost:${PORT}`);
});
