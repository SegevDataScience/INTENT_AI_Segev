import express from 'express';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { analyze } from './analyze.js';
import * as store from './db.js';
import { CONSENT_VERSION, DEFAULT_RETENTION_DAYS, isValidConsent } from './consent.js';
import { removeAudioFiles } from './retention.js';
import { parseUserAgent, countryFrom, hashIp, cleanLocale, cleanTimeZone } from './identity.js';

const MIME_EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
const MAX_TEXT = 5000;
const AUDIO_FILE = /^[0-9a-f-]{36}\.(webm|ogg|mp4|mp3|wav)$/;

// Data minimisation: keep scheme + host + path only (no query strings, tokens or fragments).
function sanitizePageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return (u.origin + u.pathname).slice(0, 500);
  } catch {
    return null;
  }
}

const endUserIdFrom = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);

const FEEDBACK_LANGS = new Set(['he', 'en', 'ar']);
const isLoopback = a => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';

// shareMode: the server is reachable through a public tunnel link. Visitors may only use the widget;
// reading data (feedback, stats, recordings) requires adminToken. POSTs are rate-limited per visitor.
export function createApp({ db, audioDir, publicDir, retentionDays = DEFAULT_RETENTION_DAYS, ipHashSecret = null,
  shareMode = false, adminToken = null, rateLimit = { max: 20, windowMs: 10 * 60 * 1000 }, shareInfoPath = null }) {
  mkdirSync(audioDir, { recursive: true });
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const bad = (res, error, status = 400) => res.status(status).json({ error });

  // Real visitor IP: behind the local cloudflared tunnel the socket is loopback and Cloudflare sets CF-Connecting-IP.
  const clientIp = req => (shareMode && isLoopback(req.socket.remoteAddress) && req.get('CF-Connecting-IP')) || req.socket.remoteAddress;
  const isAdmin = req => !adminToken || req.get('X-Admin-Token') === adminToken || req.query.admin === adminToken;
  const requireAdmin = (req, res, next) => (isAdmin(req) ? next() : bad(res, 'admin token required', 401));

  const hits = new Map(); // visitor → recent POST timestamps (share mode only)
  const rateLimited = req => {
    if (!shareMode) return false;
    const key = clientIp(req) || 'unknown';
    const now = Date.now();
    const recent = (hits.get(key) || []).filter(t => now - t < rateLimit.windowMs);
    recent.push(now);
    hits.set(key, recent);
    return recent.length > rateLimit.max;
  };

  // Owner-only: the current public link + QR (written by scripts/share.js)
  app.get('/api/share-info', requireAdmin, (req, res) => {
    if (!shareInfoPath || !existsSync(shareInfoPath)) return bad(res, 'not sharing right now', 404);
    res.json(JSON.parse(readFileSync(shareInfoPath, 'utf8')));
  });

  app.get('/api/mode', (req, res) => res.json({ share: !!shareMode, admin: !!adminToken && isAdmin(req) }));

  app.get('/api/sites', (req, res) => res.json(store.listSites(db)));

  // What the widget must show and get agreement to before collecting anything.
  app.get('/api/consent', (req, res) => res.json({ version: CONSENT_VERSION, retentionDays }));

  // Local demo only: hands the product key to the demo page so it can embed the widget.
  app.get('/api/sites/:slug/widget-config', (req, res) => {
    const apiKey = store.getApiKeyForSlug(db, req.params.slug);
    if (!apiKey) return bad(res, 'site not found', 404);
    res.json({ apiKey });
  });

  app.post('/api/feedback', (req, res) => {
    if (rateLimited(req)) return bad(res, 'too many requests, try again later', 429);
    const product = store.findProductByApiKey(db, req.get('X-API-Key') || '');
    if (!product) return bad(res, 'invalid api key', 401);
    const b = req.body && typeof req.body === 'object' ? req.body : {};

    if (b.type !== 'text' && b.type !== 'voice') return bad(res, 'type must be text or voice');
    if (!isValidConsent(b.consent)) return bad(res, 'consent required: accept the current privacy notice first');
    const externalId = endUserIdFrom(b.endUserId);
    if (!externalId) return bad(res, 'endUserId is required');
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

    const endUserId = store.getOrCreateEndUser(db, product.productId, externalId);
    const { sentiment, category } = analyze(content, rating);
    // Author context for distinguishing distinct users (minimised: no raw IP, no full User-Agent).
    const locale = cleanLocale(b.locale) || cleanLocale(String(req.get('Accept-Language') || '').split(',')[0].trim());
    const timeZone = cleanTimeZone(b.timeZone);
    const device = parseUserAgent(req.get('User-Agent'));
    const fb = store.insertFeedback(db, {
      id, productId: product.productId, endUserId, type: b.type,
      content: content || null, audioPath,
      audioDurationMs: Number.isFinite(b.audioDurationMs) ? Math.round(b.audioDurationMs) : null,
      rating, sentiment, category,
      pageUrl: sanitizePageUrl(b.pageUrl),
      consentVersion: CONSENT_VERSION, consentAt: new Date().toISOString(),
      ...device, language: locale, timeZone, country: countryFrom({ timeZone, locale }),
      ipHash: hashIp(clientIp(req), ipHashSecret),
      feedbackLang: FEEDBACK_LANGS.has(b.lang) ? b.lang : null,
    });
    res.status(201).json(fb);
  });

  // ---- Data-subject rights for the end user (export / delete), scoped to one site ----
  function dsrContext(req, res) {
    const product = store.findProductByApiKey(db, req.get('X-API-Key') || '');
    if (!product) { bad(res, 'invalid api key', 401); return null; }
    const externalId = endUserIdFrom(req.get('X-End-User-Id'));
    if (!externalId) { bad(res, 'X-End-User-Id header is required'); return null; }
    return { product, externalId };
  }

  app.get('/api/my-data', (req, res) => {
    const ctx = dsrContext(req, res);
    if (!ctx) return;
    res.json({
      site: ctx.product.organizationName,
      endUserId: ctx.externalId,
      exportedAt: new Date().toISOString(),
      retentionDays,
      feedback: store.listFeedbackForEndUser(db, ctx.product.productId, ctx.externalId),
    });
  });

  app.delete('/api/my-data', (req, res) => {
    const ctx = dsrContext(req, res);
    if (!ctx) return;
    const { deleted, audioPaths } = store.deleteEndUserData(db, ctx.product.productId, ctx.externalId);
    removeAudioFiles(audioDir, audioPaths);
    res.json({ deleted });
  });

  app.get('/api/feedback', requireAdmin, (req, res) => {
    const orgSlug = typeof req.query.org === 'string' && req.query.org ? req.query.org : null;
    res.json(store.listFeedback(db, { orgSlug }));
  });

  app.get('/api/stats', requireAdmin, (req, res) => res.json(store.getStats(db)));

  app.get('/audio/:file', requireAdmin, (req, res) => {
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
