// Intent AI demo — always-on cloud backend (Cloudflare Worker + D1).
// Same API as presentation/simulation/src/app.js, so the same pages and widget work unchanged.
// It always behaves like "share mode": visitors may only use the widget; reading data needs ADMIN_TOKEN.
import { analyze } from '../../simulation/src/analyze.js';
import { CONSENT_VERSION, DEFAULT_RETENTION_DAYS, isValidConsent } from '../../simulation/src/consent.js';
import { parseUserAgent, countryFrom, hashIp, cleanLocale, cleanTimeZone } from '../../simulation/src/identity.js';
import SITES from '../../simulation/sites.json';
import QRCode from 'qrcode';

const MAX_TEXT = 5000;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MIME_EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
const AUDIO_FILE = /^[0-9a-f-]{36}\.(webm|ogg|mp4|mp3|wav)$/;
const FEEDBACK_LANGS = new Set(['he', 'en', 'ar']);
const RATE = { max: 20, windowMs: 10 * 60 * 1000 };

const SITE_BY_SLUG = Object.fromEntries(SITES.map(s => [s.slug, s]));
const SITE_BY_KEY = Object.fromEntries(SITES.map(s => [s.apiKey, s]));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const bad = (error, status = 400) => json({ error }, status);

function sanitizePageUrl(value) {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? (u.origin + u.pathname).slice(0, 500) : null; } catch { return null; }
}
const endUserIdFrom = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);

