// Every feedback records where it came from (shared link vs. this computer) and the device class,
// and the stats break the totals down by phone / tablet / computer and by channel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { CONSENT_VERSION } from '../src/consent.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36',
  pc: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
};
const KEY = 'k1', ADMIN = 'adm';
let server, base, tmp, db;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sim-device-'));
  db = openDb(join(tmp, 'test.db'));
  seed(db, [{ slug: 'shufersal', name: 'שופרסל', url: 'https://www.shufersal.co.il/', industry: 'x', apiKey: KEY }]);
  server = createApp({ db, audioDir: join(tmp, 'audio'), ipHashSecret: 's', shareMode: true, adminToken: ADMIN }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); rmSync(tmp, { recursive: true, force: true }); });

const post = (ua, user, headers = {}) => fetch(`${base}/api/feedback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY, 'User-Agent': ua, ...headers },
  body: JSON.stringify({ type: 'text', content: 'שירות מעולה', endUserId: user, consent: { version: CONSENT_VERSION, given: true } }),
});

test('feedback through the tunnel is marked "shared", direct local feedback "local"', async () => {
  const viaLink = await (await post(UA.iphone, 'phone-1', { 'CF-Connecting-IP': '198.51.100.1' })).json();
  assert.equal(viaLink.channel, 'shared');
  assert.equal(viaLink.device, 'mobile');
  assert.equal(viaLink.os, 'iOS');
  const local = await (await post(UA.pc, 'pc-1')).json();
  assert.equal(local.channel, 'local');
  assert.equal(local.device, 'desktop');
});

test('stats break totals down by device class and by channel', async () => {
  await post(UA.android, 'phone-2', { 'CF-Connecting-IP': '198.51.100.2' });
  const shu = (await (await fetch(`${base}/api/stats`, { headers: { 'X-Admin-Token': ADMIN } })).json()).find(s => s.slug === 'shufersal');
  assert.equal(shu.total, 3);
  assert.equal(shu.mobile, 2);
  assert.equal(shu.desktop, 1);
  assert.equal(shu.tablet, 0);
  assert.equal(shu.shared, 2);
});
