// Static (GitHub Pages) stand-in for the simulation server.
// Intercepts fetch('/api/...') and answers from: synthetic seed data (data/seed.json) + feedback this
// visitor sends, which is stored ONLY in this browser (localStorage). Nothing is sent anywhere.
import { analyze } from './analyze.js';

const STORE_KEY = 'iai_static_feedback_v1';
const realFetch = window.fetch.bind(window);
const seedPromise = realFetch(new URL('data/seed.json', import.meta.url)).then(r => r.json());

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const bad = (error, status = 400) => json({ error }, status);
const loadLocal = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } };
const saveLocal = list => { try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; } catch { return false; } };
const strip = ({ audioData, audioMime, ...rest }) => rest; // never return raw audio in API payloads

function parseUserAgent(ua = '') {
  let browser = 'Other';
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari';
  if (/HeadlessChrome/.test(ua) && browser !== 'Other') browser += ' (headless)';
  let os = 'Other';
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux|X11/.test(ua)) os = 'Linux';
  let device = 'desktop';
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) device = 'tablet';
  else if (/Mobile|iPhone|iPod/.test(ua)) device = 'mobile';
  return { browser, os, device };
}
const TZ_COUNTRY = { 'Asia/Jerusalem': 'IL', 'Asia/Tel_Aviv': 'IL', 'Europe/London': 'GB', 'America/New_York': 'US', 'America/Los_Angeles': 'US', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE' };
const countryFrom = (tz, locale) => TZ_COUNTRY[tz] || ((locale || '').split('-').find((p, i) => i > 0 && /^[A-Za-z]{2}$/.test(p)) || '').toUpperCase() || null;

async function allFeedback() {
  const seed = await seedPromise;
  return [...loadLocal().map(strip), ...seed.feedback].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function stats(sites, rows) {
  return sites.map(s => {
    const mine = rows.filter(f => f.orgSlug === s.slug);
    const count = pred => mine.filter(pred).length;
    const categories = {};
    for (const f of mine) categories[f.category || 'other'] = (categories[f.category || 'other'] || 0) + 1;
    return {
      slug: s.slug, name: s.name, total: mine.length, users: new Set(mine.map(f => f.endUserId)).size,
      text: count(f => f.type === 'text'), voice: count(f => f.type === 'voice'),
      positive: count(f => f.sentiment === 'positive'), neutral: count(f => f.sentiment === 'neutral'),
      negative: count(f => f.sentiment === 'negative'), categories,
      mobile: count(f => f.device === 'mobile'), tablet: count(f => f.device === 'tablet'),
      desktop: count(f => f.device === 'desktop'), shared: count(f => f.channel === 'shared'),
    };
  });
}

const header = (init, name) => {
  const h = init.headers || {};
  if (h instanceof Headers) return h.get(name);
  const k = Object.keys(h).find(x => x.toLowerCase() === name.toLowerCase());
  return k ? h[k] : null;
};

async function handle(route, url, init) {
  const seed = await seedPromise;
  const method = (init.method || 'GET').toUpperCase();
  const siteByKey = key => seed.sites.find(s => seed.apiKeys[s.slug] === key);

  if (route === '/api/sites' && method === 'GET') return json(seed.sites);
  if (route === '/api/mode' && method === 'GET') return json({ share: false, admin: false });
  let m = /^\/api\/sites\/([^/]+)\/widget-config$/.exec(route);
  if (m && method === 'GET') return seed.apiKeys[m[1]] ? json({ apiKey: seed.apiKeys[m[1]] }) : bad('site not found', 404);
  if (route === '/api/consent' && method === 'GET') return json(seed.consent);
  if (route === '/api/stats' && method === 'GET') return json(stats(seed.sites, await allFeedback()));
  if (route === '/api/feedback' && method === 'GET') {
    const org = url.searchParams.get('org');
    return json((await allFeedback()).filter(f => !org || f.orgSlug === org));
  }

  if (route === '/api/feedback' && method === 'POST') {
    const site = siteByKey(header(init, 'X-API-Key'));
    if (!site) return bad('invalid api key', 401);
    let b;
    try { b = JSON.parse(init.body || '{}'); } catch { return bad('invalid JSON'); }
    if (b.type !== 'text' && b.type !== 'voice') return bad('type must be text or voice');
    if (!b.consent || b.consent.given !== true || b.consent.version !== seed.consent.version) return bad('consent required: accept the current privacy notice first');
    const endUserId = typeof b.endUserId === 'string' && b.endUserId.trim() ? b.endUserId.trim().slice(0, 100) : null;
    if (!endUserId) return bad('endUserId is required');
    const content = typeof b.content === 'string' ? b.content.trim().slice(0, 5000) : '';
    if (b.type === 'text' && !content) return bad('content is required');
    if (b.type === 'voice' && !b.audioBase64) return bad('audio is required');
    const rating = Number.isInteger(b.rating) && b.rating >= 1 && b.rating <= 5 ? b.rating : null;
    const { sentiment, category } = analyze(content, rating);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const mime = String(b.audioMime || 'audio/webm').split(';')[0];
    const item = {
      id, type: b.type, content: content || null, rating, sentiment, category,
      audioPath: b.type === 'voice' ? `local-${id}.${mime.split('/')[1] || 'webm'}` : null,
      audioDurationMs: Number.isFinite(b.audioDurationMs) ? Math.round(b.audioDurationMs) : null,
      pageUrl: site.url, createdAt: now, consentVersion: seed.consent.version, consentAt: now,
      orgSlug: site.slug, orgName: site.name, endUserId, ...parseUserAgent(navigator.userAgent),
      language: typeof b.locale === 'string' ? b.locale.slice(0, 35) : null,
      timeZone: typeof b.timeZone === 'string' ? b.timeZone.slice(0, 64) : null,
      country: countryFrom(b.timeZone, b.locale), ipHash: null, // a static site never sees the visitor's IP
      feedbackLang: ['he', 'en', 'ar'].includes(b.lang) ? b.lang : null, channel: 'local',
      audioData: b.type === 'voice' ? b.audioBase64 : undefined, audioMime: b.type === 'voice' ? mime : undefined,
    };
    const list = loadLocal();
    list.unshift(item);
    if (!saveLocal(list)) { // storage full → keep the feedback, drop the recording
      delete item.audioData;
      saveLocal(list);
    }
    return json(strip(item), 201);
  }

  if (route === '/api/my-data') {
    const site = siteByKey(header(init, 'X-API-Key'));
    if (!site) return bad('invalid api key', 401);
    const user = header(init, 'X-End-User-Id');
    if (!user) return bad('X-End-User-Id header is required');
    const local = loadLocal();
    const mine = f => f.orgSlug === site.slug && f.endUserId === user;
    if (method === 'GET') {
      return json({ site: site.name, endUserId: user, exportedAt: new Date().toISOString(), retentionDays: seed.consent.retentionDays, feedback: local.filter(mine).map(strip) });
    }
    if (method === 'DELETE') {
      const keep = local.filter(f => !mine(f));
      saveLocal(keep);
      return json({ deleted: local.length - keep.length });
    }
  }
  return bad('not found', 404);
}

window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const at = url.pathname.indexOf('/api/');
  if (url.origin !== location.origin || at === -1) return realFetch(input, init);
  return handle(url.pathname.slice(at), url, init);
};

// Audio: demo recordings are static files; recordings made in this browser are served from storage.
window.audioUrl = path => {
  const item = loadLocal().find(f => f.audioPath === path);
  if (item && item.audioData) return `data:${item.audioMime || 'audio/webm'};base64,${item.audioData}`;
  return new URL(`audio/${encodeURIComponent(path)}`, import.meta.url).href;
};

// A visible note that this is the static demo.
window.addEventListener('DOMContentLoaded', () => {
  const bar = document.querySelector('.demo-bar');
  if (!bar) return;
  const note = document.createElement('div');
  note.className = 'static-note';
  note.textContent = 'גרסת דמו סטטית · נתונים סינתטיים · משוב שתשלחו נשמר רק בדפדפן שלכם';
  bar.after(note);
});
