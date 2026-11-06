// Distinguishing distinct feedback authors: coarse device context + hashed IP (never the raw IP).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import * as store from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { CONSENT_VERSION } from '../src/consent.js';
import { parseUserAgent, countryFrom, hashIp, cleanLocale, cleanTimeZone } from '../src/identity.js';

const UA = {
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0',
  edgeHeadless: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  safariIpad: 'Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
};

test('User-Agent is reduced to browser / OS / device only', () => {
  assert.deepEqual(parseUserAgent(UA.edgeWin), { browser: 'Edge', os: 'Windows', device: 'desktop' });
  assert.deepEqual(parseUserAgent(UA.edgeHeadless), { browser: 'Edge (headless)', os: 'Windows', device: 'desktop' });
  assert.deepEqual(parseUserAgent(UA.chromeAndroid), { browser: 'Chrome', os: 'Android', device: 'mobile' });
  assert.deepEqual(parseUserAgent(UA.safariIphone), { browser: 'Safari', os: 'iOS', device: 'mobile' });
  assert.deepEqual(parseUserAgent(UA.safariIpad), { browser: 'Safari', os: 'iOS', device: 'tablet' });
  assert.deepEqual(parseUserAgent(UA.firefoxLinux), { browser: 'Firefox', os: 'Linux', device: 'desktop' });
  assert.deepEqual(parseUserAgent(UA.chromeMac), { browser: 'Chrome', os: 'macOS', device: 'desktop' });
  assert.deepEqual(parseUserAgent(''), { browser: 'Other', os: 'Other', device: 'desktop' });
});

test('country comes from the time zone, else the locale region', () => {
  assert.equal(countryFrom({ timeZone: 'Asia/Jerusalem', locale: 'en-US' }), 'IL');
  assert.equal(countryFrom({ timeZone: 'Asia/Tel_Aviv' }), 'IL');
  assert.equal(countryFrom({ timeZone: 'Europe/London' }), 'GB');
  assert.equal(countryFrom({ locale: 'he-IL' }), 'IL');
  assert.equal(countryFrom({ locale: 'en' }), null);
  assert.equal(countryFrom({}), null);
});

test('locale and time zone are validated (no free text / injection)', () => {
  assert.equal(cleanLocale('he-IL'), 'he-IL');
  assert.equal(cleanLocale('<script>'), null);
  assert.equal(cleanLocale('x'.repeat(50)), null);
  assert.equal(cleanTimeZone('Asia/Jerusalem'), 'Asia/Jerusalem');
  assert.equal(cleanTimeZone('America/Argentina/Buenos_Aires'), 'America/Argentina/Buenos_Aires');
  assert.equal(cleanTimeZone("'; DROP TABLE feedback;--"), null);
});

test('IP hash is keyed, one-way, stable, and never the raw address', () => {
  const a = hashIp('203.0.113.7', 'secret-1');
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(hashIp('203.0.113.7', 'secret-1'), a, 'stable for the same IP');
  assert.notEqual(hashIp('203.0.113.8', 'secret-1'), a, 'differs per IP');
  assert.notEqual(hashIp('203.0.113.7', 'secret-2'), a, 'depends on the secret key');
  assert.equal(hashIp('::ffff:203.0.113.7', 'secret-1'), a, 'IPv4-mapped IPv6 normalised');
  assert.equal(hashIp('', 'secret-1'), null);
});

// ---- through the API ----
let server, base, tmp, db;
const KEY = 'k1';
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sim-identity-'));
  db = openDb(join(tmp, 'test.db'));
  seed(db, [{ slug: 'shufersal', name: 'שופרסל', url: 'https://www.shufersal.co.il/', industry: 'x', apiKey: KEY }]);
  server = createApp({ db, audioDir: join(tmp, 'audio'), ipHashSecret: 'test-secret' }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); rmSync(tmp, { recursive: true, force: true }); });

const post = (body, ua = UA.edgeWin) => fetch(`${base}/api/feedback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY, 'User-Agent': ua },
  body: JSON.stringify({ type: 'text', content: 'שלום', consent: { version: CONSENT_VERSION, given: true }, ...body }),
});

test('feedback stores device context and hashed IP, not the raw IP or full UA', async () => {
  const res = await post({ endUserId: 'u-a', locale: 'he-IL', timeZone: 'Asia/Jerusalem' });
  assert.equal(res.status, 201);
  const text = await res.text();
  const fb = JSON.parse(text);
  assert.equal(fb.browser, 'Edge');
  assert.equal(fb.os, 'Windows');
  assert.equal(fb.device, 'desktop');
  assert.equal(fb.language, 'he-IL');
  assert.equal(fb.timeZone, 'Asia/Jerusalem');
  assert.equal(fb.country, 'IL');
  assert.match(fb.ipHash, /^[0-9a-f]{16}$/);
  assert.ok(!text.includes('127.0.0.1'), 'raw IP never returned');
  const row = db.prepare('SELECT * FROM feedback WHERE id = ?').get(fb.id);
  assert.ok(!JSON.stringify(row).includes('127.0.0.1'), 'raw IP never stored');
  assert.ok(!JSON.stringify(row).includes('AppleWebKit'), 'full User-Agent never stored');
});

test('invalid locale / time zone are dropped, feedback still accepted', async () => {
  const res = await post({ endUserId: 'u-a', locale: '<b>', timeZone: 'DROP TABLE' });
  const fb = await res.json();
  assert.equal(res.status, 201);
  assert.equal(fb.language, null);
  assert.equal(fb.timeZone, null);
});

test('distinct authors are counted per site', async () => {
  await post({ endUserId: 'u-b' }, UA.chromeAndroid);
  await post({ endUserId: 'u-b' }, UA.chromeAndroid);
  const shu = store.getStats(db).find(s => s.slug === 'shufersal');
  assert.equal(shu.users, 2, 'u-a and u-b');
  assert.ok(shu.total >= 4);
});
