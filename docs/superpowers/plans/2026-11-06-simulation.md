# Simulation (local Intent AI demo) Implementation Plan

> **Note (2026-11-06):** after the repo restructure, the folder moved from `simulation/` to `presentation/simulation/`. The paths below reflect the state at the time of writing.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone local site in `simulation/` where a visitor on a screenshot of the real Shufersal site sends voice or text feedback through an Intent AI widget, the feedback is stored per customer in a SQLite TEST DB, and a dashboard shows it per customer.

**Architecture:** Node 24 + Express server (`src/app.js`, factory taking an injected db) over a thin SQLite data layer (`src/db.js`, `node:sqlite`). A pure Hebrew keyword analyzer (`src/analyze.js`) tags sentiment/category. Static vanilla-JS pages in `public/` (picker, site page, widget, dashboard). Screenshots come from headless Edge via `scripts/capture.js`.

**Tech Stack:** Node ≥22.5 (`node:sqlite`, `node:test`, global `fetch`), Express 4, vanilla JS/CSS, MediaRecorder + Web Speech API in the browser.

**Spec:** `docs/superpowers/specs/2026-11-06-simulation-design.md`

## Global Constraints

- Location: `simulation/` at the root of `Intetnt-ai-v1`, NOT part of the pnpm workspace; own `package.json`, ES modules (`"type": "module"`).
- Only runtime dependency: `express@^4.21.2`. No dev dependencies (tests use `node --test`).
- DB file: `simulation/data/test.db`; audio: `simulation/data/audio/<feedbackId>.<ext>`.
- Port: `process.env.PORT || 4000`.
- Auth header: `X-API-Key` (product key from `sites.json`).
- Text max 5000 chars; JSON body limit 10mb; voice recording max 2 minutes.
- `type` ∈ `text|voice`; sentiment ∈ `positive|neutral|negative`; category ∈ `checkout|delivery|prices|site|service|other`.
- All UI in Hebrew, `dir="rtl"`; widget launcher bottom-left.
- No paid AI services; transcription only via browser Web Speech API `he-IL`.
- Git-ignored: `simulation/node_modules/`, `simulation/data/`, `simulation/public/sites/` (via `simulation/.gitignore`, keeps the folder self-contained).
- No commits unless the user asks (user's standing rule overrides the plan's usual commit steps).

## Review Focus

1. Hebrew negation/prefixes ("לא טוב", "והמשלוח איטי") — negation must read negative, prefixed words must match. → test in Task 2.
2. Real browser mime strings like `audio/webm;codecs=opus` — must be accepted and saved as `.webm`. → test in Task 3.
3. Body over 10mb — must return 413 JSON, server keeps running. → test in Task 3.
4. Malformed JSON body — must return 400 JSON, not an HTML stack trace. → test in Task 3.
5. Voice with empty transcript (browser lacks SpeechRecognition) — must save with `content: null`, sentiment `neutral`. → test in Task 3.

---

### Task 1: Project scaffold + data layer

**Files:**
- Create: `simulation/package.json`, `simulation/.gitignore`, `simulation/sites.json`
- Create: `simulation/src/db.js`, `simulation/src/seed.js`
- Test: `simulation/test/db.test.js`

**Interfaces:**
- Produces (`src/db.js`):
  - `openDb(path: string): DatabaseSync` — creates dirs, enables FKs, applies schema.
  - `upsertSite(db, {slug,name,url,industry,apiKey}): {organizationId, productId}` — idempotent.
  - `listSites(db): Array<{slug,name,industry,url}>`
  - `getApiKeyForSlug(db, slug): string|undefined`
  - `findProductByApiKey(db, apiKey): {productId,productName,url,organizationId,slug,organizationName}|undefined`
  - `getOrCreateEndUser(db, productId, externalId): string` (end_user id)
  - `insertFeedback(db, {id?,productId,endUserId,type,content,audioPath,audioDurationMs,rating,sentiment,category,pageUrl}): FeedbackRow`
  - `listFeedback(db, {orgSlug?}): FeedbackRow[]` newest first
  - `getStats(db): Array<{slug,name,total,text,voice,positive,neutral,negative,categories:Record<string,number>}>`
  - `FeedbackRow = {id,type,content,audioPath,audioDurationMs,rating,sentiment,category,pageUrl,createdAt,orgSlug,orgName,endUserId}` (`endUserId` = external id)
