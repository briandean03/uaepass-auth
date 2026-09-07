const express = require('express');
const axios = require('axios');
const app = express();

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CLIENT_ID = process.env.CLIENT_ID || 'sandbox_stage';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'sandbox_stage';
const BASE_URL = process.env.BASE_URL || 'https://stg-id.uaepass.ae';
const RENDER_URL = process.env.RENDER_URL || 'https://uaepass-auth.onrender.com';

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.static('public'));
app.use(express.json({ limit: '50mb' }));

// ─── SIGNING STORE ────────────────────────────────────────────────────────────
// Keyed by process_id (session_id from n8n)
// Stores: signing_url, pdf_base64, document_name
const signingStore = {};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const uaePassLogo = `<svg width="24" height="24" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="20" fill="white" fill-opacity="0.2"/><path d="M20 8C13.37 8 8 13.37 8 20C8 26.63 13.37 32 20 32C26.63 32 32 26.63 32 20C32 13.37 26.63 8 20 8ZM20 14C21.66 14 23 15.34 23 17C23 18.66 21.66 20 20 20C18.34 20 17 18.66 17 17C17 15.34 18.34 14 20 14ZM20 29.2C17.5 29.2 15.29 27.92 14 25.96C14.03 23.99 18 22.9 20 22.9C21.99 22.9 25.97 23.99 26 25.96C24.71 27.92 22.5 29.2 20 29.2Z" fill="white"/></svg>`;

const pageStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f4f8; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
  .card { background: white; border-radius: 16px; padding: 40px; max-width: 720px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .card-narrow { max-width: 480px; }
  .logo-area { text-align: center; margin-bottom: 28px; }
  .company-name { font-size: 22px; font-weight: 700; color: #1a1a2e; margin-bottom: 4px; }
  .subtitle { font-size: 14px; color: #666; }
  .divider { border: none; border-top: 1px solid #eee; margin: 24px 0; }
  .doc-info { background: #f8fafc; border-radius: 10px; padding: 16px; margin-bottom: 20px; }
  .doc-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .doc-value { font-size: 15px; color: #1a1a2e; font-weight: 600; }
  .pdf-preview { width: 100%; height: 500px; border: 1.5px solid #e5e7eb; border-radius: 10px; margin-bottom: 20px; overflow: hidden; }
  .pdf-preview iframe { width: 100%; height: 100%; border: none; }
  .sign-btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 14px 24px; background: #00B272; border: none; border-radius: 8px; color: white; font-size: 16px; font-weight: 600; cursor: pointer; text-decoration: none; transition: background 0.2s; }
  .sign-btn:hover { background: #009960; }
  .powered { text-align: center; margin-top: 20px; font-size: 12px; color: #aaa; }
  .error-icon { font-size: 48px; text-align: center; margin-bottom: 16px; }
  .error-title { font-size: 18px; font-weight: 700; color: #1a1a2e; text-align: center; margin-bottom: 8px; }
  .error-msg { font-size: 14px; color: #555; text-align: center; line-height: 1.6; }
  .success-icon { font-size: 56px; color: #00B272; text-align: center; margin-bottom: 16px; }
  .success-title { font-size: 20px; font-weight: 700; color: #085041; text-align: center; margin-bottom: 8px; }
  .success-msg { font-size: 14px; color: #555; text-align: center; line-height: 1.6; }
`;

function renderPage(content, narrow = true) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>2p2c Document Signing Portal</title>
  <style>${pageStyles}</style>
</head>
<body>
  <div class="card${narrow ? ' card-narrow' : ''}">
    ${content}
  </div>
</body>
</html>`;
}

// ─── ROUTE 1: /store ─────────────────────────────────────────────────────────
// Called by n8n AFTER create-process succeeds
// Stores signing_url + pdf_base64 + document_name keyed by process_id
app.post('/store', (req, res) => {
  const { process_id, signing_url, pdf_base64, document_name } = req.body;

  if (!process_id || !signing_url) {
    return res.status(400).json({ error: 'Missing process_id or signing_url' });
  }

  signingStore[process_id] = {
    signing_url,
    pdf_base64: pdf_base64 || '',
    document_name: document_name || 'Document'
  };

  console.log(`==> /store: stored process_id=${process_id}`);
  res.json({ success: true, sign_link: `${RENDER_URL}/sign?process_id=${process_id}` });
});

// ─── ROUTE 2: /sign ──────────────────────────────────────────────────────────
// User lands here from email link
// Shows PDF preview + Sign with UAE PASS button
app.get('/sign', (req, res) => {
  const { process_id } = req.query;
  const session = signingStore[process_id];

  if (!process_id || !session) {
    return res.status(400).send(renderPage(`
      <div class="error-icon">⚠️</div>
      <div class="error-title">Invalid signing link</div>
      <p class="error-msg">This signing link is invalid or has expired. Please contact 2p2c to request a new link.</p>
    `));
  }

  const authUrl = new URL(`${BASE_URL}/idshub/authorize`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('scope', 'urn:uae:digitalid:profile:general');
  authUrl.searchParams.set('redirect_uri', `${RENDER_URL}/callback`);
  authUrl.searchParams.set('state', process_id);
  authUrl.searchParams.set('acr_values', 'urn:safelayer:tws:policies:authentication:level:low');
  authUrl.searchParams.set('ui_locales', 'en');

  const pdfSrc = session.pdf_base64
    ? `data:application/pdf;base64,${session.pdf_base64}`
    : '';

  const pdfBlock = pdfSrc
    ? `<div class="pdf-preview"><iframe src="${pdfSrc}"></iframe></div>`
    : `<div class="doc-info"><div class="doc-label">Document</div><div class="doc-value">${session.document_name}</div></div>`;

  res.send(renderPage(`
    <div class="logo-area">
      <div class="company-name">2p2c Project Management Consultants</div>
      <div class="subtitle">Document Signing Portal</div>
    </div>
    <hr class="divider">
    <div class="doc-info">
      <div class="doc-label">Document for Signature</div>
      <div class="doc-value">${session.document_name}</div>
    </div>
    ${pdfBlock}
    <p class="powered" style="margin-bottom:16px;">Please review the document above carefully before signing.</p>
    <a href="${authUrl.toString()}" class="sign-btn">
      ${uaePassLogo}
      Sign with UAE PASS
    </a>
    <p class="powered" style="margin-top:16px;">By clicking above, you will be redirected to UAE PASS to authenticate and sign.</p>
  `, false));
});

// ─── ROUTE 3: /callback ──────────────────────────────────────────────────────
// UAE PASS redirects here after authentication
// Exchanges code for token, then redirects to stored signing_url
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.send(renderPage(`
      <div class="error-icon">✕</div>
      <div class="error-title">Login Cancelled</div>
      <p class="error-msg">User cancelled the login.</p>
      <hr class="divider">
      <p class="error-msg" style="font-size:12px;">You may close this window or contact 2p2c to restart the process.</p>
    `));
  }

  if (!code || !state) {
    return res.send(renderPage(`
      <div class="error-icon">⚠️</div>
      <div class="error-title">Something went wrong</div>
      <p class="error-msg">Something went wrong during the login, please try again later!</p>
    `));
  }

  const session = signingStore[state];
  if (!session) {
    return res.send(renderPage(`
      <div class="error-icon">⚠️</div>
      <div class="error-title">Session expired</div>
      <p class="error-msg">This signing session has expired. Please request a new signing link.</p>
    `));
  }

  try {
    // Exchange code for token (to confirm identity — token not used further here)
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

    // Redirect to the UAE PASS signing URL stored during /store
    const signingUrl = session.signing_url;
    res.redirect(signingUrl);

  } catch (err) {
    console.error('Callback error:', err.response?.data || err.message);
    res.send(renderPage(`
      <div class="error-icon">⚠️</div>
      <div class="error-title">Something went wrong</div>
      <p class="error-msg">Something went wrong during the login, please try again later!</p>
    `));
  }
});

// ─── ROUTE 4: /logout ────────────────────────────────────────────────────────
// UAE PASS redirects here after signing (via finish_callback_url)
app.get('/logout', (req, res) => {
  const resume = decodeURIComponent(req.query.resume || '');
  const status = req.query.status;

  console.log('==> /logout called, status:', status);

  if (status !== 'finished') {
    return res.send(renderPage(`
      <div class="error-icon">✕</div>
      <div class="error-title">Signing Cancelled</div>
      <p class="error-msg">User cancelled the signing process.</p>
      <hr class="divider">
      <p class="error-msg" style="font-size:12px;">You may close this window or contact 2p2c to restart the process.</p>
    `));
  }

  const doneUrl = `${RENDER_URL}/done?resume=${encodeURIComponent(resume)}`;
  const logoutUrl = `${BASE_URL}/idshub/logout?redirect_uri=${encodeURIComponent(doneUrl)}`;
  res.redirect(logoutUrl);
});

// ─── ROUTE 5: /done ──────────────────────────────────────────────────────────
// Final page after logout — resumes n8n workflow to download signed PDF
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
    <p class="success-msg">Your document has been signed and saved.<br>You may now close this window.</p>
  `));
});

// ─── START ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`UAE PASS Auth server running on port ${PORT}`);
});