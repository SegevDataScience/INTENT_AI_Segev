// Synthetic demo data: deterministic, realistic spread, safe to publish (no real people).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as store from '../src/db.js';
import { loadSites, seed } from '../src/seed.js';
import { generateDemoFeedback, seedDemo } from '../src/demo-data.js';

const DEMO_SITES = loadSites(join(dirname(fileURLToPath(import.meta.url)), '..', 'sites.demo.json'));
const NOW = Date.parse('2026-11-07T12:00:00Z');

test('sites.demo.json: 5 fictional sites with the same shape as sites.json', () => {
  assert.equal(DEMO_SITES.length, 5);
  for (const s of DEMO_SITES) for (const k of ['slug', 'name', 'url', 'industry', 'apiKey']) assert.ok(s[k], `${s.slug} missing ${k}`);
  assert.ok(DEMO_SITES.every(s => new URL(s.url).hostname.endsWith('.example')), 'fictional domains only');
});

test('generation is deterministic for a given seed', () => {
  const a = generateDemoFeedback(DEMO_SITES, { seed: 7, now: NOW });
  const b = generateDemoFeedback(DEMO_SITES, { seed: 7, now: NOW });
  assert.deepEqual(a, b);
  assert.notDeepEqual(generateDemoFeedback(DEMO_SITES, { seed: 8, now: NOW }), a);
});

test('realistic spread: every site, many distinct users, voice + text, hours, past 14 days', () => {
  const rows = generateDemoFeedback(DEMO_SITES, { seed: 7, now: NOW, count: 180 });
  assert.equal(rows.length, 180);
  assert.equal(new Set(rows.map(r => r.siteSlug)).size, 5);
  assert.ok(new Set(rows.map(r => r.endUserId)).size >= 40, 'distinct users');
  assert.ok(rows.some(r => r.type === 'voice') && rows.some(r => r.type === 'text'));
  assert.ok(new Set(rows.map(r => new Date(r.createdAt).getUTCHours())).size >= 12, 'spread over the day');
  const ages = rows.map(r => (NOW - Date.parse(r.createdAt)) / 86400000);
  assert.ok(Math.min(...ages) >= 0 && Math.max(...ages) <= 14);
  assert.ok(new Set(rows.map(r => r.browser)).size >= 3, 'several browsers');
  assert.ok(rows.every(r => !r.content || !/QA-/.test(r.content)));
});

test('seedDemo writes into the TEST DB with the given timestamps and analysis', () => {
  const db = store.openDb(':memory:');
  seed(db, DEMO_SITES);
  const n = seedDemo(db, DEMO_SITES, { seed: 7, now: NOW, count: 60 });
  assert.equal(n, 60);
  const all = store.listFeedback(db);
  assert.equal(all.length, 60);
  assert.ok(all.every(f => f.sentiment && f.category && f.consentVersion));
  assert.ok(all.every(f => Date.parse(f.createdAt) <= NOW));
  const stats = store.getStats(db);
  assert.ok(stats.every(s => s.users > 0));
});
