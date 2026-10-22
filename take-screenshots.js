'use strict';
/**
 * take-screenshots.js — membuat screenshot contoh untuk README.
 * Output: folder screenshots/ di root project.
 */

const fs = require('fs');
const path = require('path');
const { launch } = require('./lib/browser');

const BASE = process.env.SHOT_BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'screenshots');
const engine = process.argv[2] || 'chrome';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { page, close } = await launch(engine, { base: BASE, viewport: { width: 1440, height: 900 } });

  const shots = [];

  async function shot(name, desc) {
    const file = path.join(OUT, name);
    await page.screenshot(file);
    shots.push({ name, desc });
    console.log('  ✓', name, '-', desc);
  }

  await page.goto(BASE);
  await page.wait(2500);

  // 1) Dashboard utama
  await shot('01-dashboard.png', 'Dashboard utama — kartu komik & playlist');

  // 2) Filter YouTube
  await page.click('.filter-chip[data-filter="youtube"]');
  await page.wait(900);
  await shot('02-filter-youtube.png', 'Filter playlist YouTube');
  await page.click('.filter-chip[data-filter="all"]');
  await page.wait(700);

  // 3) Rak HaHiatus
  await page.click('.nav-item[data-filter="hiatus"]');
  await page.wait(900);
  await shot('03-rak-hiatus.png', 'Rak HaHiatus — komik yang disingkirkan');
  await page.click('.nav-item[data-filter="all"]');
  await page.wait(700);

  // 4) Form tambah koleksi
  await page.click('#addItem');
  await page.wait(900);
  await shot('04-tambah-koleksi.png', 'Form tambah koleksi');
  await page.press('Escape');
  await page.wait(600);

  // 5) Panel baca komik
  const hasManga = await page.exists('.card[data-type="manga"]');
  if (hasManga) {
    await page.evaluate(() => {
      document.querySelector('.card[data-type="manga"] [data-action="open"]').click();
    });
    await page.wait(5000);
    await shot('05-panel-baca.png', 'Panel baca komik — memenuhi layar + zoom');
    await page.press('Escape');
    await page.wait(800);
  }

  // 6) Rak Support (QRIS)
  await page.click('[data-action="support"]');
  await page.wait(1200);
  await shot('06-rak-support.png', 'Rak Support — kode QRIS');
  await page.press('Escape');
  await page.wait(600);

  // 7) Halaman login (kalau auth aktif)
  const needsLogin = await page.evaluate(() => !!document.getElementById('passwordInput'));
  if (!needsLogin) {
    await page.goto(BASE + '/login');
    await page.wait(1200);
    const shown = await page.exists('#passwordInput');
    if (shown) {
      await shot('07-halaman-login.png', 'Halaman login');
      await page.goto(BASE);
      await page.wait(800);
    }
  }

  await close();
  console.log('\nSelesai:', shots.length, 'screenshot di', OUT);
})();
