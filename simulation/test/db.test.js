import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/db.js';
import { seed } from '../src/seed.js';

const SITES = [
  { slug: 'shufersal', name: 'שופרסל', url: 'https://www.shufersal.co.il/', industry: 'קמעונאות', apiKey: 'k1' },
  { slug: 'other', name: 'אחר', url: 'https://example.co.il/', industry: 'x', apiKey: 'k2' },
];
const fresh = () => { const db = store.openDb(':memory:'); seed(db, SITES); return db; };

test('seed is idempotent', () => {
  const db = fresh();
  seed(db, SITES);
  assert.equal(store.listSites(db).length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 2);
});

test('finds product by api key, not by unknown key', () => {
  const db = fresh();
  const p = store.findProductByApiKey(db, 'k1');
  assert.equal(p.slug, 'shufersal');
  assert.equal(store.findProductByApiKey(db, 'nope'), undefined);
  assert.equal(store.getApiKeyForSlug(db, 'other'), 'k2');
});

test('end user is created once per external id', () => {
  const db = fresh();
  const { productId } = store.findProductByApiKey(db, 'k1');
  const a = store.getOrCreateEndUser(db, productId, 'u1');
  const b = store.getOrCreateEndUser(db, productId, 'u1');
  assert.equal(a, b);
  assert.notEqual(store.getOrCreateEndUser(db, productId, 'u2'), a);
});

test('feedback is stored and listed per customer, newest first', () => {
  const db = fresh();
  for (const [key, text] of [['k1', 'ראשון'], ['k2', 'אחר'], ['k1', 'שני']]) {
    const { productId } = store.findProductByApiKey(db, key);
    const endUserId = store.getOrCreateEndUser(db, productId, 'u1');
    store.insertFeedback(db, { productId, endUserId, type: 'text', content: text, audioPath: null,
      audioDurationMs: null, rating: 4, sentiment: 'positive', category: 'other', pageUrl: null });
  }
  const shu = store.listFeedback(db, { orgSlug: 'shufersal' });
  assert.deepEqual(shu.map(f => f.content), ['שני', 'ראשון']);
  assert.equal(shu[0].orgName, 'שופרסל');
  assert.equal(shu[0].endUserId, 'u1');
  assert.equal(store.listFeedback(db).length, 3);
});

test('a site removed from sites.json is hidden everywhere but its data is kept', () => {
  const db = fresh();
  const { productId } = store.findProductByApiKey(db, 'k2');
  const endUserId = store.getOrCreateEndUser(db, productId, 'u1');
  store.insertFeedback(db, { productId, endUserId, type: 'text', content: 'ישן', sentiment: 'neutral', category: 'other' });

  seed(db, SITES.filter(s => s.slug !== 'other'));

  assert.deepEqual(store.listSites(db).map(s => s.slug), ['shufersal']);
  assert.deepEqual(store.getStats(db).map(s => s.slug), ['shufersal']);
  assert.equal(store.listFeedback(db).length, 0);
  assert.equal(store.listFeedback(db, { orgSlug: 'other' }).length, 0);
  assert.equal(store.getApiKeyForSlug(db, 'other'), undefined);
  assert.equal(store.findProductByApiKey(db, 'k2'), undefined, 'inactive site cannot receive feedback');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 1, 'row kept in DB');

  seed(db, SITES); // re-adding the site brings it and its data back
  assert.equal(store.listFeedback(db, { orgSlug: 'other' }).length, 1);
});

test('opening an existing DB without the active column migrates it', () => {
  const db = store.openDb(':memory:');
  db.exec('ALTER TABLE organizations DROP COLUMN active');
  store.migrate(db);
  seed(db, SITES);
  assert.equal(store.listSites(db).length, 2);
});

test('stats aggregate per customer including empty ones', () => {
  const db = fresh();
  const { productId } = store.findProductByApiKey(db, 'k1');
  const endUserId = store.getOrCreateEndUser(db, productId, 'u1');
  store.insertFeedback(db, { productId, endUserId, type: 'voice', content: null, audioPath: 'a.webm',
    audioDurationMs: 1000, rating: null, sentiment: 'negative', category: 'delivery', pageUrl: null });
  const stats = store.getStats(db);
  const shu = stats.find(s => s.slug === 'shufersal');
  assert.equal(shu.total, 1); assert.equal(shu.voice, 1); assert.equal(shu.text, 0);
  assert.equal(shu.negative, 1); assert.equal(shu.categories.delivery, 1);
  assert.equal(stats.find(s => s.slug === 'other').total, 0);
});
