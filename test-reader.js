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

async function authCookie() {
  const password = envValue('RAK_PASSWORD');
  if (!password) return '';
  const res = await fetch('http://localhost:3000/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!res.ok) throw new Error('Login gagal');
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const cookie = await authCookie();
  if (cookie) await page.setExtraHTTPHeaders({ Cookie: cookie });

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  // Buka komik pertama (bukan YouTube)
  const opened = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card[data-type="manga"]')][0];
    if (!card) return false;
    card.querySelector('[data-action="open"]').click();
    return true;
  });
  console.log('kartu komik dibuka :', opened);
  await new Promise((r) => setTimeout(r, 4000));

  const metrics = await page.evaluate(() => {
    const d = document.getElementById('viewerDialog');
    const wrap = document.getElementById('frameWrap');
    const r = d.getBoundingClientRect();
    return {
      dialogW: Math.round(r.width), dialogH: Math.round(r.height),
      viewportH: window.innerHeight, viewportW: window.innerWidth,
      frameH: Math.round(wrap.getBoundingClientRect().height),
      zoomLabel: document.getElementById('zoomLevel').textContent
    };
  });
  console.log('dialog  :', metrics.dialogW + 'x' + metrics.dialogH, 'dari viewport', metrics.viewportW + 'x' + metrics.viewportH);
  console.log('tinggi panel baca :', metrics.frameH, 'px (sebelumnya ~665)');
  console.log('zoom awal :', metrics.zoomLabel);

  await page.screenshot({ path: '/tmp/rak-reader.png' });

  // Uji zoom
  await page.click('#zoomOut');
  await page.click('#zoomOut');
  await new Promise((r) => setTimeout(r, 400));
  const zoomAfter = await page.$eval('#zoomLevel', (e) => e.textContent);
  const transform = await page.$eval('#viewerZoom', (e) => e.style.transform);
  console.log('setelah 2x zoom out :', zoomAfter, '|', transform);

  await page.click('#zoomIn');
  await new Promise((r) => setTimeout(r, 300));
  console.log('setelah 1x zoom in  :', await page.$eval('#zoomLevel', (e) => e.textContent));

  await page.screenshot({ path: '/tmp/rak-reader-zoom.png' });

  // Uji fullscreen
  const fsOk = await page.evaluate(() => {
    const btn = document.getElementById('fullscreenBtn');
    btn.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 900));
  const isFs = await page.evaluate(() => !!document.fullscreenElement);
  console.log('fullscreen aktif :', isFs);
  await page.screenshot({ path: '/tmp/rak-reader-fs.png' });

  // Uji keyboard shortcut
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));
  await page.keyboard.press('+');
  await new Promise((r) => setTimeout(r, 250));
  console.log('tekan "+" ->', await page.$eval('#zoomLevel', (e) => e.textContent));
  await page.keyboard.press('0');
  await new Promise((r) => setTimeout(r, 250));
  console.log('tekan "0" ->', await page.$eval('#zoomLevel', (e) => e.textContent));

  // Zoom tersimpan?
  const stored = await page.evaluate(() => localStorage.getItem('rak-zoom-v1'));
  console.log('zoom tersimpan di localStorage :', stored);

  await browser.close();
})();
