// Full-page screenshot of each real site using the locally installed Edge (or Chrome), headless.
// Usage: npm run capture            (all sites)
//        npm run capture shufersal  (one site)
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadSites } from '../src/seed.js';
import { isPathAllowed } from '../src/robots.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'sites');
mkdirSync(outDir, { recursive: true });

const candidates = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
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
// Respect robots.txt: skip any page the site disallows for generic agents.
async function robotsAllows(url) {
  const u = new URL(url);
  try {
    const res = await fetch(new URL('/robots.txt', u.origin), { signal: AbortSignal.timeout(10000) });
    if (res.status >= 500) return false; // RFC 9309 §2.3.1.4: unreachable → assume complete disallow
    if (!res.ok) return true;            // §2.3.1.3: 4xx (no robots.txt) → no restrictions
    return isPathAllowed(await res.text(), u.pathname + u.search);
  } catch {
    return false; // network failure counts as unreachable → do not capture
  }
}

for (const site of sites) {
  const out = join(outDir, `${site.slug}.png`);
  console.log(`Capturing ${site.name} (${site.url}) → ${out}`);
  if (!(await robotsAllows(site.url))) {
    console.warn('  SKIPPED: robots.txt disallows this page. Not capturing.');
    failed++;
    continue;
  }
  try {
    execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      `--user-data-dir=${join(tmpdir(), 'intent-sim-capture')}`,
      '--lang=he-IL', '--window-size=1440,4000', '--virtual-time-budget=20000',
      `--screenshot=${out}`, site.url,
    ], { stdio: 'inherit', timeout: 120000 });
    if (!existsSync(out) || statSync(out).size === 0) throw new Error('no screenshot written');
    // A real full-page capture is usually >500KB; tiny files are typically bot-check or error pages.
    if (statSync(out).size < 200 * 1024) {
      console.warn(`  WARNING: screenshot is only ${Math.round(statSync(out).size / 1024)}KB — the site may block automated capture.`);
      console.warn(`  Open ${out} to check. If blocked, capture it manually (see README) or delete the file to show the fallback page.`);
    } else {
      console.log('  ok');
    }
  } catch (err) {
    failed++;
    console.error(`  failed: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
