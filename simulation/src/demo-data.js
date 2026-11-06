// Synthetic, deterministic demo feedback — safe to publish (no real people, fictional sites).
// Used for the public live demo (GitHub Pages) and for the notebook outputs shown on GitHub.
import { analyze } from './analyze.js';
import { CONSENT_VERSION } from './consent.js';
import * as store from './db.js';

// Small seeded PRNG (mulberry32) so the same seed always yields the same dataset.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const weighted = (r, pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of pairs) { if ((x -= w) < 0) return v; }
  return pairs[pairs.length - 1][0];
};

// Feedback phrases per industry (keyed by the site's position, so any 5-site list works).
const PHRASES = [
  ['המשלוח הגיע מהר והכל היה טרי, תודה', 'האתר נתקע בתשלום, ממש מתסכל', 'המחירים יקרים לעומת הסניף', 'אהבתי את המבצעים השבוע',
    'השליח לא הגיע בזמן שנקבע', 'החיפוש באתר לא נוח, לא מצאתי חלב', 'שירות מעולה מהנציג בצ׳אט', 'סל הקניות התרוקן לבד באמצע'],
  ['הטיסה התעכבה שלוש שעות בלי הסבר', 'הצ׳ק אין באפליקציה היה מהיר ונוח', 'המזוודה לא הגיעה ליעד', 'הדיילים היו אדיבים מאוד',
    'מחיר הכרטיס יקר מדי', 'לא מצאתי איך לשנות מושב', 'המראה בזמן ונחיתה רכה, מעולה', 'התשלום בכרטיס אשראי נכשל פעמיים'],
  ['יותר מדי פרסומות בכתבה', 'כתבה מעולה ומעמיקה, תודה', 'האתר איטי בטעינה בטלפון', 'הכותרת לא תאמה את התוכן',
    'אהבתי את הניוזלטר החדש', 'מודעה קופצת שאי אפשר לסגור', 'החיפוש לא מוצא כתבות ישנות', 'עדכונים מהירים, ממש נוח'],
  ['המרשם לא היה מוכן בבית המרקחת', 'הרוקחת הסבירה הכל בסבלנות, תודה', 'המשלוח של התרופות הגיע מהר', 'המחיר של הוויטמינים יקר',
    'האפליקציה נתקעת בהזמנה', 'מבצע מעולה על מוצרי טיפוח', 'לא מצאתי את המוצר בחיפוש', 'שירות לקוחות לא חזר אליי'],
  ['אין קליטה בבית כבר שבוע', 'האינטרנט בסיבים מהיר מאוד, מרוצה', 'חייבו אותי פעמיים בחשבונית', 'הנציג פתר את הבעיה מהר',
    'הראוטר החדש מתנתק כל ערב', 'המחיר עלה בלי הודעה', 'התמיכה הטכנית אדיבה ומקצועית', 'גלישה בחו״ל עבדה מעולה'],
];

const DEVICES = [
  [{ browser: 'Chrome', os: 'Android', device: 'mobile' }, 30],
  [{ browser: 'Safari', os: 'iOS', device: 'mobile' }, 24],
  [{ browser: 'Chrome', os: 'Windows', device: 'desktop' }, 20],
  [{ browser: 'Edge', os: 'Windows', device: 'desktop' }, 10],
  [{ browser: 'Safari', os: 'macOS', device: 'desktop' }, 7],
  [{ browser: 'Firefox', os: 'Windows', device: 'desktop' }, 4],
  [{ browser: 'Samsung Internet', os: 'Android', device: 'mobile' }, 3],
  [{ browser: 'Safari', os: 'iOS', device: 'tablet' }, 2],
];
const LOCALES = [
  [{ language: 'he-IL', timeZone: 'Asia/Jerusalem', country: 'IL' }, 82],
  [{ language: 'en-US', timeZone: 'Asia/Jerusalem', country: 'IL' }, 8],
  [{ language: 'ru-RU', timeZone: 'Asia/Jerusalem', country: 'IL' }, 5],
  [{ language: 'en-US', timeZone: 'America/New_York', country: 'US' }, 3],
  [{ language: 'en-GB', timeZone: 'Europe/London', country: 'GB' }, 2],
];
// Israel-time hour weights (busier at lunch and evening)
const HOURS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
  .map(h => [h, [1, 0.5, 0.3, 0.2, 0.2, 0.4, 1, 2, 3, 4, 4, 5, 7, 7, 5, 4, 4, 5, 6, 7, 9, 9, 7, 3][h]]);
