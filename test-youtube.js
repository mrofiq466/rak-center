const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const PLAYLIST = process.argv[2] || 'PLjNlQ2vXx1xbt30X8TcUfNzw_akVISXEu';

function envValue(key) {
  try {
    const line = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
      .split('\n').find((l) => l.trim().startsWith(`${key}=`));
    return line ? line.slice(line.indexOf('=') + 1).trim() : '';
  } catch { return ''; }
}

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

  // Tambah playlist uji
  const title = 'Uji YT ' + Date.now();
  await page.click('#addItem');
  await new Promise((r) => setTimeout(r, 300));
  await page.type('#titleInput', title);
  await page.select('#typeInput', 'youtube');
  await page.type('#urlInput', `https://www.youtube.com/playlist?list=${PLAYLIST}`);
  await page.click('#saveButton');
  await new Promise((r) => setTimeout(r, 900));

  const id = (await (await fetch('http://localhost:3000/api/items', { headers: cookie ? { Cookie: cookie } : {} })).json()).find((i) => i.title === title)?.id;
  console.log('1. playlist ditambahkan            :', !!id);

  // Refresh dari sumber
  await page.click(`.card [data-action="refresh"]`);
  await new Promise((r) => setTimeout(r, 9000));

  const item = (await (await fetch('http://localhost:3000/api/items', { headers: cookie ? { Cookie: cookie } : {} })).json()).find((i) => i.id === id);
  console.log('2. judul dari YouTube              :', item.title);
  console.log('   video terbaru                    :', item.latestVideo?.title);
  console.log('   index video terbaru              :', item.latestVideo?.index);
  console.log('   status                           :', item.read ? 'Sudah ditonton' : 'Belum ditonton');

  // Cek tampilan kartu (tidak boleh ada kata "Chapter")
  const cardText = await page.$eval(`.card[data-type="youtube"]`, (el) => el.innerText);
  console.log('3. kartu TIDAK memuat kata "Chapter":', !/chapter/i.test(cardText));
  console.log('4. isi kartu                        :', JSON.stringify(cardText.split('\n').filter(Boolean).slice(0, 9)));

  // Buka -> harus embed video terbaru
  await page.click(`.card[data-type="youtube"] [data-action="open"]`);
  await new Promise((r) => setTimeout(r, 4000));
  const src = await page.$eval('#viewerFrame', (f) => f.src);
  console.log('5. iframe memutar video terbaru    :', src.includes(item.latestVideo?.id || 'xxx'));
  console.log('   src                               :', src);
  const after = (await (await fetch('http://localhost:3000/api/items', { headers: cookie ? { Cookie: cookie } : {} })).json()).find((i) => i.id === id);
  console.log('6. "terakhir diputar" tercatat     :', after.lastVideoIndex);
  const cardText2 = await page.$eval(`.card[data-type="youtube"]`, (el) => el.innerText);
  console.log('7. kartu setelah diputar            :', JSON.stringify(cardText2.split('\n').filter(Boolean)));

  await fetch(`http://localhost:3000/api/items/${id}`, { method: 'DELETE', headers: cookie ? { Cookie: cookie } : {} });
  console.log('\nError:', errors.length ? errors : 'tidak ada');
  await browser.close();
})();
