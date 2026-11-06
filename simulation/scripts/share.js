// Share the simulation with anyone via a temporary public link (Cloudflare quick tunnel).
// Visitors get the real-site demo + feedback widget; their feedback is saved HERE, in the local TEST DB.
// The dashboard and data stay locked behind an admin key that only this computer has.
//   npm run share      (or double-click presentation/share-demo.bat)
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4000;
const DATA = join(ROOT, 'data');
const TOOLS = join(ROOT, 'tools');
mkdirSync(DATA, { recursive: true });
mkdirSync(TOOLS, { recursive: true });

const children = [];
const shutdown = code => { for (const c of children) { try { c.kill(); } catch { /* already gone */ } } process.exit(code); };
process.on('SIGINT', () => { console.log('\nעוצר את השיתוף… הקישור הפסיק לעבוד. הנתונים נשארו אצלך.'); shutdown(0); });

// ---- 1. cloudflared (downloaded once from Cloudflare's official GitHub releases) ----
async function ensureCloudflared() {
  if (process.platform !== 'win32') return 'cloudflared'; // macOS/Linux: install cloudflared and keep it on PATH
  const exe = join(TOOLS, 'cloudflared.exe');
  if (existsSync(exe) && statSync(exe).size > 1_000_000) return exe;
  const url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  console.log('מוריד את cloudflared (פעם אחת בלבד) מ־GitHub הרשמי של Cloudflare…');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  writeFileSync(exe, Buffer.from(await res.arrayBuffer()));
  console.log(`  ✓ ${Math.round(statSync(exe).size / 1024 / 1024)}MB → ${exe}`);
  return exe;
}

// ---- 2. admin key: kept on this computer, never shown to visitors ----
const tokenFile = join(DATA, '.admin-token');
const ADMIN = process.env.ADMIN_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim()
  : (() => { const t = randomBytes(18).toString('base64url'); writeFileSync(tokenFile, t, { mode: 0o600 }); return t; })());

const waitFor = async (url, ms, headers = {}) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    try { const r = await fetch(url, { headers }); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
};

(async () => {
  const cloudflared = await ensureCloudflared();

  // ---- 3. the simulation server in share mode ----
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, SHARE_MODE: '1', ADMIN_TOKEN: ADMIN, PORT: String(PORT) },
  });
  children.push(server);
  server.on('exit', code => { console.error(`השרת נעצר (קוד ${code}).`); shutdown(code || 1); });
  if (!(await waitFor(`http://127.0.0.1:${PORT}/api/mode`, 20000))) { console.error('השרת לא עלה. האם פורט 4000 כבר תפוס? סגרו חלון הדגמה אחר ונסו שוב.'); shutdown(1); }

  // ---- 4. public tunnel ----
  console.log('פותח קישור ציבורי מאובטח (HTTPS)…');
  const tunnel = spawn(cloudflared, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(tunnel);
  tunnel.on('exit', code => { console.error(`המנהרה נסגרה (קוד ${code}).`); shutdown(code || 1); });

  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no tunnel URL after 60s')), 60000);
    const onData = buf => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(buf));
      if (m) { clearTimeout(timer); resolve(m[0]); }
    };
    tunnel.stdout.on('data', onData);
    tunnel.stderr.on('data', onData);
  });
  process.stdout.write('ממתין שהקישור יהיה זמין ברשת…');
  await waitFor(`${url}/api/mode`, 60000);
  console.log(' ✓');

  // ---- 5. QR + share page ----
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#14122b', light: '#ffffff' } });
  writeFileSync(join(DATA, 'share.json'), JSON.stringify({ visitorUrl: url, qr, startedAt: new Date().toISOString() }));
  const adminLocal = `http://localhost:${PORT}/share.html?admin=${encodeURIComponent(ADMIN)}`;

  console.log('\n' + await QRCode.toString(url, { type: 'terminal', small: true }));
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  קישור למבקרים (לשלוח לכל מי שתרצו):  ${url}`);
  console.log(`  דף השיתוף והדשבורד שלך (רק אצלך):    ${adminLocal}`);
  console.log('  הקישור עובד כל עוד החלון הזה פתוח. לעצירה: Ctrl+C.');
  console.log('════════════════════════════════════════════════════════════\n');

  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', adminLocal], { detached: true, stdio: 'ignore' }).unref();
})().catch(err => { console.error('השיתוף נכשל:', err.message); shutdown(1); });
