import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './src/db.js';
import { loadSites, seed } from './src/seed.js';
import { createApp } from './src/app.js';
import { purgeExpired } from './src/retention.js';
import { DEFAULT_RETENTION_DAYS } from './src/consent.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const db = openDb(join(root, 'data', 'test.db'));
seed(db, loadSites(join(root, 'sites.json')));

const audioDir = join(root, 'data', 'audio');
const retentionDays = Number(process.env.RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
// Secret key for the one-way IP hash. Kept beside the DB (git-ignored) so hashes stay stable across restarts.
const secretFile = join(root, 'data', '.ip-hash-secret');
const ipHashSecret = process.env.IP_HASH_SECRET ||
  (existsSync(secretFile) ? readFileSync(secretFile, 'utf8').trim()
    : (() => { const k = randomBytes(32).toString('hex'); writeFileSync(secretFile, k, { mode: 0o600 }); return k; })());
const app = createApp({ db, audioDir, publicDir: join(root, 'public'), retentionDays, ipHashSecret });

// Retention: purge expired feedback + recordings now and every 24h.
const purge = () => {
  const { deleted } = purgeExpired(db, { audioDir, days: retentionDays });
  if (deleted) console.log(`Retention: deleted ${deleted} feedback item(s) older than ${retentionDays} days`);
};
purge();
setInterval(purge, 24 * 60 * 60 * 1000).unref();
const port = Number(process.env.PORT) || 4000;
// Bind to loopback only: the read endpoints and audio files are unauthenticated (local demo),
// so they must never be reachable from the LAN.
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => {
  console.log(`Intent AI simulation → http://localhost:${port}`);
  console.log(`Dashboard          → http://localhost:${port}/dashboard.html`);
  console.log(`TEST DB            → ${join(root, 'data', 'test.db')}  (retention: ${retentionDays} days)`);
});
