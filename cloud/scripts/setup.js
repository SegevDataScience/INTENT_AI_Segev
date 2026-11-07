// One-time cloud setup + deploy (needs `npx wrangler login` first):
//   creates the D1 database, applies the schema, sets the secrets, deploys, prints the permanent link.
// Re-running is safe: it reuses the database and the saved admin key.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const CLOUD = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, opts = {}) => execSync(cmd, { cwd: CLOUD, stdio: ['pipe', 'pipe', 'inherit'], encoding: 'utf8', ...opts });
const cfgPath = join(CLOUD, 'wrangler.jsonc');
let cfg = readFileSync(cfgPath, 'utf8');

// 1. D1 database (create once, then remember its id in wrangler.jsonc — the id is not a secret)
if (cfg.includes('00000000-0000-0000-0000-000000000000')) {
  console.log('Creating the D1 database…');
  let id;
  try {
    const out = run('npx wrangler d1 create intent-ai-demo');
    id = /"?database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/.exec(out)?.[1];
  } catch {
    const list = JSON.parse(run('npx wrangler d1 list --json'));
    id = list.find(d => d.name === 'intent-ai-demo')?.uuid;
  }
  if (!id) throw new Error('could not create or find the D1 database');
  cfg = cfg.replace('00000000-0000-0000-0000-000000000000', id);
  writeFileSync(cfgPath, cfg);
  console.log(`  ✓ database ${id}`);
}

// 2. schema (idempotent: CREATE … IF NOT EXISTS)
console.log('Applying the schema…');
run('npx wrangler d1 execute DB --remote --yes --file schema.sql');

// 3. secrets — the admin key stays on this computer (git-ignored) and in Cloudflare only
const tokenFile = join(CLOUD, '.admin-token');
const ADMIN = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : randomBytes(18).toString('base64url');
writeFileSync(tokenFile, ADMIN, { mode: 0o600 });
console.log('Setting secrets…');
run('npx wrangler secret put ADMIN_TOKEN', { input: ADMIN });
if (!existsSync(join(CLOUD, '.ip-secret-set'))) {
  run('npx wrangler secret put IP_SECRET', { input: randomBytes(32).toString('hex') });
  writeFileSync(join(CLOUD, '.ip-secret-set'), 'IP_SECRET was set in Cloudflare (value not stored locally)\n');
}

// 4. build + deploy
console.log('Building and deploying…');
run('node scripts/build-assets.js', { stdio: 'inherit' });
const out = run('npx wrangler deploy');
const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(out)?.[0];
writeFileSync(join(CLOUD, '.cloud-url'), (url || '') + '\n');

console.log('\n════════════════════════════════════════════════════════════');
console.log(`  Permanent visitor link (24/7):  ${url}/`);
console.log(`  Your dashboard (any device):    ${url}/dashboard.html?admin=${encodeURIComponent(ADMIN)}`);
console.log(`  Your share page (QR):           ${url}/share.html?admin=${encodeURIComponent(ADMIN)}`);
console.log('  Keep the admin links private. The admin key is saved in presentation/cloud/.admin-token');
console.log('════════════════════════════════════════════════════════════');
