// Coarse author context for telling distinct feedback authors apart, with data minimisation:
// only browser / OS / device class, language, time zone (→ country) and a keyed one-way IP hash
// are kept — never the full User-Agent string or the raw IP address.
import { createHmac } from 'node:crypto';

export function parseUserAgent(ua = '') {
  const s = String(ua);
  const headless = /HeadlessChrome/.test(s);
  let browser = 'Other';
  if (/Edg(e|A|iOS)?\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/SamsungBrowser\//.test(s)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS\//.test(s)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\/|HeadlessChrome\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = 'Safari';
  if (headless && browser !== 'Other') browser += ' (headless)';

  let os = 'Other';
  if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/Windows NT/.test(s)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
  else if (/Linux|X11/.test(s)) os = 'Linux';

  let device = 'desktop';
  if (/iPad|Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s))) device = 'tablet';
  else if (/Mobile|iPhone|iPod/.test(s)) device = 'mobile';

  return { browser, os, device };
}

const LOCALE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;
const TZ_RE = /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2}$/;

export const cleanLocale = v => (typeof v === 'string' && v.length <= 35 && LOCALE_RE.test(v) ? v : null);
export const cleanTimeZone = v => (typeof v === 'string' && v.length <= 64 && TZ_RE.test(v) ? v : null);

// Small, explicit map — enough to place demo traffic; unknown zones fall back to the locale region.
const TZ_COUNTRY = {
  'Asia/Jerusalem': 'IL', 'Asia/Tel_Aviv': 'IL', 'Europe/London': 'GB', 'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL',
  'Europe/Kiev': 'UA', 'Europe/Kyiv': 'UA', 'Europe/Moscow': 'RU', 'America/New_York': 'US',
  'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Toronto': 'CA',
  'America/Sao_Paulo': 'BR', 'Asia/Dubai': 'AE', 'Asia/Kolkata': 'IN', 'Asia/Tokyo': 'JP',
  'Australia/Sydney': 'AU',
};

export function countryFrom({ timeZone, locale } = {}) {
  const tz = cleanTimeZone(timeZone);
  if (tz && TZ_COUNTRY[tz]) return TZ_COUNTRY[tz];
  const loc = cleanLocale(locale);
  const region = loc && loc.split('-').find((part, i) => i > 0 && /^[A-Za-z]{2}$/.test(part));
  return region ? region.toUpperCase() : null;
}

// Keyed (HMAC-SHA256) so the hash cannot be reversed by hashing all IPv4 addresses without the key.
export function hashIp(ip, secret) {
  if (!ip || !secret) return null;
  const normalised = String(ip).replace(/^::ffff:/, '');
  return createHmac('sha256', secret).update(normalised).digest('hex').slice(0, 16);
}