const SITE_WEIGHT = [32, 22, 18, 14, 14];
// Voice rows use the first two phrases of each site, which have matching synthesized recordings.
export const voiceFileFor = (siteIndex, phraseIndex) => `demo-voice-${siteIndex + 1}-${phraseIndex + 1}.wav`;
export const VOICE_PHRASES = PHRASES.map(list => list.slice(0, 2));
const hex = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
const uuid = r => `${hex(r, 8)}-${hex(r, 4)}-4${hex(r, 3)}-${hex(r, 4)}-${hex(r, 12)}`;

export function generateDemoFeedback(sites, { seed = 7, now = Date.now(), count = 180, users = 55, days = 14 } = {}) {
  const r = rng(seed);
  const people = Array.from({ length: users }, () => ({
    endUserId: uuid(r), ...weighted(r, DEVICES), ...weighted(r, LOCALES), ipHash: hex(r, 16),
  }));
  const rows = [];
  for (let i = 0; i < count; i++) {
    const siteIndex = weighted(r, sites.map((_, k) => [k, SITE_WEIGHT[k] ?? 10]));
    const site = sites[siteIndex];
    // a few loyal users write often, most write once or twice
    const person = people[Math.floor(Math.pow(r(), 1.6) * people.length)];
    const dayAgo = Math.floor(r() * days);
    const hourIL = weighted(r, HOURS);
    const d = new Date(now - dayAgo * 86400000);
    // Israel is UTC+2 in November
    let created = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourIL - 2, Math.floor(r() * 60), Math.floor(r() * 60));
    if (created > now) created -= 86400000;
    const phrases = PHRASES[siteIndex % PHRASES.length];
    const isVoice = r() < 0.28;
    const phraseIndex = isVoice ? Math.floor(r() * 2) : Math.floor(r() * phrases.length);
    const content = phrases[phraseIndex];
    // rating (when given) is consistent with what the text says
    const textSentiment = analyze(content).sentiment;
    const ratingFor = { positive: [4, 5], neutral: [3, 3], negative: [1, 2] }[textSentiment];
    const rating = isVoice || r() < 0.6 ? null : ratingFor[Math.floor(r() * ratingFor.length)];
    const { sentiment, category } = analyze(content, rating);
    rows.push({
      siteSlug: site.slug, apiKey: site.apiKey, type: isVoice ? 'voice' : 'text', content,
      audioPath: isVoice ? voiceFileFor(siteIndex % PHRASES.length, phraseIndex) : null, audioDurationMs: isVoice ? 3000 + Math.floor(r() * 6000) : null,
      rating, sentiment, category, pageUrl: site.url, createdAt: new Date(created).toISOString(),
      endUserId: person.endUserId, browser: person.browser, os: person.os, device: person.device,
      language: person.language, timeZone: person.timeZone, country: person.country, ipHash: person.ipHash,
    });
  }
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Writes the synthetic rows into a TEST DB that already has the sites seeded. Returns the row count.
export function seedDemo(db, sites, opts = {}) {
  const rows = generateDemoFeedback(sites, opts);
  for (const row of rows) {
    const product = store.findProductByApiKey(db, row.apiKey);
    if (!product) throw new Error(`site ${row.siteSlug} is not seeded in this DB`);
    const endUserId = store.getOrCreateEndUser(db, product.productId, row.endUserId);
    store.insertFeedback(db, {
      ...row, productId: product.productId, endUserId,
      consentVersion: CONSENT_VERSION, consentAt: row.createdAt,
    });
  }
  return rows.length;
}
