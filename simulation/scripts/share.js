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
process.on('SIGINT', () => { console.log('\nStopping sharing… the link no longer works. Your data stays on this computer.'); shutdown(0); });

// ---- 1. cloudflared (downloaded once from Cloudflare's official GitHub releases) ----
async function ensureCloudflared() {
  if (process.platform !== 'win32') return 'cloudflared'; // macOS/Linux: install cloudflared and keep it on PATH
  const exe = join(TOOLS, 'cloudflared.exe');
  if (existsSync(exe) && statSync(exe).size > 1_000_000) return exe;
  const url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  console.log("Downloading cloudflared (first time only) from Cloudflare's official GitHub…");
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
  server.on('exit', code => { console.error(`\nThe demo server stopped (code ${code}). If another demo window is open (port ${PORT} busy), close it and try again.`); shutdown(code || 1); });
  if (!(await waitFor(`http://127.0.0.1:${PORT}/api/mode`, 20000))) { console.error(`The demo server did not start. Is port ${PORT} already in use? Close the other demo window and try again.`); shutdown(1); }

  // ---- 4. public tunnel ----
  process.stdout.write('Opening a secure public link (HTTPS) via Cloudflare');
  const dots = setInterval(() => process.stdout.write('.'), 1500);
  const tunnel = spawn(cloudflared, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(tunnel);
  tunnel.on('exit', code => { console.error(`\nThe Cloudflare tunnel closed (code ${code}). Check the internet connection and run share-demo.bat again.`); shutdown(code || 1); });

  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Cloudflare did not return a link within 90 seconds. Check the internet connection and try again')), 90000);
    const onData = buf => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(buf));
      if (m) { clearTimeout(timer); resolve(m[0]); }
    };
    tunnel.stdout.on('data', onData);
    tunnel.stderr.on('data', onData);
  });
  clearInterval(dots);

  // ---- 5. Show the link IMMEDIATELY: QR, share page, and a text file — before any reachability check ----
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#14122b', light: '#ffffff' } });
  writeFileSync(join(DATA, 'share.json'), JSON.stringify({ visitorUrl: url, qr, startedAt: new Date().toISOString() }));
  writeFileSync(join(DATA, 'share-link.txt'), `${url}\n`);
  const adminLocal = `http://localhost:${PORT}/share.html?admin=${encodeURIComponent(ADMIN)}`;

  console.log('\n\n' + await QRCode.toString(url, { type: 'terminal', small: true }));
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  Visitor link (send to anyone):   ${url}`);
  console.log(`  Your share page + dashboard:     ${adminLocal}`);
  console.log('  The link works while this window is open. Stop: Ctrl+C or close the window.');
  console.log(`  The link is also saved in: ${join(DATA, 'share-link.txt')}`);
  console.log('════════════════════════════════════════════════════════════\n');
  if (process.platform === 'win32' && process.env.NO_BROWSER !== '1') spawn('cmd', ['/c', 'start', '', adminLocal], { detached: true, stdio: 'ignore' }).unref();

  // ---- 6. Reachability check in the background, with visible progress and an honest result ----
  process.stdout.write('Checking the link is reachable');
  const progress = setInterval(() => process.stdout.write('.'), 2000);
  const reachable = await waitFor(`${url}/api/mode`, 45000);
  clearInterval(progress);
  if (reachable) console.log(' ✓ the link is live.');
  else console.log(' — not answering from this computer yet. This is usually a DNS delay on this PC only;\n  try the link on your phone (mobile data). If it still fails, close this window and run share-demo.bat again.');
})().catch(err => { console.error('\nSharing failed:', err.message); shutdown(1); });
