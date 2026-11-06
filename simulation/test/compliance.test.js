// Compliance requirements from compliance/02_ACTION_ITEMS_CHECKLIST.md, applied to the simulation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import * as store from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { purgeExpired } from '../src/retention.js';

const KEY = 'k_shu';
const OTHER_KEY = 'k_other';
const CONSENT = { version: CONSENT_VERSION, given: true };
const AUDIO = Buffer.from('audio').toString('base64');
let server, base, audioDir, tmp, db;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sim-compliance-'));
  audioDir = join(tmp, 'audio');
  db = openDb(join(tmp, 'test.db'));
  seed(db, [
    { slug: 'shufersal', name: 'שופרסל', url: 'https://www.shufersal.co.il/', industry: 'x', apiKey: KEY },
    { slug: 'other', name: 'אחר', url: 'https://example.co.il/', industry: 'x', apiKey: OTHER_KEY },
  ]);
  server = createApp({ db, audioDir }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); rmSync(tmp, { recursive: true, force: true }); });

const post = (body, key = KEY) => fetch(`${base}/api/feedback`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': key }, body: JSON.stringify(body),
});
const myData = (method, endUser, key = KEY) => fetch(`${base}/api/my-data`, {
  method, headers: { 'X-API-Key': key, ...(endUser ? { 'X-End-User-Id': endUser } : {}) },
});

// ---- ENG-001 / GDPR Art. 7: consent before collection, recorded server-side ----
test('feedback without valid consent is rejected', async () => {
  for (const consent of [undefined, { version: CONSENT_VERSION, given: false }, { version: 'old', given: true }]) {
    const res = await post({ type: 'text', content: 'x', endUserId: 'u1', consent });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /consent/);
  }
});

test('consent version and time are stored with the feedback', async () => {
  const res = await post({ type: 'text', content: 'שלום', endUserId: 'u1', consent: CONSENT });
  assert.equal(res.status, 201);
  const fb = await res.json();
  assert.equal(fb.consentVersion, CONSENT_VERSION);
  assert.ok(!Number.isNaN(Date.parse(fb.consentAt)));
});

test('the current notice version is published for the widget', async () => {
  const c = await (await fetch(`${base}/api/consent`)).json();
  assert.equal(c.version, CONSENT_VERSION);
  assert.equal(c.retentionDays, 90);
});

test('end-user id is required (no shared "anonymous" bucket that DSR could wipe)', async () => {
  const res = await post({ type: 'text', content: 'x', consent: CONSENT });
  assert.equal(res.status, 400);
});

// ---- ENG-005 / data minimisation: no query strings or fragments stored ----
test('page URL is stored without query string or fragment', async () => {
  const res = await post({ type: 'text', content: 'x', endUserId: 'u1', consent: CONSENT,
    pageUrl: 'https://www.shufersal.co.il/online/he/cart?token=SECRET&email=a@b.c#section' });
  assert.equal((await res.json()).pageUrl, 'https://www.shufersal.co.il/online/he/cart');
  const bad = await post({ type: 'text', content: 'x', endUserId: 'u1', consent: CONSENT, pageUrl: 'not a url' });
  assert.equal((await bad.json()).pageUrl, null);
});

// ---- GDPR Art. 15 / 17: end user can export and delete their own data ----
test('export returns only this end user\'s data for this site', async () => {
  await post({ type: 'text', content: 'של דנה', endUserId: 'dana', consent: CONSENT });
  await post({ type: 'text', content: 'של יוסי', endUserId: 'yossi', consent: CONSENT });
  await post({ type: 'text', content: 'של דנה באתר אחר', endUserId: 'dana', consent: CONSENT }, OTHER_KEY);
  const res = await myData('GET', 'dana');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.site, 'שופרסל');
  assert.deepEqual(data.feedback.map(f => f.content), ['של דנה']);
  assert.equal((await myData('GET', null)).status, 400);
  assert.equal((await myData('GET', 'dana', 'bad-key')).status, 401);
});

test('delete removes the end user\'s rows and audio files, nobody else\'s', async () => {
  const v = await (await post({ type: 'voice', content: 'הקלטה', audioBase64: AUDIO, audioMime: 'audio/webm', endUserId: 'del-me', consent: CONSENT })).json();
  await post({ type: 'text', content: 'נשאר', endUserId: 'keep-me', consent: CONSENT });
  assert.ok(existsSync(join(audioDir, v.audioPath)));

  const res = await myData('DELETE', 'del-me');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).deleted, 1);
  assert.ok(!existsSync(join(audioDir, v.audioPath)), 'audio file removed');
  assert.deepEqual((await (await myData('GET', 'del-me')).json()).feedback, []);
  assert.equal((await (await myData('GET', 'keep-me')).json()).feedback.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM end_users WHERE external_id = 'del-me'").get().n, 0);
});

// ---- ENG-002/003/004: retention purge (default 90 days) incl. audio ----
test('purge deletes feedback and audio older than the retention period only', () => {
  const pdb = openDb(':memory:');
  const pdir = mkdtempSync(join(tmpdir(), 'sim-purge-'));
  seed(pdb, [{ slug: 's', name: 's', url: 'https://s.co.il/', industry: 'x', apiKey: 'k' }]);
  const { productId } = store.findProductByApiKey(pdb, 'k');
  const endUserId = store.getOrCreateEndUser(pdb, productId, 'u');
  const old = store.insertFeedback(pdb, { productId, endUserId, type: 'voice', audioPath: 'old.webm', sentiment: 'neutral', category: 'other' });
  const fresh = store.insertFeedback(pdb, { productId, endUserId, type: 'text', content: 'חדש', sentiment: 'neutral', category: 'other' });
  writeFileSync(join(pdir, 'old.webm'), 'x');
  const now = Date.parse(fresh.createdAt);
  pdb.prepare('UPDATE feedback SET created_at = ? WHERE id = ?').run(new Date(now - 91 * 86400000).toISOString(), old.id);

  const result = purgeExpired(pdb, { audioDir: pdir, days: 90, now });
  assert.equal(result.deleted, 1);
  assert.ok(!existsSync(join(pdir, 'old.webm')));
  assert.deepEqual(pdb.prepare('SELECT id FROM feedback').all().map(r => r.id), [fresh.id]);
  rmSync(pdir, { recursive: true, force: true });
});
