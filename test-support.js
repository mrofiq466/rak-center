'use strict';
/**
 * test-support.js — uji Rak Support (QRIS).
 */

const { launch } = require('./lib/browser');

const BASE = 'http://localhost:3000';
const engine = process.argv[2] || 'chrome';

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
};

(async () => {
  console.log(`\n  RAK SUPPORT (${engine})\n${'='.repeat(40)}`);
  const { page, errors, close } = await launch(engine, { base: BASE });

  try {
    await page.goto(BASE);
    await page.wait(1500);

    // 1) Tombol Rak Support ada di sidebar
    check('tombol Rak Support di sidebar', await page.exists('[data-action="support"]'));

    // 2) Klik -> dialog terbuka
    await page.click('[data-action="support"]');
    await page.wait(800);
    const open = await page.evaluate(() => document.getElementById('supportDialog').open);
    check('dialog Rak Support terbuka', open);

    // 3) Gambar QRIS dimuat & benar-benar terlihat
    const img = await page.evaluate(() => {
      const el = document.getElementById('qrisImage');
      const r = el.getBoundingClientRect();
      return { complete: el.complete, w: Math.round(r.width), h: Math.round(r.height), natural: el.naturalWidth };
    });
    check('gambar QRIS termuat', img.complete && img.natural > 0, `natural ${img.natural}px`);
    check('gambar QRIS terlihat (bukan 0px)', img.w > 100 && img.h > 100, `${img.w}x${img.h}`);

    // 4) Fallback tidak muncul (berarti file ada)
    const missing = await page.evaluate(() => document.querySelector('.support-qris').classList.contains('qris-missing'));
    check('fallback "file belum ada" tidak muncul', !missing);

    // 5) Info merchant tampil
    const merchant = await page.text('#supportMerchant');
    check('nama merchant tampil', !!merchant && merchant.length > 0, merchant || '');
    const nmid = await page.text('#supportNmid');
    check('NMID tampil', !!nmid && nmid.length > 0, nmid || '');

    // 6) Link unduh QRIS
    const dl = await page.evaluate(() => {
      const a = document.getElementById('qrisDownload');
      return { href: a.getAttribute('href'), download: a.getAttribute('download') };
    });
    check('link unduh QRIS', dl.href === 'qris.png' && dl.download === 'qris.png', JSON.stringify(dl));

    // 7) Screenshot
    await page.screenshot('/tmp/rak-support-' + engine + '.png');

    // 8) Tutup dengan tombol X
    await page.click('#supportDialog [data-close]');
    await page.wait(600);
    const closed = await page.evaluate(() => !document.getElementById('supportDialog').open);
    check('dialog bisa ditutup', closed);

    // 9) Rak Support tidak mengganggu daftar utama
    const titles = await page.texts('.card-title');
    check('daftar utama tetap utuh', titles.length > 0, `${titles.length} item`);

    const realErrors = errors.filter((e) => !/401|favicon/i.test(e));
    check('tidak ada error JavaScript', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
  } finally {
    await close();
  }

  console.log(`\n  ${engine}: ${passed} lulus, ${failed} gagal\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