- Produces (`src/seed.js`): `loadSites(path): Site[]`, `seed(db, sites): void`

- [ ] **Step 1: Scaffold files**

`simulation/package.json`:
```json
{
  "name": "intent-ai-simulation",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Local demo of Intent AI voice/text feedback on real Israeli sites",
  "scripts": {
    "start": "node server.js",
    "test": "node --test",
    "capture": "node scripts/capture.js",
    "reset": "node scripts/reset.js"
  },
  "dependencies": { "express": "^4.21.2" },
  "engines": { "node": ">=22.5.0" }
}
```

`simulation/.gitignore`:
```
node_modules/
data/
public/sites/
```

`simulation/sites.json`:
```json
[
  {
    "slug": "shufersal",
    "name": "שופרסל",
    "url": "https://www.shufersal.co.il/online/he/",
    "industry": "קמעונאות",
    "apiKey": "sim_shufersal_demo_key"
  }
]
```

Run: `cd simulation && npm install`

- [ ] **Step 2: Write the failing test** — `simulation/test/db.test.js`:
```js
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd simulation && npm test`
Expected: FAIL — `Cannot find module '../src/db.js'`.

- [ ] **Step 4: Implement** — `simulation/src/db.js`:
```js
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  industry TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL, url TEXT, api_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS end_users (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  UNIQUE(product_id, external_id));
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  end_user_id TEXT NOT NULL REFERENCES end_users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('text','voice')),
  content TEXT, audio_path TEXT, audio_duration_ms INTEGER, rating INTEGER,
  sentiment TEXT, category TEXT, page_url TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_feedback_product ON feedback(product_id, created_at);
`;

