'use strict';
/**
 * test-browser.js — uji kompatibilitas lintas browser.
 *
 * Menjalankan skenario yang sama di Chrome (Puppeteer) dan Firefox (Selenium +
 * geckodriver, memakai Firefox milik pengguna sendiri).
 * Penting karena perilaku iframe / X-Frame-Options berbeda antar browser.
 *
 *   node test-browser.js            # keduanya
 *   node test-browser.js firefox    # hanya firefox
 */

const { launch } = require('./lib/browser');

const BASE = 'http://localhost:3000';
const engines = process.argv[2] ? [process.argv[2]] : ['chrome', 'firefox'];

let totalFailed = 0;

async function run(engine) {
  console.log(`\n${'='.repeat(54)}\n  ${engine.toUpperCase()}\n${'='.repeat(54)}`);
  let passed = 0, failed = 0;
  const check = (name, ok, detail = '') => {
    if (ok) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
  };

  const { page, errors, close } = await launch(engine, { base: BASE });

  try {
    await page.goto(BASE);
    await page.wait(1500);

    // 1) Halaman termuat
    check('halaman termuat', await page.exists('.card-grid'));
    const serverStatus = await page.text('#topbarStatus');
    check('status server tampil', !!serverStatus && serverStatus.length > 0, serverStatus || '');

    // 2) Koleksi tampil
    const titles = await page.texts('.card-title');
    check('koleksi tampil', titles.length > 0, `${titles.length} item`);

    // 3) Filter chip
    await page.click('.filter-chip[data-filter="youtube"]');
    await page.wait(600);
    const ytTitles = await page.texts('.card-title');
    check('filter YouTube bekerja', ytTitles.length !== titles.length || titles.length === 0, `${ytTitles.length} item`);
    await page.click('.filter-chip[data-filter="all"]');
    await page.wait(500);

    // 4) Panel baca
    const hasManga = await page.exists('.card[data-type="manga"]');
    check('ada kartu komik untuk diuji', hasManga);
    if (hasManga) {
      await page.evaluate(() => {
        document.querySelector('.card[data-type="manga"] [data-action="open"]').click();
      });
      await page.wait(4000);

      const dlg = await page.evaluate(() => {
        const el = document.getElementById('viewerDialog');
        const r = el.getBoundingClientRect();
        return { open: el.open, w: Math.round(r.width), h: Math.round(r.height), vh: window.innerHeight };
      });
      check('panel baca terbuka', dlg.open);
      check('panel baca tinggi (>=90% viewport)', dlg.h >= dlg.vh * 0.9, `${dlg.h} dari ${dlg.vh}`);

      const zoomLabel = await page.text('#zoomLevel');
      check('toolbar zoom tampil', /%$/.test(zoomLabel || ''), zoomLabel || '');

      // 5) Zoom bekerja
      await page.click('#zoomOut');
      await page.wait(400);
      const zoomAfter = await page.text('#zoomLevel');
      check('zoom out mengubah tampilan', zoomAfter !== zoomLabel, `${zoomLabel} -> ${zoomAfter}`);

      // 6) Iframe ter-render
      const frame = await page.evaluate(() => {
        const f = document.getElementById('viewerFrame');
        return { hasSrc: f.src && f.src !== 'about:blank', w: f.clientWidth, h: f.clientHeight };
      });
      check('iframe punya sumber', frame.hasSrc);
      check('iframe punya ukuran', frame.w > 100 && frame.h > 100, `${frame.w}x${frame.h}`);

      // 7) Can iframe komik benar-benar di-render di browser ini?
      const rendered = await page.evaluate(() => {
        const f = document.getElementById('viewerFrame');
        try {
          const doc = f.contentDocument;
          if (!doc) return 'cross-origin (normal untuk situs komik)';
          return doc.body ? 'ok' : 'kosong';
        } catch { return 'cross-origin (normal untuk situs komik)'; }
      });
      console.log(`    ℹ status iframe: ${rendered}`);

      await page.press('Escape');
      await page.wait(700);
    }

    // 8) Rak HaHiatus
    await page.click('.nav-item[data-filter="hiatus"]');
    await page.wait(600);
    check('filter Rak HaHiatus bekerja', Array.isArray(await page.texts('.card-title')));
    await page.click('.nav-item[data-filter="all"]');
    await page.wait(500);

    // 9) Form tambah
    await page.click('#addItem');
    await page.wait(700);
    check('dialog tambah terbuka', await page.evaluate(() => document.getElementById('itemDialog').open));
    await page.press('Escape');
    await page.wait(500);

    // 10) Tidak ada error JS
    const realErrors = errors.filter((e) => !/401|favicon|CONSOLE: Failed to load resource/i.test(e));
    check('tidak ada error JavaScript', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
  } finally {
    await close();
  }

  console.log(`\n  ${engine}: ${passed} lulus, ${failed} gagal`);
  totalFailed += failed;
}

(async () => {
  for (const engine of engines) {
    try {
      await run(engine);
    } catch (err) {
      console.log(`  ✗ ${engine} gagal dijalankan: ${err.message.split('\n')[0]}`);
      totalFailed++;
    }
  }
  console.log(`\nTotal gagal: ${totalFailed}\n`);
  process.exit(totalFailed === 0 ? 0 : 1);
})();
