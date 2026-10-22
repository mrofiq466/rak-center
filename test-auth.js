'use strict';
/**
 * test-auth.js — uji autentikasi & sesi (mode publik / 0.0.0.0).
 */

const { spawn } = require('child_process');
const path = require('path');

const PORT = 3458;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'Password_Uji_12345';
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/login`); if (r.ok) return true; } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '0.0.0.0', RAK_PASSWORD: PASSWORD, RAK_NO_AUTH: '' },
    stdio: 'ignore'
  });

  try {
    if (!(await waitForServer())) { console.error('Server tidak merespons'); process.exit(1); }

    console.log('\n[1] Halaman & API terkunci tanpa login');
    const root = await fetch(`${BASE}/`, { redirect: 'manual' });
    check('GET / dialihkan ke /login', root.status === 302 && root.headers.get('location') === '/login', `status ${root.status}`);
    const api = await fetch(`${BASE}/api/items`);
    check('GET /api/items → 401', api.status === 401, `status ${api.status}`);
    const img = await fetch(`${BASE}/api/image-proxy?url=https://example.com/a.jpg`);
    check('GET /api/image-proxy → 401', img.status === 401, `status ${img.status}`);
    const db = await fetch(`${BASE}/data/db.json`);
    check('data/db.json tetap tertutup', db.status === 404, `status ${db.status}`);

    console.log('\n[2] Login');
    const wrong = await fetch(`${BASE}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'salah' })
    });
    check('password salah → 401', wrong.status === 401, `status ${wrong.status}`);
    const noCookie = wrong.headers.get('set-cookie');
    check('tidak ada cookie saat gagal', !noCookie);

    const good = await fetch(`${BASE}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD })
    });
    check('password benar → 200', good.status === 200, `status ${good.status}`);
    const setCookie = good.headers.get('set-cookie') || '';
    check('cookie sesi diterbitkan', setCookie.includes('rak_session='), setCookie.slice(0, 60));
    check('cookie HttpOnly', /httponly/i.test(setCookie));
    check('cookie SameSite=Strict', /samesite=strict/i.test(setCookie));
    const cookie = setCookie.split(';')[0];

    console.log('\n[3] Sesi dipakai');
    const auth = await fetch(`${BASE}/api/items`, { headers: { Cookie: cookie } });
    check('GET /api/items dengan cookie → 200', auth.status === 200, `status ${auth.status}`);
    const page = await fetch(`${BASE}/`, { headers: { Cookie: cookie }, redirect: 'manual' });
    check('GET / dengan cookie → 200', page.status === 200, `status ${page.status}`);

    console.log('\n[4] Sesi palsu & manipulasi');
    const fake = await fetch(`${BASE}/api/items`, { headers: { Cookie: 'rak_session=abcdef.123456' } });
    check('cookie palsu → 401', fake.status === 401, `status ${fake.status}`);
    const tampered = cookie.replace(/.$/, 'x');
    const tamper = await fetch(`${BASE}/api/items`, { headers: { Cookie: tampered } });
    check('cookie dimanipulasi → 401', tamper.status === 401, `status ${tamper.status}`);

    console.log('\n[5] Password tidak bocor lewat HTTP');
    const files = ['/data/auth.json', '/.env', '/server.js', '/lib/auth.js', '/login.html'];
    for (const file of files) {
      const res = await fetch(`${BASE}${file}`);
      const text = await res.text();
      const leaked = res.ok && text.includes(PASSWORD);
      check(`tidak membocorkan password via ${file}`, !leaked, `status ${res.status}`);
    }

    console.log('\n[6] Rate limit login (brute force)');
    let limited = false;
    for (let i = 0; i < 20; i++) {
      const r = await fetch(`${BASE}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: `salah${i}` })
      });
      if (r.status === 429) { limited = true; break; }
    }
    check('percobaan login dibatasi', limited);

    console.log('\n[7] Logout');
    const out = await fetch(`${BASE}/logout`, { method: 'POST', headers: { Cookie: cookie } });
    check('POST /logout → 200', out.status === 200);
    const cleared = out.headers.get('set-cookie') || '';
    check('cookie dihapus', /rak_session=;/.test(cleared) || /Expires=Thu, 01 Jan 1970/i.test(cleared));
  } finally {
    server.kill();
  }

  console.log(`\nHasil: ${passed} lulus, ${failed} gagal\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
