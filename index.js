const express = require('express');
const axios = require('axios');
const app = express();

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CLIENT_ID = process.env.CLIENT_ID || 'sandbox_stage';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'sandbox_stage';
const BASE_URL = process.env.BASE_URL || 'https://stg-id.uaepass.ae';
const RENDER_URL = process.env.RENDER_URL || 'https://your-app.onrender.com';

// Signing process store — maps state → signer_process_id + signing_url
const signingStore = {};

// ─── ROUTE 1: /sign ─────────────────────────────────────────────────────────
// Called by n8n with the signer_process_id and signing_url as query params
// Redirects the signer to UAE PASS OAuth login
app.get('/sign', (req, res) => {
  const { process_id, signing_url } = req.query;

  if (!process_id || !signing_url) {
    return res.status(400).send('Missing process_id or signing_url');
  }

  // Store the signing_url mapped to process_id so we can retrieve it after OAuth
  signingStore[process_id] = signing_url;

  // Build UAE PASS OAuth authorize URL
  const authUrl = new URL(`${BASE_URL}/idshub/authorize`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('scope', 'urn:uae:digitalid:profile:general');
  authUrl.searchParams.set('redirect_uri', `${RENDER_URL}/callback`);
  authUrl.searchParams.set('state', process_id);
  authUrl.searchParams.set('acr_values', 'urn:safelayer:tws:policies:authentication:level:low');
  authUrl.searchParams.set('ui_locales', 'en');

  res.redirect(authUrl.toString());
});

// ─── ROUTE 2: /callback ──────────────────────────────────────────────────────
// UAE PASS redirects here after user authenticates
// Exchanges code for token, then redirects to signing URL
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }

  const signing_url = signingStore[state];
  if (!signing_url) {
    return res.status(400).send('Unknown signing session. Please request a new signing link.');
  }

  try {
    // Exchange authorization code for access token
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    await axios.post(
      `${BASE_URL}/idshub/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: `${RENDER_URL}/callback`,
        code: code,
      }),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    // Clean up store
    delete signingStore[state];

    // Redirect signer to UAE PASS signing URL
    res.redirect(signing_url);

  } catch (err) {
    console.error('Token exchange error:', err.response?.data || err.message);
    res.status(500).send('Authentication failed. Please contact support.');
  }
});

// ─── ROUTE 3: /logout ────────────────────────────────────────────────────────
// After signing is complete, UAE PASS can redirect here
// We then redirect the user to UAE PASS logout
app.get('/logout', (req, res) => {
  const logoutUrl = `${BASE_URL}/idshub/logout?redirect_uri=${encodeURIComponent(`${RENDER_URL}/done`)}`;
  res.redirect(logoutUrl);
});

// ─── ROUTE 4: /done ──────────────────────────────────────────────────────────
// After logout, UAE PASS redirects here — show confirmation to user
app.get('/done', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Document Signed</title>
      <style>
        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
        .card { background: white; padding: 40px; border-radius: 12px; text-align: center; box-shadow: 0 2px 12px rgba(0,0,0,0.1); max-width: 400px; }
        .check { font-size: 48px; color: #1D9E75; }
        h2 { color: #085041; margin: 16px 0 8px; }
        p { color: #666; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="check">✓</div>
        <h2>Document Signed Successfully</h2>
        <p>You have been logged out of UAE PASS.</p>
        <p>You may now close this window.</p>
      </div>
    </body>
    </html>
  `);
});

// ─── START ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`UAE PASS Auth server running on port ${PORT}`);
});