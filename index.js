const express = require('express');
const axios = require('axios');
const app = express();

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CLIENT_ID = process.env.CLIENT_ID || 'sandbox_stage';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'sandbox_stage';
const BASE_URL = process.env.BASE_URL || 'https://stg-id.uaepass.ae';
const RENDER_URL = process.env.RENDER_URL || 'https://uaepass-auth.onrender.com';

// Signing process store
const signingStore = {};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const uaePassLogo = `<svg width="24" height="24" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="20" fill="white" fill-opacity="0.2"/><path d="M20 8C13.37 8 8 13.37 8 20C8 26.63 13.37 32 20 32C26.63 32 32 26.63 32 20C32 13.37 26.63 8 20 8ZM20 14C21.66 14 23 15.34 23 17C23 18.66 21.66 20 20 20C18.34 20 17 18.66 17 17C17 15.34 18.34 14 20 14ZM20 29.2C17.5 29.2 15.29 27.92 14 25.96C14.03 23.99 18 22.9 20 22.9C21.99 22.9 25.97 23.99 26 25.96C24.71 27.92 22.5 29.2 20 29.2Z" fill="white"/></svg>`;

const pageStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f4f8; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
  .card { background: white; border-radius: 16px; padding: 40px; max-width: 480px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .logo-area { text-align: center; margin-bottom: 28px; }
  .company-name { font-size: 22px; font-weight: 700; color: #1a1a2e; margin-bottom: 4px; }
  .subtitle { font-size: 14px; color: #666; }
  .divider { border: none; border-top: 1px solid #eee; margin: 24px 0; }
  .doc-info { background: #f8fafc; border-radius: 10px; padding: 16px; margin-bottom: 24px; }
  .doc-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .doc-value { font-size: 15px; color: #1a1a2e; font-weight: 600; }
  .sign-btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 14px 24px; background: #00B272; border: none; border-radius: 8px; color: white; font-size: 16px; font-weight: 600; cursor: pointer; text-decoration: none; transition: background 0.2s; }
  .sign-btn:hover { background: #009960; }
  .powered { text-align: center; margin-top: 20px; font-size: 12px; color: #aaa; }
  .powered span { color: #00B272; font-weight: 600; }
  .error-icon { font-size: 48px; text-align: center; margin-bottom: 16px; }
  .error-title { font-size: 18px; font-weight: 700; color: #1a1a2e; text-align: center; margin-bottom: 8px; }
  .error-msg { font-size: 14px; color: #555; text-align: center; line-height: 1.6; }
  .success-icon { font-size: 56px; color: #00B272; text-align: center; margin-bottom: 16px; }
  .success-title { font-size: 20px; font-weight: 700; color: #085041; text-align: center; margin-bottom: 8px; }
  .success-msg { font-size: 14px; color: #555; text-align: center; line-height: 1.6; }
`;

function renderPage(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>2p2c Document Signing Portal</title>
  <style>${pageStyles}</style>
</head>
<body>
  <div class="card">
    ${content}
    <p class="powered">Powered by <span>UAE PASS</span></p>
  </div>
</body>
</html>`;
}

// ─── ROUTE 1: /sign ─────────────────────────────────────────────────────────
app.get('/sign', (req, res) => {
  const { process_id, signing_url } = req.query;

  if (!process_id || !signing_url) {
    return res.status(400).send(renderPage(`
      <div class="error-icon">⚠️</div>
      <div class="error-title">Invalid signing link</div>
      <p class="error-msg">This signing link is invalid or has expired. Please contact 2p2c Project Management Consultants.</p>
    `));
  }

  signingStore[process_id] = decodeURIComponent(signing_url);

  const authUrl = new URL(`${BASE_URL}/idshub/authorize`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('scope', 'urn:uae:digitalid:profile:general');
  authUrl.searchParams.set('redirect_uri', `${RENDER_URL}/callback`);
  authUrl.searchParams.set('state', process_id);
  authUrl.searchParams.set('acr_values', 'urn:safelayer:tws:policies:authentication:level:low');
  authUrl.searchParams.set('ui_locales', 'en');

  res.send(renderPage(`
    <div class="logo-area">
      <div class="company-name">2p2c PMC</div>
      <div class="subtitle">Document Signing Portal</div>
    </div>
    <hr class="divider">
    <div class="doc-info">
      <div class="doc-label">Document ready for signature</div>
      <div class="doc-value">Please review and sign using your UAE PASS digital identity</div>
    </div>
    <a href="${authUrl.toString()}" class="sign-btn">
      ${uaePassLogo}
      Sign with UAE PASS
    </a>
  `));
});

// ─── ROUTE 2: /callback ──────────────────────────────────────────────────────
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.send(renderPage(`
      <div class="error-icon">✕</div>
      <div class="error-title">Login cancelled</div>
      <p class="error-msg">User cancelled the login.</p>
    `));
  }

  if (!code || !state) {
    return res.send(renderPage(`
      <div class="error-icon">⚠️</div>
      <div class="error-title">Something went wrong</div>
      <p class="error-msg">Something went wrong during the login, please try again later!</p>
    `));
  }

  const signing_url = signingStore[state];
  if (!signing_url) {
    return res.send(renderPage(`
      <div class="error-icon">⚠️</div>
      <div class="error-title">Session expired</div>
      <p class="error-msg">This signing session has expired. Please request a new signing link from 2p2c Project Management Consultants.</p>
    `));
  }

  try {
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

    delete signingStore[state];
    res.redirect(signing_url);

  } catch (err) {
    console.error('Token exchange error:', err.response?.data || err.message);
    res.send(renderPage(`
      <div class="error-icon">⚠️</div>
      <div class="error-title">Something went wrong</div>
      <p class="error-msg">Something went wrong during the login, please try again later!</p>
    `));
  }
});

// ─── ROUTE 3: /logout ────────────────────────────────────────────────────────
app.get('/logout', (req, res) => {
  const resume = decodeURIComponent(req.query.resume || '');
  const status = req.query.status;

  console.log('==> /logout called, status:', status);
  console.log('==> resume URL:', resume);

  if (status !== 'finished') {
    return res.send(renderPage(`
      <div class="error-icon">✕</div>
      <div class="error-title">Signing cancelled</div>
      <p class="error-msg">User cancelled the signing process.</p>
    `));
  }

  const doneUrl = `${RENDER_URL}/done?resume=${encodeURIComponent(resume)}`;
  const logoutUrl = `${BASE_URL}/idshub/logout?redirect_uri=${encodeURIComponent(doneUrl)}`;
  res.redirect(logoutUrl);
});

// ─── ROUTE 4: /done ──────────────────────────────────────────────────────────
app.get('/done', async (req, res) => {
  const resume = req.query.resume;

  console.log('==> /done called, resume URL:', resume);

  if (resume) {
    try {
      const response = await axios.get(decodeURIComponent(resume));
      console.log('==> n8n resume response:', response.status);
    } catch (err) {
      console.error('==> n8n resume error:', err.message);
    }
  }

  res.send(renderPage(`
    <div class="success-icon">✓</div>
    <div class="success-title">Document Signed Successfully</div>
    <p class="success-msg">You have been logged out of UAE PASS.<br>You may now close this window.</p>
  `));
});

// ─── START ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`UAE PASS Auth server running on port ${PORT}`);
});