// Builds cloud/dist: the simulation's pages + widget + real-site screenshots, worded for the always-on link.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, readdirSync } from 'node:fs';

const CLOUD = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIM = join(CLOUD, '..', 'simulation');
const OUT = join(CLOUD, 'dist');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

cpSync(join(SIM, 'public'), OUT, { recursive: true }); // pages, widget, css, sites/*.png (real screenshots, local only)
const shots = existsSync(join(OUT, 'sites')) ? readdirSync(join(OUT, 'sites')).filter(f => f.endsWith('.png')) : [];
if (!shots.length) console.warn('WARNING: no site screenshots found — run `npm run capture` in ../simulation first.');

const edit = (file, pairs) => {
  const p = join(OUT, file);
  let s = readFileSync(p, 'utf8');
  for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(`${file}: text not found: ${a.slice(0, 60)}`); s = s.replace(a, b); }
  writeFileSync(p, s);
};
// The share page in the cloud describes a permanent link (no local window to keep open).
edit('share.html', [
  ['⏱️ הקישור עובד כל עוד חלון השיתוף פתוח. כשסוגרים אותו, הקישור מפסיק לעבוד והנתונים נשארים אצלך. בכל הפעלה נוצר קישור חדש.<br>',
   '🌐 זה קישור <strong>קבוע</strong> שעובד 24/7, גם כשהמחשב שלך כבוי. המשובים נשמרים בענן (Cloudflare D1), ונמחקים אוטומטית אחרי 90 יום.<br>'],
  ['המשוב שלו נשמר כאן, במחשב שלך, ומופיע בדשבורד.', 'המשוב שלו נשמר בענן ומופיע בדשבורד שלך, מכל מכשיר.'],
]);
edit('privacy.html', [
  ['הנתונים נשמרים בקובץ מקומי על המחשב שמריץ את ההדגמה ואינם מועלים לשרת או ל-git.',
   'בגרסת הקישור הקבוע, הנתונים נשמרים בשרתי Cloudflare (D1) ונגישים רק לבעל ההדגמה עם מפתח מנהל.'],
]);
console.log(`cloud assets → ${OUT} (${shots.length} site screenshots)`);
