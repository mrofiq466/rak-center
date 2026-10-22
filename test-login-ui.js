const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

(async () => {
  const env = Object.fromEntries(
    fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
  const PASSWORD = env.RAK_PASSWORD;

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  // 1) Buka halaman utama -> harus ke login
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  console.log('1. url setelah buka        :', page.url());
  console.log('   halaman login tampil    :', await page.$eval('#passwordInput', () => true).catch(() => false));

  // 2) Password salah
  await page.type('#passwordInput', 'passwordsalah');
  await page.click('.login-form button');
  await new Promise((r) => setTimeout(r, 1200));
  const errText = await page.$eval('#loginError', (e) => e.textContent.trim());
  console.log('2. password salah          :', errText || '(tidak ada pesan)');

  // 3) Password benar
  await page.$eval('#passwordInput', (e) => { e.value = ''; });
  await page.type('#passwordInput', PASSWORD);
  await page.click('.login-form button');
  await new Promise((r) => setTimeout(r, 2500));
  console.log('3. url setelah login       :', page.url());
  const cards = await page.$$eval('.card-title', (els) => els.map((e) => e.textContent.trim()));
  console.log('   koleksi tampil          :', cards.length, 'item ->', JSON.stringify(cards));

  // 4) Sesi tersimpan (cookie)
  const cookies = await page.cookies();
  const session = cookies.find((c) => c.name === 'rak_session');
  console.log('4. cookie sesi ada         :', !!session, '| httpOnly:', session?.httpOnly, '| sameSite:', session?.sameSite);

  // 5) Refresh -> tetap login (sesi bertahan)
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  console.log('5. setelah refresh         :', page.url());

  console.log('\nError:', errors.length ? errors : 'tidak ada');
  await browser.close();
})();
