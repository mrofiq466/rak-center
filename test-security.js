'use strict';
/**
 * test-security.js — uji keamanan otomatis (tanpa tool pentest eksternal).
 * Menjalankan server di port acak lalu mencoba eksploitasi yang relevan
 * untuk app lokal: SSRF, prototype pollution, kebocoran berkas, akses API.
 */

const { spawn } = require('child_process');
const path = require('path');

const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`);
  }
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/api/items`);
      if (res.ok) return true;
    } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: 'ignore'
  });

  try {
    if (!(await waitForServer())) {
      console.error('Server tidak merespons');
      process.exit(1);
    }

    console.log('\n[1] Server hanya dengar di loopback');
    const net = require('net');
    const addresses = Object.values(require('os').networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    let lanReachable = false;
    for (const addr of addresses) {
      const reachable = await new Promise((resolve) => {
        const s = net.connect({ host: addr, port: PORT, timeout: 1200 });
        s.on('connect', () => { s.destroy(); resolve(true); });
        s.on('error', () => resolve(false));
        s.on('timeout', () => { s.destroy(); resolve(false); });
      });
      if (reachable) { lanReachable = true; break; }
    }
    check('tidak bisa diakses dari IP LAN', !lanReachable, `IP: ${addresses.join(', ')}`);

    console.log('\n[2] SSRF — proxy gambar & scrape');
    const ssrfTargets = [
      'http://127.0.0.1:22/',
      'http://localhost:3000/api/items',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.1/',
      'http://10.0.0.1/',
      'http://[::1]:3000/',
      'file:///etc/passwd',
      'gopher://127.0.0.1:11211/',
      'http://metadata.google.internal/computeMetadata/v1/'
    ];
    for (const target of ssrfTargets) {
      const res = await fetch(`${BASE}/api/image-proxy?url=${encodeURIComponent(target)}`);
      const body = await res.text();
      const blocked = res.status >= 400 && !body.includes('root:') && !body.includes('"items"');
      check(`ditolak: ${target}`, blocked, `status ${res.status}`);
    }
    const meta = await fetch(`${BASE}/api/fetch-meta?url=${encodeURIComponent('http://127.0.0.1:3000/api/items')}`);
    check('fetch-meta menolak target internal', meta.status >= 400, `status ${meta.status}`);

    console.log('\n[3] Prototype pollution');
    const created = await (await fetch(`${BASE}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Uji Polusi', type: 'manga', url: 'https://example.com/x' })
    })).json();
    const polluted = await (await fetch(`${BASE}/api/items/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Uji Polusi', __proto__: { polluted: 'yes' }, constructor: { prototype: { x: 1 } } })
    })).json();
    check('__proto__ tidak masuk ke data', !('polluted' in polluted) && polluted.polluted === undefined);
    check('objek global tidak tercemar', ({}).polluted === undefined);
    const dbRaw = require('fs').readFileSync(path.join(__dirname, 'data', 'db.json'), 'utf8');
    check('db.json tidak memuat "__proto__"', !dbRaw.includes('"__proto__"'));
    await fetch(`${BASE}/api/items/${created.id}`, { method: 'DELETE' });

    console.log('\n[4] Kebocoran berkas sensitif');
    for (const file of ['/data/db.json', '/server.js', '/lib/guard.js', '/package.json', '/.git/config', '/test-security.js']) {
      const res = await fetch(`${BASE}${file}`);
      const text = await res.text();
      const leaked = res.ok && !text.includes('Tidak ditemukan') && text.trim().length > 0;
      check(`tidak melayani ${file}`, !leaked, `status ${res.status}`);
    }
    const front = await fetch(`${BASE}/index.html`);
    check('index.html tetap bisa diakses', front.ok);
    const app = await fetch(`${BASE}/app.js`);
    check('app.js tetap bisa diakses', app.ok);

    console.log('\n[5] Batas ukuran request');
    const big = 'x'.repeat(300 * 1024);
    const res = await fetch(`${BASE}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: big, type: 'manga', url: 'https://example.com/x' })
    });
    check('request > 256KB ditolak', res.status >= 400, `status ${res.status}`);

    console.log('\n[6] Rate limit proxy gambar');
    let limited = false;
    for (let i = 0; i < 60; i++) {
      const r = await fetch(`${BASE}/api/image-proxy?url=${encodeURIComponent('https://example.com/a.jpg')}`);
      if (r.status === 429) { limited = true; break; }
    }
    check('proxy gambar dibatasi 40 req/menit', limited);

    console.log('\n[7] Integritas data setelah uji');
    const items = await (await fetch(`${BASE}/api/items`)).json();
    check('API mengembalikan daftar yang valid', Array.isArray(items), `tipe: ${typeof items}`);
    check('tidak ada item uji tersisa', !items.some((i) => i.title === 'Uji Polusi'));
  } finally {
    server.kill();
  }

  console.log(`\nHasil: ${passed} lulus, ${failed} gagal\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
