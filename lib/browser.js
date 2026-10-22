'use strict';
/**
 * lib/browser.js — adapter browser untuk pengujian otomatis.
 *
 * Menyediakan API seragam di atas Puppeteer (Chrome) dan Selenium (Firefox),
 * supaya skrip uji bisa dijalankan di browser mana pun tanpa diubah.
 *
 * - chrome  : Puppeteer + Google Chrome terpasang di sistem
 * - firefox : Selenium + geckodriver, memakai Firefox milik pengguna sendiri
 *             (bukan build Playwright) — jadi persis sama dengan browser yang
 *             dipakai untuk membaca komik.
 *
 * Pemakaian:
 *   const { launch } = require('./lib/browser');
 *   const { page, close } = await launch('firefox');
 */

const fs = require('fs');
const path = require('path');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FIREFOX_PATH = '/Applications/Firefox.app/Contents/MacOS/firefox';

function envValue(key) {
  try {
    const line = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
      .split('\n').find((l) => l.trim().startsWith(`${key}=`));
    return line ? line.slice(line.indexOf('=') + 1).trim() : '';
  } catch { return ''; }
}

/** Ambil cookie sesi dari server lokal (kalau auth aktif). */
async function authCookie(base = 'http://localhost:3000') {
  const password = envValue('RAK_PASSWORD');
  if (!password) return '';
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!res.ok) throw new Error('Login gagal: password di .env tidak cocok');
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------- chrome */

async function launchChrome(opts) {
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
    headless: opts.headless !== false ? 'new' : false,
    args: ['--no-sandbox', '--disable-gpu']
  });
  const raw = await browser.newPage();
  await raw.setViewport(opts.viewport);
  if (opts.cookie) await raw.setExtraHTTPHeaders({ Cookie: opts.cookie });

  const errors = [];
  raw.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  raw.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const page = {
    raw,
    errors,
    async goto(url) { await raw.goto(url, { waitUntil: 'networkidle2' }); },
    async click(selector) { await raw.click(selector); },
    async evaluate(fn, ...args) { return raw.evaluate(fn, ...args); },
    async text(selector) {
      return raw.$eval(selector, (el) => el.textContent.trim()).catch(() => null);
    },
    async texts(selector) {
      return raw.$$eval(selector, (els) => els.map((e) => e.textContent.trim())).catch(() => []);
    },
    async exists(selector) { return !!(await raw.$(selector)); },
    async press(key) { await raw.keyboard.press(key); },
    async screenshot(pathFile) { await raw.screenshot({ path: pathFile }); },
    wait: sleep
  };
  return { page, close: () => browser.close() };
}

/* -------------------------------------------------------------- firefox */

async function launchFirefox(opts) {
  const { Builder, By, until } = require('selenium-webdriver');
  const firefox = require('selenium-webdriver/firefox');
  const os = require('os');

  // Profil sementara: profil default Firefox yang sedang dibuka akan membuat
  // geckodriver gagal ("Process unexpectedly closed").
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rak-ff-profile-'));

  const firefoxOptions = new firefox.Options();
  if (opts.headless !== false) firefoxOptions.addArguments('-headless');
  if (fs.existsSync(FIREFOX_PATH)) firefoxOptions.setBinary(FIREFOX_PATH);
  firefoxOptions.setProfile(profileDir);
  firefoxOptions.setPreference('devtools.jsonview.enabled', false);
  firefoxOptions.setPreference('browser.cache.disk.enable', false);

  const service = new firefox.ServiceBuilder(process.env.GECKODRIVER_PATH || 'geckodriver');
  const driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(firefoxOptions)
    .setFirefoxService(service)
    .build();

  const errors = [];
  try {
    const logs = await driver.manage().logs().get('browser');
    for (const entry of logs) errors.push('BROWSER: ' + entry.message);
  } catch { /* log browser tidak tersedia */ }

  await driver.manage().window().setRect({
    width: opts.viewport.width,
    height: opts.viewport.height,
    x: 0,
    y: 0
  }).catch(() => {});
  // Muat dulu domain-nya: Firefox menolak addCookie sebelum halaman berada
  // di domain yang sama ("Document is cookie-averse").
  await driver.get(opts.base);
  if (opts.cookie) {
    const [name, value] = opts.cookie.split('=');
    await driver.manage().addCookie({ name, value, path: '/' });
    await driver.navigate().refresh();
  }

  const page = {
    raw: driver,
    errors,
    async goto(url) { await driver.get(url); },
    async click(selector) {
      const el = await driver.wait(until.elementLocated(By.css(selector)), 8000);
      await driver.executeScript('arguments[0].click()', el);
    },
    async evaluate(fn, ...args) { return driver.executeScript(fn, ...args); },
    async text(selector) {
      return driver.executeScript(
        'var e = document.querySelector(arguments[0]); return e ? e.textContent.trim() : null;',
        selector
      );
    },
    async texts(selector) {
      return driver.executeScript(
        'return Array.from(document.querySelectorAll(arguments[0])).map(function(e){return e.textContent.trim();});',
        selector
      );
    },
    async exists(selector) {
      return driver.executeScript('return !!document.querySelector(arguments[0]);', selector);
    },
    async press(key) {
      const body = await driver.findElement(By.css('body'));
      await body.sendKeys(key);
    },
    async screenshot(pathFile) { await driver.takeScreenshot().then((png) => fs.writeFileSync(pathFile, png, 'base64')); },
    wait: sleep
  };
  return { page, close: () => driver.quit() };
}

/**
 * Buka browser + halaman yang sudah login.
 * @param {'chrome'|'firefox'} engine
 */
async function launch(engine = 'chrome', options = {}) {
  const opts = {
    base: options.base || 'http://localhost:3000',
    viewport: options.viewport || { width: 1400, height: 1000 },
    headless: options.headless !== false,
    cookie: options.cookie === undefined ? await authCookie(options.base || 'http://localhost:3000') : options.cookie
  };
  if (engine === 'firefox') {
    const { page, close } = await launchFirefox(opts);
    return { page, errors: page.errors, engine, close };
  }
  const { page, close } = await launchChrome(opts);
  return { page, errors: page.errors, engine, close };
}

module.exports = { launch, authCookie, sleep };
