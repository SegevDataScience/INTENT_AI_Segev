// Builds the static live demo (GitHub Pages) into presentation/docs/ from the same pages and widget.
// Uses fictional sites (sites.demo.json), mock page images and synthetic data only — safe to publish.
//   npm run build:static
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { openDb, listFeedback, listSites } from '../src/db.js';
import { loadSites, seed } from '../src/seed.js';
import { seedDemo } from '../src/demo-data.js';
import { CONSENT_VERSION, DEFAULT_RETENTION_DAYS } from '../src/consent.js';

const SIM = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.STATIC_OUT || join(SIM, '..', 'docs');
const sites = loadSites(join(SIM, 'sites.demo.json'));
const now = process.env.DEMO_NOW ? Date.parse(process.env.DEMO_NOW) : Date.now();

for (const dir of ['sites', 'data']) {
  rmSync(join(OUT, dir), { recursive: true, force: true });
  mkdirSync(join(OUT, dir), { recursive: true });
}
mkdirSync(join(OUT, 'audio'), { recursive: true }); // synthesized demo recordings live here (kept between builds)

// ---- 1. pages: absolute paths → relative, inject the in-browser API before any other script ----
const toRelative = html => html
  .replace(/(["'`])\/(demo\.css|widget\.js|widget\.css|site\.html|dashboard\.html|privacy\.html|sites\/|api\/|audio\/)/g, '$1$2')
  .replace(/href="\/"/g, 'href="index.html"')
  .replace(/(sites\/\$\{encodeURIComponent\((?:s\.slug|slug)\)\})\.png/g, '$1.svg');
const inject = html => html.replace('</title>', '</title>\n  <script type="module" src="static-api.js"></script>');

for (const page of ['index.html', 'site.html', 'dashboard.html', 'privacy.html']) { // share.html is local-only
  let html = inject(toRelative(readFileSync(join(SIM, 'public', page), 'utf8')));
  if (page === 'dashboard.html') {
    html = html.replace('src: `audio/${encodeURIComponent(f.audioPath)}`', 'src: window.audioUrl(f.audioPath)');
  }
  if (page === 'index.html') {
    html = html.replace('סימולציה מקומית', 'דמו חי')
      .replace('הדגמה פנימית בלבד. האתרים מוצגים כצילומי מסך ואין קשר בינם לבין Intent AI.',
        'האתרים כאן הם אתרי דמה עם נתונים סינתטיים. בגרסה המקומית ההדגמה רצה על צילומי מסך של אתרים ישראליים אמיתיים.');
  }
  if (page === 'site.html') { // the static demo uses mock pages, so say so instead of "screenshot of the live site"
    html = html.replace("const EXT = '.png';", "const EXT = '.svg';");
    html = html.replace('(צילום מסך · הדגמה בלבד, ללא קשר ל${site.name})', '(אתר דמה להדגמה)');
  }
  writeFileSync(join(OUT, page), html);
}
for (const f of ['demo.css', 'widget.js', 'widget.css']) copyFileSync(join(SIM, 'public', f), join(OUT, f));
copyFileSync(join(SIM, 'src', 'analyze.js'), join(OUT, 'analyze.js'));
copyFileSync(join(SIM, 'static', 'static-api.js'), join(OUT, 'static-api.js'));
writeFileSync(join(OUT, 'demo.css'), readFileSync(join(OUT, 'demo.css'), 'utf8') +
  '\n.static-note { background: #fff4d6; color: #6b4e00; text-align: center; font-size: 13px; padding: 6px 12px; }\n');
writeFileSync(join(OUT, '.nojekyll'), '');

// ---- 2. mock page images for the fictional sites (no real brands) ----
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#e87ba4', '#6250d6'];
const HEADLINES = ['מבצעי השבוע במרקט', 'טסים לחופשה הבאה', 'החדשות החמות של היום', 'הכל לבריאות ולטיפוח', 'החבילה המשתלמת לבית'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function mockSvg(site, i) {
  const c = PALETTE[i % PALETTE.length];
  const cards = Array.from({ length: 8 }, (_, k) => {
    const x = 1440 - 120 - 300 - (k % 4) * 320, y = 820 + Math.floor(k / 4) * 400;
    return `<rect x="${x}" y="${y}" width="300" height="360" rx="18" fill="#fff" stroke="#e3e6ee"/>
      <rect x="${x + 30}" y="${y + 30}" width="240" height="170" rx="12" fill="${c}" opacity="0.12"/>
      <rect x="${x + 70}" y="${y + 225}" width="200" height="18" rx="9" fill="#cfd3dc"/>
      <rect x="${x + 130}" y="${y + 260}" width="140" height="14" rx="7" fill="#e3e6ee"/>
      <rect x="${x + 30}" y="${y + 300}" width="110" height="36" rx="18" fill="${c}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1700" viewBox="0 0 1440 1700" font-family="Arial, sans-serif" direction="rtl">
  <rect width="1440" height="1700" fill="#f6f7fb"/>
  <rect width="1440" height="96" fill="#fff"/>
  <text x="1320" y="62" font-size="38" font-weight="700" fill="${c}" text-anchor="start">${esc(site.name)}</text>
  ${[0, 1, 2, 3, 4].map(k => `<rect x="${760 - k * 150}" y="34" width="120" height="28" rx="14" fill="#eef0f4"/>`).join('')}
  <rect x="120" y="140" width="1200" height="560" rx="28" fill="${c}"/>
  <text x="1260" y="330" font-size="64" font-weight="700" fill="#fff" text-anchor="start">${esc(HEADLINES[i % HEADLINES.length])}</text>
  <text x="1260" y="400" font-size="30" fill="#fff" opacity="0.85" text-anchor="start">${esc(site.industry)} · אתר דמה להדגמה</text>
  <rect x="1060" y="460" width="200" height="64" rx="32" fill="#fff"/>
  <rect x="200" y="220" width="420" height="400" rx="24" fill="#fff" opacity="0.18"/>
  ${cards}
</svg>`;
}
sites.forEach((s, i) => writeFileSync(join(OUT, 'sites', `${s.slug}.svg`), mockSvg(s, i)));

// ---- 3. synthetic data, produced through the real DB layer so the shape matches the server exactly ----
const db = openDb(':memory:');
seed(db, sites);
const rows = seedDemo(db, sites, { seed: 7, now, count: 180 });
const seedJson = {
  generatedAt: new Date(now).toISOString(),
  source: 'TEST · synthetic',
  consent: { version: CONSENT_VERSION, retentionDays: DEFAULT_RETENTION_DAYS },
  sites: listSites(db),
  apiKeys: Object.fromEntries(sites.map(s => [s.slug, s.apiKey])),
  feedback: listFeedback(db),
};
writeFileSync(join(OUT, 'data', 'seed.json'), JSON.stringify(seedJson));

const missingAudio = [...new Set(seedJson.feedback.map(f => f.audioPath).filter(Boolean))].filter(p => !existsSync(join(OUT, 'audio', p)));
console.log(`static demo → ${OUT}`);
console.log(`  ${sites.length} fictional sites · ${rows} synthetic feedback · ${new Set(seedJson.feedback.map(f => f.endUserId)).size} distinct users`);
if (missingAudio.length) console.warn(`  WARNING: missing demo recordings in docs/audio: ${missingAudio.join(', ')}`);