const now = () => new Date().toISOString();

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function upsertSite(db, site) {
  const industry = site.industry ?? null;
  let org = db.prepare('SELECT id FROM organizations WHERE slug = ?').get(site.slug);
  if (org) {
    db.prepare('UPDATE organizations SET name = ?, industry = ? WHERE id = ?').run(site.name, industry, org.id);
  } else {
    org = { id: randomUUID() };
    db.prepare('INSERT INTO organizations (id, slug, name, industry, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(org.id, site.slug, site.name, industry, now());
  }
  let product = db.prepare('SELECT id FROM products WHERE organization_id = ?').get(org.id);
  if (product) {
    db.prepare('UPDATE products SET name = ?, url = ?, api_key = ? WHERE id = ?')
      .run(site.name, site.url, site.apiKey, product.id);
  } else {
    product = { id: randomUUID() };
    db.prepare('INSERT INTO products (id, organization_id, name, url, api_key, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(product.id, org.id, site.name, site.url, site.apiKey, now());
  }
  return { organizationId: org.id, productId: product.id };
}

export function listSites(db) {
  return db.prepare(`SELECT o.slug, o.name, o.industry, p.url FROM organizations o
    JOIN products p ON p.organization_id = o.id ORDER BY o.created_at, o.slug`).all();
}

export function getApiKeyForSlug(db, slug) {
  return db.prepare(`SELECT p.api_key AS apiKey FROM products p
    JOIN organizations o ON o.id = p.organization_id WHERE o.slug = ?`).get(slug)?.apiKey;
}

export function findProductByApiKey(db, apiKey) {
  return db.prepare(`SELECT p.id AS productId, p.name AS productName, p.url, o.id AS organizationId,
    o.slug, o.name AS organizationName FROM products p
    JOIN organizations o ON o.id = p.organization_id WHERE p.api_key = ?`).get(apiKey);
}

export function getOrCreateEndUser(db, productId, externalId) {
  const t = now();
  const row = db.prepare('SELECT id FROM end_users WHERE product_id = ? AND external_id = ?').get(productId, externalId);
  if (row) {
    db.prepare('UPDATE end_users SET last_seen = ? WHERE id = ?').run(t, row.id);
    return row.id;
  }
  const id = randomUUID();
  db.prepare('INSERT INTO end_users (id, product_id, external_id, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)')
    .run(id, productId, externalId, t, t);
  return id;
}

const FEEDBACK_SELECT = `SELECT f.id, f.type, f.content, f.audio_path AS audioPath,
  f.audio_duration_ms AS audioDurationMs, f.rating, f.sentiment, f.category, f.page_url AS pageUrl,
  f.created_at AS createdAt, o.slug AS orgSlug, o.name AS orgName, e.external_id AS endUserId
  FROM feedback f
  JOIN products p ON p.id = f.product_id
  JOIN organizations o ON o.id = p.organization_id
  JOIN end_users e ON e.id = f.end_user_id`;

export function insertFeedback(db, f) {
  const id = f.id ?? randomUUID();
  db.prepare(`INSERT INTO feedback (id, product_id, end_user_id, type, content, audio_path,
    audio_duration_ms, rating, sentiment, category, page_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, f.productId, f.endUserId, f.type, f.content ?? null, f.audioPath ?? null,
      f.audioDurationMs ?? null, f.rating ?? null, f.sentiment ?? null, f.category ?? null,
      f.pageUrl ?? null, now());
  return { ...db.prepare(`${FEEDBACK_SELECT} WHERE f.id = ?`).get(id) };
}

export function listFeedback(db, { orgSlug = null } = {}) {
  return db.prepare(`${FEEDBACK_SELECT} WHERE (? IS NULL OR o.slug = ?)
    ORDER BY f.created_at DESC, f.rowid DESC`).all(orgSlug, orgSlug).map(r => ({ ...r }));
}

export function getStats(db) {
  const rows = db.prepare(`SELECT o.slug, o.name,
      COUNT(f.id) AS total,
      COALESCE(SUM(f.type = 'text'), 0) AS text,
      COALESCE(SUM(f.type = 'voice'), 0) AS voice,
      COALESCE(SUM(f.sentiment = 'positive'), 0) AS positive,
      COALESCE(SUM(f.sentiment = 'neutral'), 0) AS neutral,
      COALESCE(SUM(f.sentiment = 'negative'), 0) AS negative
    FROM organizations o
    JOIN products p ON p.organization_id = o.id
    LEFT JOIN feedback f ON f.product_id = p.id
    GROUP BY o.id ORDER BY o.created_at, o.slug`).all();
  const cats = db.prepare(`SELECT o.slug, f.category, COUNT(*) AS n FROM feedback f
    JOIN products p ON p.id = f.product_id JOIN organizations o ON o.id = p.organization_id
    GROUP BY o.slug, f.category`).all();
  return rows.map(r => ({
    ...r,
    categories: Object.fromEntries(cats.filter(c => c.slug === r.slug).map(c => [c.category ?? 'other', c.n])),
  }));
}
```

`simulation/src/seed.js`:
```js
import { readFileSync } from 'node:fs';
import { upsertSite } from './db.js';

export function loadSites(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function seed(db, sites) {
  for (const site of sites) upsertSite(db, site);
}
```

- [ ] **Step 5: Run tests** — `cd simulation && npm test` → Expected: 5 pass.

---

### Task 2: Hebrew analyzer

**Files:**
- Create: `simulation/src/analyze.js`
- Test: `simulation/test/analyze.test.js`

**Interfaces:**
- Produces: `analyze(text: string|null, rating?: number|null): { sentiment: 'positive'|'neutral'|'negative', category: 'checkout'|'delivery'|'prices'|'site'|'service'|'other' }`

- [ ] **Step 1: Write the failing test** — `simulation/test/analyze.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.js';

test('positive / negative / neutral', () => {
  assert.equal(analyze('האתר מעולה, תודה רבה!').sentiment, 'positive');
  assert.equal(analyze('הכל איטי ומתסכל').sentiment, 'negative');
  assert.equal(analyze('רציתי לשאול שאלה').sentiment, 'neutral');
});

test('negation reads negative, not positive (Review Focus 1)', () => {
  assert.equal(analyze('זה לא טוב בכלל').sentiment, 'negative');
  assert.equal(analyze('החיפוש לא נוח').sentiment, 'negative');
});

test('Hebrew prefixes still match (Review Focus 1)', () => {
  assert.equal(analyze('והמשלוח היה איטי').sentiment, 'negative');
  assert.equal(analyze('והמשלוח היה איטי').category, 'delivery');
});

test('no false positive on substrings', () => {
  // "קל" must not match inside "שקלים"
  assert.equal(analyze('שילמתי עשרים שקלים').sentiment, 'neutral');
});

test('rating pushes sentiment', () => {
  assert.equal(analyze('', 1).sentiment, 'negative');
  assert.equal(analyze('', 5).sentiment, 'positive');
  assert.equal(analyze('', 3).sentiment, 'neutral');
  assert.equal(analyze('קצת איטי', 5).sentiment, 'positive');
});

test('empty / null input', () => {
  assert.deepEqual(analyze(null), { sentiment: 'neutral', category: 'other' });
  assert.deepEqual(analyze(''), { sentiment: 'neutral', category: 'other' });
});

test('categories, first match wins in list order', () => {
  assert.equal(analyze('התשלום בקופה נכשל').category, 'checkout');
  assert.equal(analyze('השליח לא הגיע').category, 'delivery');
  assert.equal(analyze('המחירים יקרים').category, 'prices');
  assert.equal(analyze('האתר נתקע בטעינה').category, 'site');
  assert.equal(analyze('הנציג היה אדיב').category, 'service');
  assert.equal(analyze('סתם רציתי להגיד שלום').category, 'other');
  assert.equal(analyze('האתר נתקע בתשלום').category, 'checkout');
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test` → FAIL `Cannot find module '../src/analyze.js'`.

- [ ] **Step 3: Implement** — `simulation/src/analyze.js`:
```js
// Free, deterministic Hebrew keyword analysis. Not ML — good enough for a demo.
const NEGATIVE = [
  'לא טוב', 'לא נוח', 'לא עובד', 'לא הגיע', 'לא מצאתי', 'לא ברור',
  'גרוע', 'תקוע', 'נתקע', 'איטי', 'מתסכל', 'באג', 'שגיאה', 'נורא', 'בעיה',
  'מאכזב', 'קורס', 'מעצבן', 'יקר', 'יקרים', 'מסובך',
];
const POSITIVE = [
  'מעולה', 'מצוין', 'אהבתי', 'תודה', 'נוח', 'מהיר', 'קל', 'מושלם', 'כיף',
  'ממליץ', 'טוב', 'נהדר', 'אדיב', 'שמח',
];
const CATEGORIES = [
  ['checkout', ['תשלום', 'לשלם', 'קופה', 'אשראי', 'עגלה', 'סל הקניות']],
  ['delivery', ['משלוח', 'שליח', 'הגיע', 'איסוף', 'הזמנה']],
  ['prices', ['מחיר', 'יקר', 'מבצע', 'הנחה', 'זול']],
  ['site', ['אתר', 'באג', 'נתקע', 'תקוע', 'טעינה', 'כפתור', 'אפליקציה', 'חיפוש', 'שגיאה']],
  ['service', ['שירות', 'נציג', 'מוקד', 'תמיכה']],
];

// Up to two attached Hebrew prefix letters (ו, ה, ב, ל, מ, ש, כ), whole-word otherwise.
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = phrase => new RegExp(`(?<!\\p{L})[והבלמשכ]{0,2}${escape(phrase)}(?!\\p{L})`, 'gu');

export function analyze(text, rating = null) {
  let rest = String(text ?? '');
  const lower = rest;
  let score = 0;
  for (const p of NEGATIVE) {
    const re = wordRe(p);
    const n = (rest.match(re) || []).length;
    if (n) { score -= n; rest = rest.replace(re, ' '); }
  }
  for (const p of POSITIVE) score += (rest.match(wordRe(p)) || []).length;
  if (Number.isInteger(rating)) {
    if (rating <= 2) score -= 2;
    else if (rating >= 4) score += 2;
  }
  const sentiment = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
  const hit = CATEGORIES.find(([, words]) => words.some(w => lower.includes(w)));
  return { sentiment, category: hit ? hit[0] : 'other' };
}
```

- [ ] **Step 4: Run tests** — `npm test` → all pass.

---

### Task 3: HTTP API + server entry + scripts

**Files:**
- Create: `simulation/src/app.js`, `simulation/server.js`, `simulation/scripts/reset.js`, `simulation/scripts/capture.js`
- Test: `simulation/test/api.test.js`

**Interfaces:**
- Consumes: everything from Task 1 (`src/db.js`, `src/seed.js`) and Task 2 (`analyze`).
- Produces: `createApp({ db, audioDir: string, publicDir?: string }): express.Application`; HTTP routes exactly as in spec §5; `npm start`, `npm run reset`, `npm run capture [slug]`.

- [ ] **Step 1: Write the failing test** — `simulation/test/api.test.js`:
```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';

const KEY = 'test_key';
let server, base, audioDir, tmp;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sim-test-'));
  audioDir = join(tmp, 'audio');
  const db = openDb(join(tmp, 'test.db'));
  seed(db, [
    { slug: 'shufersal', name: 'שופרסל', url: 'https://www.shufersal.co.il/', industry: 'x', apiKey: KEY },
    { slug: 'other', name: 'אחר', url: 'https://example.co.il/', industry: 'x', apiKey: 'other_key' },
  ]);
  server = createApp({ db, audioDir }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); rmSync(tmp, { recursive: true, force: true }); });

const post = (body, key = KEY, raw = false) => fetch(`${base}/api/feedback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(key ? { 'X-API-Key': key } : {}) },
  body: raw ? body : JSON.stringify(body),
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
```

- [ ] **Step 2: Run to verify it fails** — `npm test` → FAIL `Cannot find module '../src/app.js'`.

- [ ] **Step 3: Implement** — `simulation/src/app.js`:
```js
import express from 'express';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { analyze } from './analyze.js';
import * as store from './db.js';

const MIME_EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
const MAX_TEXT = 5000;
const AUDIO_FILE = /^[0-9a-f-]{36}\.(webm|ogg|mp4|mp3|wav)$/;

export function createApp({ db, audioDir, publicDir }) {
  mkdirSync(audioDir, { recursive: true });
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const bad = (res, error, status = 400) => res.status(status).json({ error });

  app.get('/api/sites', (req, res) => res.json(store.listSites(db)));

  app.get('/api/sites/:slug/widget-config', (req, res) => {
    const apiKey = store.getApiKeyForSlug(db, req.params.slug);
    if (!apiKey) return bad(res, 'site not found', 404);
    res.json({ apiKey });
  });

  app.post('/api/feedback', (req, res) => {
    const product = store.findProductByApiKey(db, req.get('X-API-Key') || '');
    if (!product) return bad(res, 'invalid api key', 401);
    const b = req.body && typeof req.body === 'object' ? req.body : {};

    if (b.type !== 'text' && b.type !== 'voice') return bad(res, 'type must be text or voice');
    const content = typeof b.content === 'string' ? b.content.trim() : '';
    if (content.length > MAX_TEXT) return bad(res, `content longer than ${MAX_TEXT} characters`);
    if (b.type === 'text' && !content) return bad(res, 'content is required');

    let rating = null;
    if (b.rating !== undefined && b.rating !== null) {
      if (!Number.isInteger(b.rating) || b.rating < 1 || b.rating > 5) return bad(res, 'rating must be 1-5');
      rating = b.rating;
    }

    const id = randomUUID();
    let audioPath = null;
    if (b.type === 'voice') {
      if (typeof b.audioBase64 !== 'string' || !b.audioBase64) return bad(res, 'audio is required');
      const mime = String(b.audioMime || 'audio/webm').split(';')[0].trim().toLowerCase();
      const ext = MIME_EXT[mime];
      if (!ext) return bad(res, 'unsupported audio type');
      const buf = Buffer.from(b.audioBase64, 'base64');
      if (buf.length === 0) return bad(res, 'audio is empty');
      audioPath = `${id}.${ext}`;
      writeFileSync(join(audioDir, audioPath), buf);
    }

    const externalId = typeof b.endUserId === 'string' && b.endUserId.trim() ? b.endUserId.trim().slice(0, 100) : 'anonymous';
    const endUserId = store.getOrCreateEndUser(db, product.productId, externalId);
    const { sentiment, category } = analyze(content, rating);
    const fb = store.insertFeedback(db, {
      id, productId: product.productId, endUserId, type: b.type,
      content: content || null, audioPath,
      audioDurationMs: Number.isFinite(b.audioDurationMs) ? Math.round(b.audioDurationMs) : null,
      rating, sentiment, category,
      pageUrl: typeof b.pageUrl === 'string' ? b.pageUrl.slice(0, 500) : null,
    });
    res.status(201).json(fb);
  });

  app.get('/api/feedback', (req, res) => {
    const orgSlug = typeof req.query.org === 'string' && req.query.org ? req.query.org : null;
    res.json(store.listFeedback(db, { orgSlug }));
  });

  app.get('/api/stats', (req, res) => res.json(store.getStats(db)));

  app.get('/audio/:file', (req, res) => {
    const file = req.params.file;
    if (!AUDIO_FILE.test(file)) return bad(res, 'invalid file name');
    const path = resolve(join(audioDir, file));
    if (!existsSync(path)) return bad(res, 'not found', 404);
    res.sendFile(path);
  });

  if (publicDir) app.use(express.static(publicDir));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return bad(res, 'payload too large', 413);
    if (err.type === 'entity.parse.failed') return bad(res, 'invalid JSON');
    console.error(err);
    bad(res, 'internal error', 500);
  });

  return app;
}
```

`simulation/server.js`:
```js
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './src/db.js';
import { loadSites, seed } from './src/seed.js';
import { createApp } from './src/app.js';

const root = dirname(fileURLToPath(import.meta.url));
const db = openDb(join(root, 'data', 'test.db'));
seed(db, loadSites(join(root, 'sites.json')));

const app = createApp({ db, audioDir: join(root, 'data', 'audio'), publicDir: join(root, 'public') });
const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`Intent AI simulation → http://localhost:${port}`);
  console.log(`Dashboard          → http://localhost:${port}/dashboard.html`);
  console.log(`TEST DB            → ${join(root, 'data', 'test.db')}`);
});
```

`simulation/scripts/reset.js`:
```js
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { loadSites, seed } from '../src/seed.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
rmSync(dataDir, { recursive: true, force: true });
const db = openDb(join(dataDir, 'test.db'));
seed(db, loadSites(join(root, 'sites.json')));
db.close();
console.log('TEST DB reset:', join(dataDir, 'test.db'));
```

`simulation/scripts/capture.js`:
```js
// Full-page screenshot of each real site using the locally installed Edge (or Chrome), headless.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadSites } from '../src/seed.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'sites');
mkdirSync(outDir, { recursive: true });

