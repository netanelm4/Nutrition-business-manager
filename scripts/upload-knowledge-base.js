/**
 * Upload the dietitian knowledge base to a running server (e.g. production).
 *
 *   KB_USER="<name>" KB_PASSWORD="<password>" \
 *     node scripts/upload-knowledge-base.js https://<your-app>.up.railway.app [data/dietitian-knowledge-base.json]
 *
 * The server sanitizes it again (no weekly free meal) and stores it in the
 * knowledge_base table. Re-run after rebuilding the file to replace it.
 */

const fs = require('fs');
const path = require('path');

async function main() {
  const base = (process.argv[2] || '').replace(/\/+$/, '');
  const file = process.argv[3] || path.join(__dirname, '..', 'data', 'dietitian-knowledge-base.json');
  const { KB_USER, KB_PASSWORD } = process.env;
  if (!base || !KB_USER || !KB_PASSWORD) {
    console.error('Usage: KB_USER=... KB_PASSWORD=... node scripts/upload-knowledge-base.js <server URL> [file]');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}\nBuild it first: node scripts/build-knowledge-base.js "<pdf folder>"`);
    process.exit(1);
  }

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: KB_USER, password: KB_PASSWORD }),
  }).then((r) => r.json());
  if (!login.success) { console.error('Login failed:', login.error); process.exit(1); }

  const res = await fetch(`${base}/api/knowledge-base`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.data.token}` },
    body: fs.readFileSync(file, 'utf8'),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) { console.error(`Upload failed (HTTP ${res.status}):`, json.error); process.exit(1); }
  console.log('Knowledge base uploaded:', JSON.stringify(json.data, null, 2));

  await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${login.data.token}` } }).catch(() => {});
}

main().catch((err) => { console.error(err); process.exit(1); });
