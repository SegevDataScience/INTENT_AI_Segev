import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { CONSENT_VERSION } from '../src/consent.js';

const KEY = 'test_key';
let server, base, audioDir, tmp, db;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sim-test-'));
  audioDir = join(tmp, 'audio');
  db = openDb(join(tmp, 'test.db'));
  seed(db, [
    { slug: 'shufersal', name: 'שופרסל', url: 'https://www.shufersal.co.il/', industry: 'x', apiKey: KEY },
    { slug: 'other', name: 'אחר', url: 'https://example.co.il/', industry: 'x', apiKey: 'other_key' },
  ]);
  server = createApp({ db, audioDir }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

// Valid feedback now requires consent and an end-user id; tests that probe other validation get them by default.
const withDefaults = body => ({ endUserId: 'u-default', consent: { version: CONSENT_VERSION, given: true }, ...body });
const post = (body, key = KEY, raw = false) => fetch(`${base}/api/feedback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(key ? { 'X-API-Key': key } : {}) },
  body: raw ? body : JSON.stringify(withDefaults(body)),
});
const AUDIO = Buffer.from('fake-audio-bytes').toString('base64');

test('text feedback → 201 with analysis', async () => {
  const res = await post({ type: 'text', content: 'המשלוח איטי', rating: 2, endUserId: 'u1', pageUrl: 'https://www.shufersal.co.il/' });
  assert.equal(res.status, 201);
  const fb = await res.json();
  assert.equal(fb.orgSlug, 'shufersal');
  assert.equal(fb.sentiment, 'negative');
  assert.equal(fb.category, 'delivery');
  assert.equal(fb.rating, 2);
});

test('voice feedback writes audio file; codecs mime accepted (Review Focus 2)', async () => {
  const res = await post({ type: 'voice', content: 'אהבתי', audioBase64: AUDIO, audioMime: 'audio/webm;codecs=opus', audioDurationMs: 3200, endUserId: 'u1' });
  assert.equal(res.status, 201);
  const fb = await res.json();
  assert.match(fb.audioPath, /^[0-9a-f-]{36}\.webm$/);
  assert.ok(existsSync(join(audioDir, fb.audioPath)));
  const audio = await fetch(`${base}/audio/${fb.audioPath}`);
  assert.equal(audio.status, 200);
  assert.equal(Buffer.from(await audio.arrayBuffer()).toString(), 'fake-audio-bytes');
});

test('voice with empty transcript is saved as neutral (Review Focus 5)', async () => {
  const res = await post({ type: 'voice', content: '', audioBase64: AUDIO, audioMime: 'audio/ogg', endUserId: 'u2' });
  assert.equal(res.status, 201);
  const fb = await res.json();
  assert.equal(fb.content, null);
  assert.equal(fb.sentiment, 'neutral');
});

test('auth and validation errors', async () => {
  assert.equal((await post({ type: 'text', content: 'x' }, 'wrong')).status, 401);
  assert.equal((await post({ type: 'text', content: 'x' }, null)).status, 401);
  assert.equal((await post({ type: 'video', content: 'x' })).status, 400);
  assert.equal((await post({ type: 'text', content: '   ' })).status, 400);
  assert.equal((await post({ type: 'text', content: 'א'.repeat(5001) })).status, 400);
  assert.equal((await post({ type: 'text', content: 'x', rating: 9 })).status, 400);
  assert.equal((await post({ type: 'voice', content: 'x' })).status, 400);
  assert.equal((await post({ type: 'voice', audioBase64: AUDIO, audioMime: 'video/avi' })).status, 400);
});

test('malformed JSON → 400 JSON (Review Focus 4)', async () => {
  const res = await post('{not json', KEY, true);
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test('body over 10mb → 413 JSON, server still up (Review Focus 3)', async () => {
  const res = await post({ type: 'voice', audioBase64: 'A'.repeat(11 * 1024 * 1024), audioMime: 'audio/webm' });
  assert.equal(res.status, 413);
  assert.ok((await res.json()).error);
  assert.equal((await fetch(`${base}/api/sites`)).status, 200);
});

test('feedback list filters by org; sites hide keys; widget-config returns key', async () => {
  await post({ type: 'text', content: 'מאתר אחר' }, 'other_key');
  const shu = await (await fetch(`${base}/api/feedback?org=shufersal`)).json();
  assert.ok(shu.length >= 1 && shu.every(f => f.orgSlug === 'shufersal'));
  const all = await (await fetch(`${base}/api/feedback`)).json();
  assert.ok(all.some(f => f.orgSlug === 'other'));
  const sites = await (await fetch(`${base}/api/sites`)).json();
  assert.equal(sites.length, 2);
  assert.ok(sites.every(s => !('apiKey' in s)));
  assert.deepEqual(await (await fetch(`${base}/api/sites/shufersal/widget-config`)).json(), { apiKey: KEY });
  assert.equal((await fetch(`${base}/api/sites/nope/widget-config`)).status, 404);
  const stats = await (await fetch(`${base}/api/stats`)).json();
  assert.ok(stats.find(s => s.slug === 'shufersal').total >= 3);
});

test('/audio blocks path traversal and unknown files', async () => {
  assert.equal((await fetch(`${base}/audio/..%2F..%2Fpackage.json`)).status, 400);
  assert.equal((await fetch(`${base}/audio/00000000-0000-0000-0000-000000000000.webm`)).status, 404);
});
