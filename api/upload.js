// api/upload.js
// Vercel Serverless Function — receives a raw image file from the browser
// and stores it in Vercel Blob, returning the public URL.
//
// Environment variable required (set automatically by Vercel when you
// link a Blob store to the project):
//   BLOB_READ_WRITE_TOKEN

const { put } = require('@vercel/blob');

// Disable Vercel's default body parser so we can stream the raw file body
// straight into Vercel Blob without buffering the entire upload in memory.
module.exports.config = { api: { bodyParser: false } };

module.exports = async function handler(req, res) {
  // CORS headers — allows the browser to call this endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Filename comes in via query string (?filename=my-photo.jpg)
  const filename = req.query.filename
    ? decodeURIComponent(req.query.filename)
    : `pin-${Date.now()}.jpg`;

  try {
    // Stream the request body directly into Vercel Blob
    const blob = await put(`pins/${filename}`, req, {
      access: 'public',
    });

    return res.status(200).json({ url: blob.url });
  } catch (err) {
    console.error('[upload] Blob error:', err.message);
    return res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
};
