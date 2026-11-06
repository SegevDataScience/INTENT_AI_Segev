// Multi-language analysis (he / en / ar) and "share mode" (public link through a tunnel).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../src/analyze.js';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { hashIp } from '../src/identity.js';

// ---------- analysis in three languages ----------
test('English sentiment and categories', () => {
  assert.equal(analyze('Great service, thanks!').sentiment, 'positive');
  assert.equal(analyze('The website is slow and broken').sentiment, 'negative');
  assert.equal(analyze('This is not good at all').sentiment, 'negative');
  assert.equal(analyze('The delivery arrived late').category, 'delivery');
  assert.equal(analyze('Payment failed at checkout').category, 'checkout');
  assert.equal(analyze('My flight was delayed').category, 'travel');
  assert.equal(analyze('Just saying hello').sentiment, 'neutral');
});

test('Arabic sentiment and categories (incl. attached prefixes)', () => {
  assert.equal(analyze('خدمة ممتازة، شكرا').sentiment, 'positive');
  assert.equal(analyze('الموقع بطيء جدا').sentiment, 'negative');
  assert.equal(analyze('التطبيق لا يعمل').sentiment, 'negative');
  assert.equal(analyze('التوصيل تأخر').category, 'delivery');
  assert.equal(analyze('مشكلة في الدفع').category, 'checkout');
  assert.equal(analyze('مرحبا').sentiment, 'neutral');
});

test('Hebrew behaviour unchanged', () => {
  assert.equal(analyze('האתר מעולה, תודה רבה!').sentiment, 'positive');
  assert.equal(analyze('זה לא טוב בכלל').sentiment, 'negative');
  assert.equal(analyze('השליח לא הגיע').category, 'delivery');
});

// ---------- share mode ----------
const KEY = 'k1';
const ADMIN = 'admin-secret-123';
let server, base, tmp, db;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sim-share-'));
  db = openDb(join(tmp, 'test.db'));
  seed(db, [{ slug: 'shufersal', name: 'שופרסל', url: 'https://www.shufersal.co.il/', industry: 'x', apiKey: KEY }]);
  server = createApp({ db, audioDir: join(tmp, 'audio'), ipHashSecret: 's', shareMode: true, adminToken: ADMIN, rateLimit: { max: 3, windowMs: 60000 } }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); rmSync(tmp, { recursive: true, force: true }); });

const post = (body, headers = {}) => fetch(`${base}/api/feedback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY, ...headers },
  body: JSON.stringify({ type: 'text', content: 'שלום', endUserId: 'u1', consent: { version: CONSENT_VERSION, given: true }, ...body }),
});

test('mode endpoint tells the pages whether this is a shared link and whether the caller is admin', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/mode`)).json(), { share: true, admin: false });
  assert.deepEqual(await (await fetch(`${base}/api/mode`, { headers: { 'X-Admin-Token': ADMIN } })).json(), { share: true, admin: true });
});

test('visitors can send feedback and use the widget, but cannot read the data', async () => {
  assert.equal((await fetch(`${base}/api/sites`)).status, 200);
  assert.equal((await fetch(`${base}/api/sites/shufersal/widget-config`)).status, 200);
  assert.equal((await post({ lang: 'ar', content: 'خدمة ممتازة' }, { 'CF-Connecting-IP': '198.51.100.9' })).status, 201);
  for (const path of ['/api/feedback', '/api/stats', '/audio/00000000-0000-0000-0000-000000000000.webm']) {
    assert.equal((await fetch(base + path)).status, 401, `${path} must be admin-only`);
  }
});

test('the admin reads everything with the token (header or ?admin=)', async () => {
  const rows = await (await fetch(`${base}/api/feedback`, { headers: { 'X-Admin-Token': ADMIN } })).json();
  assert.ok(rows.length >= 1);
  const r = rows.find(f => f.content === 'خدمة ممتازة');
  assert.equal(r.feedbackLang, 'ar', 'widget language stored');
  assert.equal(r.sentiment, 'positive');
  assert.equal(r.ipHash, hashIp('198.51.100.9', 's'), 'real visitor IP (via tunnel header) is what gets hashed');
  assert.equal((await fetch(`${base}/api/stats?admin=${ADMIN}`)).status, 200);
  assert.equal((await fetch(`${base}/api/stats`, { headers: { 'X-Admin-Token': 'wrong' } })).status, 401);
});

test('invalid widget language is dropped', async () => {
  const fb = await (await post({ lang: 'xx', endUserId: 'u-lang' }, { 'CF-Connecting-IP': '198.51.100.20' })).json();
  assert.equal(fb.feedbackLang, null);
});

test('public link is rate-limited per visitor', async () => {
  const ip = { 'CF-Connecting-IP': '203.0.113.50' };
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await post({ endUserId: 'spam' }, ip)).status);
  assert.deepEqual(codes, [201, 201, 201, 429]);
  assert.equal((await post({ endUserId: 'other' }, { 'CF-Connecting-IP': '203.0.113.51' })).status, 201, 'other visitors unaffected');
});
