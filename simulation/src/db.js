// TEST DB layer — the only module that knows SQL.
// Simplified mirror of the product's Prisma models: Organization → Product → EndUser → Feedback.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  industry TEXT, created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1);
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
  sentiment TEXT, category TEXT, page_url TEXT, created_at TEXT NOT NULL,
  consent_version TEXT, consent_at TEXT,
  browser TEXT, os TEXT, device TEXT, language TEXT, time_zone TEXT, country TEXT, ip_hash TEXT);
CREATE INDEX IF NOT EXISTS idx_feedback_product ON feedback(product_id, created_at);
`;

const now = () => new Date().toISOString();

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // Wait briefly for locks instead of failing, and use WAL so readers (e.g. the Jupyter notebook)
  // never block the server's writes.
  db.exec('PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Bring DBs created by earlier versions up to the current schema.
export function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(organizations)').all().map(c => c.name);
  if (!cols.includes('active')) db.exec('ALTER TABLE organizations ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  const fcols = db.prepare('PRAGMA table_info(feedback)').all().map(c => c.name);
  if (!fcols.includes('consent_version')) db.exec('ALTER TABLE feedback ADD COLUMN consent_version TEXT');
  if (!fcols.includes('consent_at')) db.exec('ALTER TABLE feedback ADD COLUMN consent_at TEXT');
  for (const col of ['browser', 'os', 'device', 'language', 'time_zone', 'country', 'ip_hash']) {
    if (!fcols.includes(col)) db.exec(`ALTER TABLE feedback ADD COLUMN ${col} TEXT`);
  }
}

// Sites removed from sites.json are hidden (active = 0), never deleted: their feedback stays in the DB.
export function setActiveSites(db, slugs) {
  const list = [...slugs];
  const placeholders = list.map(() => '?').join(', ') || "''";
  db.prepare(`UPDATE organizations SET active = CASE WHEN slug IN (${placeholders}) THEN 1 ELSE 0 END`).run(...list);
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
    JOIN products p ON p.organization_id = o.id WHERE o.active = 1 ORDER BY o.created_at, o.rowid`).all().map(r => ({ ...r }));
}

export function getApiKeyForSlug(db, slug) {
  return db.prepare(`SELECT p.api_key AS apiKey FROM products p
    JOIN organizations o ON o.id = p.organization_id WHERE o.slug = ? AND o.active = 1`).get(slug)?.apiKey;
}

export function findProductByApiKey(db, apiKey) {
  return db.prepare(`SELECT p.id AS productId, p.name AS productName, p.url, o.id AS organizationId,
    o.slug, o.name AS organizationName FROM products p
    JOIN organizations o ON o.id = p.organization_id WHERE p.api_key = ? AND o.active = 1`).get(apiKey);
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
  f.created_at AS createdAt, f.consent_version AS consentVersion, f.consent_at AS consentAt,
  f.browser, f.os, f.device, f.language, f.time_zone AS timeZone, f.country, f.ip_hash AS ipHash, o.slug AS orgSlug, o.name AS orgName, e.external_id AS endUserId
  FROM feedback f
  JOIN products p ON p.id = f.product_id
  JOIN organizations o ON o.id = p.organization_id
  JOIN end_users e ON e.id = f.end_user_id`;

export function insertFeedback(db, f) {
  const id = f.id ?? randomUUID();
  db.prepare(`INSERT INTO feedback (id, product_id, end_user_id, type, content, audio_path,
    audio_duration_ms, rating, sentiment, category, page_url, created_at, consent_version, consent_at,
    browser, os, device, language, time_zone, country, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, f.productId, f.endUserId, f.type, f.content ?? null, f.audioPath ?? null,
      f.audioDurationMs ?? null, f.rating ?? null, f.sentiment ?? null, f.category ?? null,
      f.pageUrl ?? null, f.createdAt ?? now(), f.consentVersion ?? null, f.consentAt ?? null,
      f.browser ?? null, f.os ?? null, f.device ?? null, f.language ?? null, f.timeZone ?? null,
      f.country ?? null, f.ipHash ?? null);
  return { ...db.prepare(`${FEEDBACK_SELECT} WHERE f.id = ?`).get(id) };
}

export function listFeedback(db, { orgSlug = null } = {}) {
  return db.prepare(`${FEEDBACK_SELECT} WHERE o.active = 1 AND (? IS NULL OR o.slug = ?)
    ORDER BY f.created_at DESC, f.rowid DESC`).all(orgSlug, orgSlug).map(r => ({ ...r }));
}

export function getStats(db) {
  const rows = db.prepare(`SELECT o.slug, o.name,
      COUNT(f.id) AS total,
      COUNT(DISTINCT f.end_user_id) AS users,
      COALESCE(SUM(f.type = 'text'), 0) AS text,
      COALESCE(SUM(f.type = 'voice'), 0) AS voice,
      COALESCE(SUM(f.sentiment = 'positive'), 0) AS positive,
      COALESCE(SUM(f.sentiment = 'neutral'), 0) AS neutral,
      COALESCE(SUM(f.sentiment = 'negative'), 0) AS negative
    FROM organizations o
    JOIN products p ON p.organization_id = o.id
    LEFT JOIN feedback f ON f.product_id = p.id
    WHERE o.active = 1
    GROUP BY o.id ORDER BY o.created_at, o.rowid`).all();
  const cats = db.prepare(`SELECT o.slug, f.category, COUNT(*) AS n FROM feedback f
    JOIN products p ON p.id = f.product_id JOIN organizations o ON o.id = p.organization_id
    GROUP BY o.slug, f.category`).all();
  return rows.map(r => ({
    ...r,
    categories: Object.fromEntries(cats.filter(c => c.slug === r.slug).map(c => [c.category ?? 'other', c.n])),
  }));
}

// ---- Data-subject rights (GDPR Art. 15 / 17) ----

export function listFeedbackForEndUser(db, productId, externalId) {
  return db.prepare(`${FEEDBACK_SELECT} WHERE f.product_id = ? AND e.external_id = ?
    ORDER BY f.created_at DESC, f.rowid DESC`).all(productId, externalId).map(r => ({ ...r }));
}

export function deleteEndUserData(db, productId, externalId) {
  const user = db.prepare('SELECT id FROM end_users WHERE product_id = ? AND external_id = ?').get(productId, externalId);
  if (!user) return { deleted: 0, audioPaths: [] };
  const audioPaths = db.prepare('SELECT audio_path AS p FROM feedback WHERE end_user_id = ? AND audio_path IS NOT NULL')
    .all(user.id).map(r => r.p);
  const { changes } = db.prepare('DELETE FROM feedback WHERE end_user_id = ?').run(user.id);
  db.prepare('DELETE FROM end_users WHERE id = ?').run(user.id);
  return { deleted: Number(changes), audioPaths };
}

// ---- Retention ----

export function deleteFeedbackBefore(db, cutoffIso) {
  const audioPaths = db.prepare('SELECT audio_path AS p FROM feedback WHERE created_at < ? AND audio_path IS NOT NULL')
    .all(cutoffIso).map(r => r.p);
  const { changes } = db.prepare('DELETE FROM feedback WHERE created_at < ?').run(cutoffIso);
  return { deleted: Number(changes), audioPaths };
}
