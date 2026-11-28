// ─── Public landing domain isolation ─────────────────────────────────────────
// When LANDING_DOMAIN is set (e.g. "example.co.il"), requests for that domain or
// its www. variant see ONLY the public site:
//   GET  /                         → landing/index.html (clean root URL, no redirect)
//   GET  /accessibility|privacy|terms[/]  and every other file under landing/
//   GET  /landing/*                → the same files under their /landing/ path
//   GET  /w/:token, /food/:token   → the client app shell (public weigh-in / food bank)
//        + the client bundle files those pages need (/assets/*, favicon, manifest)
//   POST /api/leads/public (+ alias /api/public/leads) and /api/public/*
// Everything else (CRM UI routes, /api/auth, every other /api/*) → 404.
// The Railway domain (or any other host) is untouched: the full CRM keeps working.
//
// Host detection deliberately does NOT use req.hostname: with "trust proxy" Express
// takes the first X-Forwarded-Host value, which a visitor can spoof. A request is
// treated as public if the Host header OR any X-Forwarded-Host entry is the landing
// domain, so spoofing can only ever make a request more restricted, never less.

const fs = require('fs');
const path = require('path');
const express = require('express');

const CLIENT_APP_ROUTE = /^\/(w|food)\/[^/]+\/?$/;
const CLIENT_ROOT_FILES = new Set(['/favicon.svg', '/manifest.json', '/icons.svg', '/logo-color.png']);
const PUBLIC_API_EXACT = new Set(['/api/leads/public', '/api/public/leads']);
const PUBLIC_API_PREFIX = '/api/public/';

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

function hostOnly(value) {
  return String(value || '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

function isPublicApi(p) {
  return PUBLIC_API_EXACT.has(p) || p.startsWith(PUBLIC_API_PREFIX);
}

const NOT_FOUND_HTML = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>העמוד לא נמצא</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fcf4f9;color:#1b1d2a;font:400 18px/1.6 Heebo,Arial,sans-serif;text-align:center">
<main><h1 style="margin:0 0 8px;font-size:40px">העמוד לא נמצא</h1>
<p style="margin:0 0 20px">הכתובת שחיפשתם לא קיימת.</p>
<a href="/" style="color:#2c5295;font-weight:700">לדף הבית</a></main></body></html>`;

function notFound(req, res) {
  if (req.path === '/api' || req.path.startsWith('/api/')) return res.status(404).json({ success: false, error: 'Not found' });
  return res.status(404).type('html').send(NOT_FOUND_HTML);
}

function createLandingDomainGuard({ domain, landingDir, clientDist }) {
  const bare = normalizeDomain(domain);
  if (!bare) return function landingDomainOff(req, res, next) { next(); };

  const publicHosts = new Set([bare, `www.${bare}`]);
  const landingStatic = express.static(landingDir, { index: 'index.html', dotfiles: 'ignore' });
  const clientStatic = express.static(clientDist, { index: false, dotfiles: 'ignore' });
  const clientIndex = path.join(clientDist, 'index.html');

  function isPublicHost(req) {
    if (publicHosts.has(hostOnly(req.headers.host))) return true;
    const fwd = req.headers['x-forwarded-host'];
    if (!fwd) return false;
    return String(fwd).split(',').some((h) => publicHosts.has(hostOnly(h)));
  }

  function guard(req, res, next) {
    if (!isPublicHost(req)) return next();
    const p = req.path;

    // Public API endpoints continue to the regular routers; everything else under /api is hidden.
    if (p === '/api' || p.startsWith('/api/')) return isPublicApi(p) ? next() : notFound(req, res);

    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(req, res);

    // Client weigh-in / food-bank pages (token links sent to clients).
    if (CLIENT_APP_ROUTE.test(p)) {
      res.setHeader('X-Robots-Tag', 'noindex'); // personal token links never belong in search results
      return fs.existsSync(clientIndex) ? res.sendFile(clientIndex) : notFound(req, res);
    }

    // /landing/* keeps working (old links); served here so misses 404 instead of hitting the CRM fallback.
    if (p === '/landing') {
      const qs = req.url.indexOf('?') === -1 ? '' : req.url.slice(req.url.indexOf('?'));
      return res.redirect(301, '/landing/' + qs);
    }
    if (p.startsWith('/landing/')) {
      const originalUrl = req.url;
      req.url = req.url.slice('/landing'.length);
      return landingStatic(req, res, () => { req.url = originalUrl; notFound(req, res); });
    }

    // Root + legal pages + landing assets, then the client bundle files the token pages load.
    return landingStatic(req, res, () => {
      if (p.startsWith('/assets/') || CLIENT_ROOT_FILES.has(p)) return clientStatic(req, res, () => notFound(req, res));
      return notFound(req, res);
    });
  }

  guard.publicHosts = publicHosts;
  return guard;
}

module.exports = { createLandingDomainGuard, normalizeDomain };
