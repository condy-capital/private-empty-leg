// Private Empty Leg - gated preview. Real server-side gate: PBKDF2(150k, random salt),
// timing-safe compare, 5-attempt/60s lockout, one-time setup key, HMAC session cookie.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SUPA_URL = process.env.SUPA_URL;
const SERVICE = process.env.SUPA_SERVICE_KEY;
const SETUP_KEY = process.env.GATE_SETUP_KEY || '';
const pbkdf2 = (pw, saltHex) => crypto.pbkdf2Sync(pw, Buffer.from(saltHex, 'hex'), 150000, 32, 'sha256').toString('hex');
const hmac = (s, m) => crypto.createHmac('sha256', s).update(m).digest('hex');
const ctEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
async function readConfig() {
  const r = await fetch(`${SUPA_URL}/storage/v1/object/authenticated/site/gate-config.json`, { headers: { Authorization: `Bearer ${SERVICE}` } });
  return r.ok ? r.json() : null;
}
async function writeConfig(cfg) {
  await fetch(`${SUPA_URL}/storage/v1/object/site/gate-config.json`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', 'x-upsert': 'true' },
    body: JSON.stringify(cfg),
  });
}
const page = (err, setup) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private Empty Leg</title><style>
body{margin:0;background:#F8F8F5;color:#151515;font-family:-apple-system,'SF Pro Text','Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{background:#fff;border:1px solid #e4e2da;border-radius:14px;padding:36px;max-width:360px;width:90%}
.brand{font-weight:800;letter-spacing:.08em;font-size:14px}.brand span{color:#DC632C}
h1{font-size:20px;margin:18px 0 6px}p{color:#55554f;font-size:13px;margin:0 0 16px}
input{width:100%;padding:12px;border:1px solid #e4e2da;border-radius:8px;font-size:15px;box-sizing:border-box;margin-top:8px}
button{width:100%;margin-top:12px;padding:12px;background:#DC632C;color:#fff;border:0;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
.err{color:#b3261e;font-size:13px;margin-top:10px}
</style></head><body><div class="box"><div class="brand">PRIVATE <span>EMPTY LEG</span></div>
<h1>Preview access</h1><p>${setup ? 'Set the preview password.' : 'Enter the preview password to continue.'}</p>
<form method="POST">${setup ? `<input type="hidden" name="setup" value="${setup}" />` : ''}<input type="password" name="pw" autocomplete="current-password" autofocus required /><button type="submit">Continue</button></form>
${err ? `<div class="err">${err}</div>` : ''}</div></body></html>`;
const send = (res, html) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.end(html); };
const cookieHdr = (t) => `pel_gate=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
module.exports = async (req, res) => {
  try {
    const cfg = await readConfig();
    const url = new URL(req.url, 'https://gate');
    if (req.method === 'POST') {
      const body = await new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
      const p = new URLSearchParams(body);
      const pw = p.get('pw') || ''; const setup = p.get('setup') || '';
      if (!pw) return send(res, page('Password required.', ''));
      if (!cfg) {
        if (!SETUP_KEY || !ctEq(hmac(SETUP_KEY, 'setup'), hmac(setup, 'setup'))) return send(res, page('Setup not authorized.', ''));
        const salt = crypto.randomBytes(16).toString('hex');
        const secret = crypto.randomBytes(32).toString('hex');
        await writeConfig({ salt, hash: pbkdf2(pw, salt), secret, failures: 0, locked_until: 0 });
        res.setHeader('Set-Cookie', cookieHdr(hmac(secret, 'ok'))); res.statusCode = 303; res.setHeader('Location', '/'); return res.end();
      }
      if (cfg.locked_until && Date.now() < cfg.locked_until) return send(res, page('Too many attempts. Try again shortly.', ''));
      if (ctEq(pbkdf2(pw, cfg.salt), cfg.hash)) {
        await writeConfig({ ...cfg, failures: 0, locked_until: 0 });
        res.setHeader('Set-Cookie', cookieHdr(hmac(cfg.secret, 'ok'))); res.statusCode = 303; res.setHeader('Location', '/'); return res.end();
      }
      const failures = (cfg.failures || 0) + 1;
      await writeConfig({ ...cfg, failures, locked_until: failures >= 5 ? Date.now() + 60000 : 0 });
      return send(res, page('Incorrect password.', ''));
    }
    if (!cfg) {
      const st = url.searchParams.get('setup') || '';
      const ok = SETUP_KEY && st && ctEq(hmac(SETUP_KEY, 'setup'), hmac(st, 'setup'));
      return send(res, page('', ok ? st : ''));
    }
    const cv = (req.headers.cookie || '').match(/pel_gate=([0-9a-f]+)/)?.[1] || '';
    if (cv && ctEq(cv, hmac(cfg.secret, 'ok'))) {
      const html = require('./bundledata');
      return send(res, html);
    }
    return send(res, page('', ''));
  } catch (e) {
    res.statusCode = 500; res.end('Gate error');
  }
};
