import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as store from '../src/db.js';
import { loadSites, seed } from '../src/seed.js';

const SITES = loadSites(join(dirname(fileURLToPath(import.meta.url)), '..', 'sites.json'));

test('sites.json: Shufersal + 4 more, each complete and unique', () => {
  assert.equal(SITES.length, 5);
  assert.ok(SITES.some(s => s.slug === 'shufersal'));
  for (const s of SITES) {
    for (const k of ['slug', 'name', 'url', 'industry', 'apiKey']) assert.ok(s[k], `${s.slug} missing ${k}`);
    assert.match(s.slug, /^[a-z0-9-]+$/);
    assert.equal(new URL(s.url).protocol, 'https:');
  }
  assert.equal(new Set(SITES.map(s => s.slug)).size, 5, 'slugs unique');
  assert.equal(new Set(SITES.map(s => s.apiKey)).size, 5, 'api keys unique');
});

test('every site is a separate customer, filterable in the dashboard', () => {
  const db = store.openDb(':memory:');
  seed(db, SITES);
  assert.equal(store.listSites(db).length, 5);
  for (const s of SITES) {
    const { productId } = store.findProductByApiKey(db, s.apiKey);
    const endUserId = store.getOrCreateEndUser(db, productId, 'u');
    store.insertFeedback(db, { productId, endUserId, type: 'text', content: `משוב על ${s.name}`,
      sentiment: 'neutral', category: 'other' });
  }
  for (const s of SITES) {
    const rows = store.listFeedback(db, { orgSlug: s.slug });
    assert.equal(rows.length, 1, `${s.slug} sees only its own feedback`);
    assert.equal(rows[0].content, `משוב על ${s.name}`);
  }
  const stats = store.getStats(db);
  assert.deepEqual(stats.map(s => s.slug).sort(), SITES.map(s => s.slug).sort());
  assert.ok(stats.every(s => s.total === 1));
});