// D1 row → the same shape the local server returns
const rowToFeedback = r => ({
  id: r.id, type: r.type, content: r.content, audioPath: r.audio_path, audioDurationMs: r.audio_duration_ms,
  rating: r.rating, sentiment: r.sentiment, category: r.category, pageUrl: r.page_url, createdAt: r.created_at,
  consentVersion: r.consent_version, consentAt: r.consent_at, browser: r.browser, os: r.os, device: r.device,
  language: r.language, timeZone: r.time_zone, country: r.country, ipHash: r.ip_hash, feedbackLang: r.feedback_lang,
  channel: r.channel, orgSlug: r.site, orgName: SITE_BY_SLUG[r.site]?.name ?? r.site, endUserId: r.end_user_id,
});

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function purgeExpired(env) {
  const cutoff = new Date(Date.now() - DEFAULT_RETENTION_DAYS * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM audio WHERE created_at < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM feedback WHERE created_at < ?').bind(cutoff),
  ]);
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  const admin = !!env.ADMIN_TOKEN && (request.headers.get('X-Admin-Token') === env.ADMIN_TOKEN || url.searchParams.get('admin') === env.ADMIN_TOKEN);
  const ip = request.headers.get('CF-Connecting-IP') || '';

  if (path === '/api/sites' && method === 'GET') return json(SITES.map(({ slug, name, industry, url: u }) => ({ slug, name, industry, url: u })));
  let m = /^\/api\/sites\/([^/]+)\/widget-config$/.exec(path);
  if (m && method === 'GET') return SITE_BY_SLUG[m[1]] ? json({ apiKey: SITE_BY_SLUG[m[1]].apiKey }) : bad('site not found', 404);
  if (path === '/api/consent' && method === 'GET') return json({ version: CONSENT_VERSION, retentionDays: DEFAULT_RETENTION_DAYS });
  if (path === '/api/mode' && method === 'GET') return json({ share: true, admin });

  if (path === '/api/feedback' && method === 'POST') {
    const site = SITE_BY_KEY[request.headers.get('X-API-Key') || ''];
    if (!site) return bad('invalid api key', 401);
    const ipHash = await hashIp(ip, env.IP_SECRET || 'unset');
    if (ipHash) {
      const since = new Date(Date.now() - RATE.windowMs).toISOString();
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE ip_hash = ? AND created_at > ?').bind(ipHash, since).first();
      if (n >= RATE.max) return bad('too many requests, try again later', 429);
    }
    let b;
    try { b = await request.json(); } catch { return bad('invalid JSON'); }
    if (!b || typeof b !== 'object') return bad('invalid JSON');
    if (b.type !== 'text' && b.type !== 'voice') return bad('type must be text or voice');
    if (!isValidConsent(b.consent)) return bad('consent required: accept the current privacy notice first');
    const externalId = endUserIdFrom(b.endUserId);
    if (!externalId) return bad('endUserId is required');
    const content = typeof b.content === 'string' ? b.content.trim() : '';
    if (content.length > MAX_TEXT) return bad(`content longer than ${MAX_TEXT} characters`);
    if (b.type === 'text' && !content) return bad('content is required');
    let rating = null;
    if (b.rating !== undefined && b.rating !== null) {
      if (!Number.isInteger(b.rating) || b.rating < 1 || b.rating > 5) return bad('rating must be 1-5');
      rating = b.rating;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const statements = [];
    let audioPath = null;
    if (b.type === 'voice') {
      if (typeof b.audioBase64 !== 'string' || !b.audioBase64) return bad('audio is required');
      const mime = String(b.audioMime || 'audio/webm').split(';')[0].trim().toLowerCase();
      const ext = MIME_EXT[mime];
      if (!ext) return bad('unsupported audio type');
      let bytes;
      try { bytes = b64ToBytes(b.audioBase64); } catch { return bad('audio is not valid base64'); }
      if (!bytes.length) return bad('audio is empty');
      if (bytes.length > MAX_AUDIO_BYTES) return bad('recording too large (max 2 MB, about 2 minutes)', 413);
      audioPath = `${id}.${ext}`;
      statements.push(env.DB.prepare('INSERT INTO audio (path, mime, data, created_at) VALUES (?, ?, ?, ?)').bind(audioPath, mime, bytes, now));
    }
    const locale = cleanLocale(b.locale) || cleanLocale(String(request.headers.get('Accept-Language') || '').split(',')[0].trim());
    const timeZone = cleanTimeZone(b.timeZone);
    const device = parseUserAgent(request.headers.get('User-Agent') || '');
    const { sentiment, category } = analyze(content, rating);
    const country = request.cf?.country || countryFrom({ timeZone, locale }); // Cloudflare knows the visitor's country
    const row = {
      id, site: site.slug, type: b.type, content: content || null, audio_path: audioPath,
      audio_duration_ms: Number.isFinite(b.audioDurationMs) ? Math.round(b.audioDurationMs) : null,
      rating, sentiment, category, page_url: sanitizePageUrl(b.pageUrl), end_user_id: externalId,
      browser: device.browser, os: device.os, device: device.device, language: locale, time_zone: timeZone, country,
      ip_hash: ipHash, feedback_lang: FEEDBACK_LANGS.has(b.lang) ? b.lang : null, channel: 'cloud',
      consent_version: CONSENT_VERSION, consent_at: now, created_at: now,
    };
    const cols = Object.keys(row);
    statements.push(env.DB.prepare(`INSERT INTO feedback (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map(c => row[c])));
    await env.DB.batch(statements);
    return json(rowToFeedback(row), 201);
  }

  if (path === '/api/my-data') {
    const site = SITE_BY_KEY[request.headers.get('X-API-Key') || ''];
    if (!site) return bad('invalid api key', 401);
    const user = endUserIdFrom(request.headers.get('X-End-User-Id'));
    if (!user) return bad('X-End-User-Id header is required');
    if (method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM feedback WHERE site = ? AND end_user_id = ? ORDER BY created_at DESC').bind(site.slug, user).all();
      return json({ site: site.name, endUserId: user, exportedAt: new Date().toISOString(), retentionDays: DEFAULT_RETENTION_DAYS, feedback: results.map(rowToFeedback) });
    }
    if (method === 'DELETE') {
      const res = await env.DB.batch([
        env.DB.prepare('DELETE FROM audio WHERE path IN (SELECT audio_path FROM feedback WHERE site = ? AND end_user_id = ? AND audio_path IS NOT NULL)').bind(site.slug, user),
        env.DB.prepare('DELETE FROM feedback WHERE site = ? AND end_user_id = ?').bind(site.slug, user),
      ]);
      return json({ deleted: res[1].meta.changes });
    }
  }

  // ---- owner-only ----
  if (!admin && ['/api/feedback', '/api/stats', '/api/share-info'].includes(path)) return bad('admin token required', 401);
  if (path === '/api/feedback' && method === 'GET') {
    const org = url.searchParams.get('org');
    const stmt = org
      ? env.DB.prepare('SELECT * FROM feedback WHERE site = ? ORDER BY created_at DESC LIMIT 2000').bind(org)
      : env.DB.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 2000');
    const { results } = await stmt.all();
    return json(results.map(rowToFeedback));
  }
  if (path === '/api/stats' && method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT site,
        COUNT(*) AS total, COUNT(DISTINCT end_user_id) AS users,
        SUM(type = 'text') AS text, SUM(type = 'voice') AS voice,
        SUM(sentiment = 'positive') AS positive, SUM(sentiment = 'neutral') AS neutral, SUM(sentiment = 'negative') AS negative,
        SUM(device = 'mobile') AS mobile, SUM(device = 'tablet') AS tablet, SUM(device = 'desktop') AS desktop,
        SUM(channel IN ('shared', 'cloud')) AS shared
      FROM feedback GROUP BY site`).all();
    const cats = (await env.DB.prepare('SELECT site, category, COUNT(*) AS n FROM feedback GROUP BY site, category').all()).results;
    const bySite = Object.fromEntries(results.map(r => [r.site, r]));
    const zero = { total: 0, users: 0, text: 0, voice: 0, positive: 0, neutral: 0, negative: 0, mobile: 0, tablet: 0, desktop: 0, shared: 0 };
    return json(SITES.map(s => ({
      slug: s.slug, name: s.name, ...zero, ...(bySite[s.slug] || {}),
      categories: Object.fromEntries(cats.filter(c => c.site === s.slug).map(c => [c.category ?? 'other', c.n])),
    })));
  }
  if (path === '/api/share-info' && method === 'GET') {
    const visitorUrl = url.origin + '/';
    const svg = await QRCode.toString(visitorUrl, { type: 'svg', margin: 1, color: { dark: '#14122b', light: '#ffffff' } });
    return json({ visitorUrl, qr: 'data:image/svg+xml;base64,' + btoa(svg), permanent: true });
  }

  return bad('not found', 404);
}

async function handleAudio(request, env, url) {
  const admin = !!env.ADMIN_TOKEN && (request.headers.get('X-Admin-Token') === env.ADMIN_TOKEN || url.searchParams.get('admin') === env.ADMIN_TOKEN);
  if (!admin) return bad('admin token required', 401);
  const file = decodeURIComponent(url.pathname.slice('/audio/'.length));
  if (!AUDIO_FILE.test(file)) return bad('invalid file name');
  const row = await env.DB.prepare('SELECT mime, data FROM audio WHERE path = ?').bind(file).first();
  if (!row) return bad('not found', 404);
  return new Response(new Uint8Array(row.data), { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, no-store' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      if (url.pathname.startsWith('/audio/')) return await handleAudio(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return bad('internal error', 500);
    }
  },
  async scheduled(_event, env) {
    await purgeExpired(env);
  },
};
