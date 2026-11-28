/**
 * Route test — public landing domain isolation (LANDING_DOMAIN).
 *
 * Boots the real Express app (server.js) in-process against a throwaway SQLite DB
 * and sends requests with explicit Host headers:
 *   - the public landing domain (bare + www.) must serve the landing page at "/",
 *     the legal pages, client token pages and public endpoints, and 404 the CRM;
 *   - the private Railway domain must keep serving the full CRM.
 *
 * Requires a built client (client/dist) because the CRM shell and the token pages
 * are served from it:  npm run build   (or: cd client && npm run build)
 * Run:                 npm run test:landing-domain
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const LANDING = 'example-clinic.co.il';
const CRM_HOST = 'web-production-790f4.up.railway.app';
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

// ── Environment must be set before server.js (and database/db.js) are required ──
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-domain-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'production';
process.env.LANDING_DOMAIN = `https://www.${LANDING.toUpperCase()}/`; // normalisation is part of the test

let passed = 0;
let failed = 0;
function assert(label, condition, detail = '') {
  if (condition) { console.log(`  ✅  PASS  ${label}`); passed++; }
  else { console.error(`  ❌  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

function request(port, method, urlPath, host, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: urlPath,
      headers: {
        Host: host,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const title = (text) => (text.match(/<title>([^<]*)/) || [])[1] || '';
const isCrmShell = (r) => r.status === 200 && /<div id="root">/.test(r.text);
const isGuard404 = (r) => r.status === 404 && (/העמוד לא נמצא/.test(r.text) || /"error":"Not found"/.test(r.text));

async function run() {
  console.log('\n══════════════════════════════════════════');
  console.log('  Landing domain isolation — route test');
  console.log('══════════════════════════════════════════\n');

  if (!fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
    console.error('client/dist is missing. Build the client first: npm run build');
    process.exit(1);
  }

  const { normalizeDomain } = require('../middleware/landing-domain');
  console.log('normalizeDomain');
  assert('strips protocol, www., case, path and port', normalizeDomain('HTTPS://www.Example.co.il:443/x') === 'example.co.il');
  assert('empty value disables the guard', normalizeDomain('') === '' && normalizeDomain(undefined) === '');

  const app = require('../server');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const get = (p, host, opts) => request(port, 'GET', p, host, opts);
  const post = (p, host, body, opts = {}) => request(port, 'POST', p, host, { ...opts, body });

  try {
    for (const host of [LANDING, `www.${LANDING}`]) {
      console.log(`\nPublic domain: ${host}`);

      const root = await get('/', host);
      assert('GET / serves the landing page directly (200, no redirect)', root.status === 200 && title(root.text).startsWith('נתא | קליניקת תזונה'), `${root.status} "${title(root.text)}"`);
      assert('GET / is not the CRM shell', !/<div id="root">/.test(root.text));

      for (const [slug, heading] of [['accessibility', 'הצהרת נגישות'], ['privacy', 'מדיניות פרטיות'], ['terms', 'תנאי שימוש']]) {
        const bare = await get(`/${slug}`, host);
        assert(`GET /${slug} redirects to /${slug}/`, bare.status === 301 && bare.headers.location === `/${slug}/`, `${bare.status} ${bare.headers.location || ''}`);
        const page = await get(`/${slug}/`, host);
        assert(`GET /${slug}/ serves the page`, page.status === 200 && title(page.text).startsWith(heading), `${page.status} "${title(page.text)}"`);
      }

      const lp = await get('/landing/', host);
      assert('GET /landing/ still serves the landing page', lp.status === 200 && title(lp.text).startsWith('נתא | קליניקת תזונה'));
      const lpNoSlash = await get('/landing', host);
      assert('GET /landing redirects to /landing/', lpNoSlash.status === 301 && lpNoSlash.headers.location === '/landing/');
      const lpPrivacy = await get('/landing/privacy/', host);
      assert('GET /landing/privacy/ serves the privacy page', lpPrivacy.status === 200 && title(lpPrivacy.text).startsWith('מדיניות פרטיות'));
      assert('GET /landing/missing.png is 404 (no CRM fallback)', isGuard404(await get('/landing/missing.png', host)));

      const idx = await get('/index.html', host);
      assert('GET /index.html is the landing page, never the CRM shell', idx.status === 200 && title(idx.text).startsWith('נתא | קליניקת תזונה') && !/<div id="root">/.test(idx.text));
      const photo = await get('/assets/netanel-cutout.png', host);
      assert('landing assets resolve from the root (/assets/netanel-cutout.png)', photo.status === 200 && /image\/png/.test(photo.headers['content-type'] || ''));
      const a11y = await get('/a11y.js', host);
      assert('landing scripts resolve from the root (/a11y.js)', a11y.status === 200 && /javascript/.test(a11y.headers['content-type'] || ''));

      for (const p of ['/w/abc123', '/food/abc123']) {
        const r = await get(p, host);
        assert(`GET ${p} serves the client token page`, isCrmShell(r), `${r.status}`);
        assert(`GET ${p} is marked noindex`, r.headers['x-robots-tag'] === 'noindex');
      }
      const bundle = (fs.readFileSync(path.join(CLIENT_DIST, 'index.html'), 'utf8').match(/src="(\/assets\/[^"]+\.js)"/) || [])[1];
      if (bundle) {
        const b = await get(bundle, host);
        assert('client bundle used by the token pages loads', b.status === 200 && /javascript/.test(b.headers['content-type'] || ''), `${bundle} → ${b.status}`);
      }

      for (const p of ['/login', '/dashboard', '/clients', '/clients/5', '/leads', '/leads/3', '/templates', '/protocols',
        '/meetings', '/food-bank', '/statistics', '/settings', '/w', '/food', '/w/abc/extra', '/favicon.ico']) {
        const r = await get(p, host);
        assert(`CRM route GET ${p} → 404`, isGuard404(r), `${r.status}`);
      }

      for (const [method, p] of [['GET', '/api/health'], ['POST', '/api/auth/login'], ['GET', '/api/clients'], ['GET', '/api/leads'],
        ['GET', '/api/dashboard'], ['GET', '/api/stream'], ['GET', '/api/google/auth-url'], ['GET', '/api/google/callback'],
        ['POST', '/api/integrations/whatsapp/webhook'], ['GET', '/api/settings'], ['GET', '/api']]) {
        const r = await request(port, method, p, host, method === 'POST' ? { body: {} } : {});
        assert(`API ${method} ${p} → 404`, r.status === 404 && /"error":"Not found"/.test(r.text), `${r.status} ${r.text.slice(0, 80)}`);
      }

      assert('POST / → 404', isGuard404(await post('/', host, {})));

      const lead = await post('/api/leads/public', host, { full_name: 'x', phone: '1' });
      assert('POST /api/leads/public reaches the lead route (validation 400, nothing saved)', lead.status === 400 && /שם מלא/.test(lead.text), `${lead.status} ${lead.text.slice(0, 80)}`);
      const alias = await post('/api/public/leads', host, { full_name: 'x', phone: '1' });
      assert('POST /api/public/leads alias reaches the lead route', alias.status === 400 && /שם מלא/.test(alias.text));
      const recipes = await get('/api/public/recipes', host);
      assert('GET /api/public/recipes reaches the public router', recipes.status !== 404 || !/"error":"Not found"/.test(recipes.text), `${recipes.status}`);
    }

    console.log('\nPublic domain variants and spoofing');
    assert('Host with a port is still the public domain', isGuard404(await get('/login', `${LANDING}:443`)));
    assert('Upper-case Host is still the public domain', isGuard404(await get('/login', LANDING.toUpperCase())));
    assert('Public Host + spoofed X-Forwarded-Host of the CRM stays isolated',
      isGuard404(await get('/login', LANDING, { headers: { 'X-Forwarded-Host': CRM_HOST } })));
    assert('CRM Host + X-Forwarded-Host of the public domain is isolated (never less restricted)',
      isGuard404(await get('/login', CRM_HOST, { headers: { 'X-Forwarded-Host': `${CRM_HOST}, ${LANDING}` } })));
    assert('A look-alike host is NOT treated as the public domain', isCrmShell(await get('/login', `evil-${LANDING}`)));

    console.log(`\nPrivate CRM domain: ${CRM_HOST}`);
    for (const p of ['/', '/login', '/dashboard', '/clients/5', '/leads']) {
      const r = await get(p, CRM_HOST);
      assert(`GET ${p} serves the CRM`, isCrmShell(r), `${r.status}`);
    }
    const health = await get('/api/health', CRM_HOST);
    assert('GET /api/health → 200', health.status === 200);
    const clients = await get('/api/clients', CRM_HOST);
    assert('GET /api/clients is protected by auth (401), not hidden', clients.status === 401, `${clients.status}`);
    const login = await post('/api/auth/login', CRM_HOST, {});
    assert('POST /api/auth/login exists (not 404)', login.status !== 404, `${login.status}`);
    const crmLanding = await get('/landing/', CRM_HOST);
    assert('GET /landing/ still serves the landing page', crmLanding.status === 200 && title(crmLanding.text).startsWith('נתא | קליניקת תזונה'));
    const crmWeigh = await get('/w/abc123', CRM_HOST);
    assert('GET /w/:token works on the CRM domain too', isCrmShell(crmWeigh));
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

run().catch((err) => { console.error(err); process.exit(1); });
