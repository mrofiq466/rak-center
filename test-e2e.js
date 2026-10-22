const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

function envValue(key) {
  try {
    const line = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
      .split('\n').find((l) => l.trim().startsWith(`${key}=`));
    return line ? line.slice(line.indexOf('=') + 1).trim() : '';
  } catch { return ''; }
}

// Login dulu kalau server memakai password
async function authCookie() {
  const password = envValue('RAK_PASSWORD');
  if (!password) return '';
  const res = await fetch('http://localhost:3000/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!res.ok) throw new Error('Login gagal: password di .env tidak cocok');
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });

  const cookie = await authCookie();
  if (cookie) await page.setExtraHTTPHeaders({ Cookie: cookie });

  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });

  // 1) Buka form tambah koleksi
  await page.click('#addItem');
  await new Promise((r) => setTimeout(r, 400));
  const dialogOpen = await page.$eval('#itemDialog', (d) => d.open);
  console.log('1. dialog "Tambah koleksi" terbuka :', dialogOpen);

  // 2) Isi form
  const testTitle = 'Uji E2E ' + Date.now();
  await page.type('#titleInput', testTitle);
  await page.select('#typeInput', 'manga');
  await page.type('#urlInput', 'https://example.com/komik-uji');
  await page.type('#noteInput', 'dari e2e test');
  await page.type('#readChapterNumInput', '12');
  await page.click('#hiatusInput');
  console.log('2. form terisi (judul, jenis, url, chapter, checkbox hiatus)');

  // 3) Submit
  await page.click('#saveButton');
  await new Promise((r) => setTimeout(r, 900));
  const closed = await page.$eval('#itemDialog', (d) => !d.open);
  console.log('3. dialog tertutup setelah simpan   :', closed);

  // 4) Cek item tersimpan di database
  const headers = cookie ? { Cookie: cookie } : {};
  const res = await fetch('http://localhost:3000/api/items', { headers });
  const items = await res.json();
  const found = items.find((i) => i.title === testTitle);
  console.log('4. tersimpan di server              :', !!found);
  console.log('   field hiatus                     :', found?.hiatus);
  console.log('   field readChapterNum             :', found?.readChapterNum);
  console.log('   field source                     :', found?.source);

  // 5) Cek tampil di Rak HaHiatus (bukan rak utama)
  await page.click('.nav-item[data-filter="hiatus"]');
  await new Promise((r) => setTimeout(r, 400));
  const hiatusTitles = await page.$$eval('.card-title', (els) => els.map((e) => e.textContent.trim()));
  console.log('5. muncul di Rak HaHiatus          :', hiatusTitles.includes(testTitle));

  await page.click('.nav-item[data-filter="all"]');
  await new Promise((r) => setTimeout(r, 400));
  const mainTitles = await page.$$eval('.card-title', (els) => els.map((e) => e.textContent.trim()));
  console.log('   TIDAK muncul di rak utama        :', !mainTitles.includes(testTitle));

  // 6) Kembalikan ke rak utama lewat tombol ⏸
  await page.click('.nav-item[data-filter="hiatus"]');
  await new Promise((r) => setTimeout(r, 400));
  await page.click('.card [data-action="hiatus"]');
  await new Promise((r) => setTimeout(r, 700));
  await page.click('.nav-item[data-filter="all"]');
  await new Promise((r) => setTimeout(r, 400));
  const mainTitles2 = await page.$$eval('.card-title', (els) => els.map((e) => e.textContent.trim()));
  console.log('6. kembali ke rak utama             :', mainTitles2.includes(testTitle));

  // 7) Hapus item uji
  await fetch(`http://localhost:3000/api/items/${found.id}`, { method: 'DELETE', headers });
  console.log('7. item uji dibersihkan             : true');

  console.log('\nError di halaman:', errors.length ? errors : 'tidak ada');
  await browser.close();
})();