const candidates = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
].filter(Boolean);
const browser = candidates.find(p => existsSync(p));
if (!browser) {
  console.error('Edge/Chrome not found. Set EDGE_PATH to the browser executable and retry.');
  process.exit(1);
}

const only = process.argv[2];
const sites = loadSites(join(root, 'sites.json')).filter(s => !only || s.slug === only);
let failed = 0;
for (const site of sites) {
  const out = join(outDir, `${site.slug}.png`);
  console.log(`Capturing ${site.name} (${site.url}) → ${out}`);
  try {
    execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      `--user-data-dir=${join(tmpdir(), 'intent-sim-capture')}`,
      '--lang=he-IL', '--window-size=1440,4000', '--virtual-time-budget=20000',
      `--screenshot=${out}`, site.url,
    ], { stdio: 'inherit', timeout: 120000 });
    if (!existsSync(out) || statSync(out).size === 0) throw new Error('no screenshot written');
    console.log('  ok');
  } catch (err) {
    failed++;
    console.error(`  failed: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 4: Run tests** — `npm test` → all pass (Tasks 1–3).

- [ ] **Step 5: Smoke run** — `npm run reset && npm start`, then `curl http://localhost:4000/api/sites` → JSON with שופרסל.

---

### Task 4: Front end — picker, site page, widget, dashboard

**Files:**
- Create: `simulation/public/demo.css`, `simulation/public/index.html`, `simulation/public/site.html`
- Create: `simulation/public/widget.js`, `simulation/public/widget.css`
- Create: `simulation/public/dashboard.html`
- Create: `simulation/README.md`

**Interfaces:**
- Consumes: `GET /api/sites`, `GET /api/sites/:slug/widget-config`, `POST /api/feedback`, `GET /api/feedback?org=`, `GET /api/stats`, `GET /audio/:file`, `/sites/<slug>.png`.
- Widget contract: `<script src="/widget.js" data-api-key="..." data-page-url="https://real-site/">`.

No automated tests for browser-only code (MediaRecorder/SpeechRecognition); verified manually in Step 3.

- [ ] **Step 1: Write the files** (full code lives in the files; summary of required behavior, each must hold):
  - `index.html`: fetches `/api/sites`, renders a card per site (thumbnail `/sites/<slug>.png` with text fallback), link to `site.html?s=<slug>`, link to dashboard. All user/DB strings rendered with `textContent`.
  - `site.html`: top bar "הדגמת Intent AI · <name> (צילום של האתר החי)" + back link + dashboard link; full-width screenshot; on `img.onerror` shows fallback explaining `npm run capture`; unknown slug shows "האתר לא נמצא"; injects widget script with `data-api-key` from widget-config and `data-page-url` = real site URL.
  - `widget.js`: IIFE; loads `/widget.css` from the script's origin; launcher bottom-left; panel RTL with tabs טקסט/קול; text tab = 5 star buttons + textarea (maxlength 5000) + send; voice tab = record/stop with timer, auto-stop at 120 s, MediaRecorder with first supported mime of `audio/webm;codecs=opus, audio/webm, audio/ogg;codecs=opus, audio/mp4`, live `he-IL` SpeechRecognition (continuous, interim, auto-restart while recording) into an editable transcript textarea, audio preview, re-record, send; base64 via FileReader; `endUserId` from `localStorage` key `iai_end_user` in try/catch with in-memory fallback; errors: mic denied → message suggesting text tab; no SpeechRecognition → note "התמלול לא נתמך בדפדפן הזה — ההקלטה תישמר בלי תמלול"; network/server failure → error message, draft kept; success → thank-you view with detected sentiment and "שליחת משוב נוסף".
  - `dashboard.html`: tabs "הכל" + one per site from `/api/stats`; summary cards (total, קול/טקסט, positive/neutral/negative, top category); table (date he-IL, type, content/transcript, `<audio controls preload="none">`, rating stars, sentiment badge, category label in Hebrew, page link); refresh button; auto-refresh every 10 s that skips re-render when data is unchanged or any audio is playing.
  - `README.md`: run steps (`npm install`, `npm run capture`, `npm start`), URLs, reset, where the TEST DB is, browser notes (Edge/Chrome for Hebrew transcription; transcription needs internet).

- [ ] **Step 2: Capture Shufersal** — `npm run capture` → `public/sites/shufersal.png` exists and is non-trivial (> 50 KB). If the site blocks headless capture, record that and confirm the fallback page renders.

- [ ] **Step 3: Manual end-to-end in Edge** — `npm start`, open `http://localhost:4000`:
  1. Picker shows Shufersal → open it; screenshot + launcher visible.
  2. Send text feedback with rating → thank-you with sentiment.
  3. Record ~5 s voice in Hebrew → transcript appears → send → thank-you.
  4. Dashboard shows both rows under שופרסל, audio plays.
  5. Verify rows directly: `node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/test.db');console.log(d.prepare('SELECT type,content,sentiment,category FROM feedback').all())"`.

- [ ] **Step 4: Final** — `npm test` all green; `git status` shows `data/`, `public/sites/`, `node_modules/` ignored.
