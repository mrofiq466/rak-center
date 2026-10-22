const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { validateRemoteUrl, sanitizeBody, createRateLimiter } = require('./lib/guard');
const { verifyPassword, signSession, verifySession, parseCookies, loadAuth, SESSION_TTL_MS } = require('./lib/auth');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

/* --------------------------------------------------------- konfigurasi */

// Baca .env (kalau ada) tanpa dependency tambahan
function loadEnvFile(file = path.join(__dirname, '.env')) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  } catch { /* tidak ada .env -> pakai default */ }
}
loadEnvFile();

// Default 0.0.0.0 supaya siap dipakai di server + Cloudflare Tunnel.
// Set HOST=127.0.0.1 di .env untuk berjalan lokal tanpa password.
const HOST = process.env.HOST || '0.0.0.0';
const IS_LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(HOST);

const ALLOW_PRIVATE_FETCH = process.env.RAK_ALLOW_PRIVATE_FETCH === '1';
// Folder data bisa diarahkan (berguna untuk data demo & beberapa instance sekaligus)
const DB_DIR = process.env.RAK_DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'db.json');

// Autentikasi: wajib kalau server tidak hanya mendengarkan di loopback.
// Set RAK_NO_AUTH=1 untuk mematikan password (mode lokal / development).
const AUTH_REQUIRED = process.env.RAK_NO_AUTH !== '1' && !IS_LOOPBACK;
const { record: authRecord, plain: generatedPassword, isFirstRun } = loadAuth(
  DB_DIR,
  process.env.RAK_PASSWORD || undefined
);
const SESSION_SECRET = authRecord.secret;

const PUBLIC_FILES = new Set([
  'index.html', 'login.html', 'styles.css', 'styles-extra.css', 'app.js', 'favicon.svg',
  process.env.RAK_QRIS_FILE || 'qris.png'
]);

const rateLimit = createRateLimiter({ windowMs: 60_000, max: 40 });
const loginLimit = createRateLimiter({ windowMs: 15 * 60_000, max: 12 });

app.set('trust proxy', true);
app.use(express.json({ limit: '256kb' }));
app.use(cors({ origin: IS_LOOPBACK ? true : false }));

/* ---------------------------------------------------------------- auth */

function isAuthenticated(req) {
  if (!AUTH_REQUIRED) return true;
  const cookies = parseCookies(req.headers.cookie || '');
  if (verifySession(SESSION_SECRET, cookies.rak_session)) return true;
  // akses programatik (curl, skrip) memakai token
  const token = req.get('X-Rak-Token');
  if (token && process.env.RAK_TOKEN) {
    const a = Buffer.from(token);
    const b = Buffer.from(process.env.RAK_TOKEN);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

app.post('/login', (req, res) => {
  if (!AUTH_REQUIRED) return res.json({ ok: true });
  if (!loginLimit(req.ip)) return res.status(429).json({ error: 'Terlalu banyak percobaan' });
  const password = sanitizeBody(req.body).password;
  if (!password || !verifyPassword(password, authRecord.passwordHash)) {
    return res.status(401).json({ error: 'Password salah' });
  }
  const token = signSession(SESSION_SECRET, { exp: Date.now() + SESSION_TTL_MS });
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.cookie('rak_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
  res.json({ ok: true });
});

app.post('/logout', (_req, res) => {
  res.clearCookie('rak_session', { path: '/' });
  res.json({ ok: true });
});

// Status server (di luar penjaga auth supaya frontend selalu bisa membacanya)
app.get('/api/status', (_req, res) => {
  res.json({
    authRequired: AUTH_REQUIRED,
    host: HOST,
    port: PORT,
    version: require('./package.json').version
  });
});

// Jaga seluruh API
app.use('/api', (req, res, next) => {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'Belum masuk. Buka halaman login.' });
});

app.get('/favicon.ico', (_req, res) => res.redirect(301, '/favicon.svg'));

// Sajikan hanya berkas frontend yang diizinkan (bukan seluruh folder proyek)
function sendFileHtml(file, res, next) {
  fs.readFile(path.join(__dirname, file), 'utf8', (err, html) => {
    if (err) return next(err);
    res.type('html').send(html.replace('__RAK_TOKEN__', ''));
  });
}

// Halaman utama: butuh login
app.get('/', (req, res, next) => {
  if (!isAuthenticated(req)) return res.redirect(302, '/login');
  sendFileHtml('index.html', res, next);
});

app.get('/login', (req, res, next) => {
  // auth dimatikan -> tidak ada halaman login yang perlu diakses
  if (!AUTH_REQUIRED) return res.redirect(302, '/');
  if (isAuthenticated(req)) return res.redirect(302, '/');
  sendFileHtml('login.html', res, next);
});

app.get('/:file', (req, res, next) => {
  if (!PUBLIC_FILES.has(req.params.file)) return next();
  if (req.params.file === 'index.html') {
    if (!isAuthenticated(req)) return res.redirect(302, '/login');
    return sendFileHtml('index.html', res, next);
  }
  if (req.params.file === 'login.html') {
    if (AUTH_REQUIRED && isAuthenticated(req)) return res.redirect(302, '/');
    return sendFileHtml('login.html', res, next);
  }
  res.sendFile(path.join(__dirname, req.params.file));
});

// Screenshot contoh (dipakai README). Hanya .png, tanpa path traversal.
app.get('/screenshots/:file', (req, res, next) => {
  if (!/^[\w.-]+\.png$/i.test(req.params.file)) return next();
  res.sendFile(path.join(__dirname, 'screenshots', req.params.file), (err) => {
    if (err) next();
  });
});

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ---------------------------------------------------------------- utils */

function readDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    db.items = (db.items || []).map(normalizeItem);
    return db;
  } catch {
    return { items: [] };
  }
}

function writeDb(db) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function resolveUrl(base, href) {
  try { return new URL(href, base).href; } catch { return href; }
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Tanggal rilis: "19/10/2026" -> ISO string
function parseReleaseDate(text) {
  const m = String(text || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value) {
  const m = String(value ?? '').match(/(\d{1,4})(?:[.,](\d{1,2}))?/);
  if (!m) return -1;
  const num = parseFloat(`${m[1]}${m[2] ? '.' + m[2] : ''}`);
  return Number.isFinite(num) ? num : -1;
}

// "Chapter 30" / "Terbaru: Chapter 30" / "30" -> "Chapter 30"
// Buang juga keterangan waktu yang nempel ("18 jam lalu", "2 hari lalu", "3 weeks ago")
function cleanChapterTitle(raw, num) {
  let text = String(raw || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^terbaru\s*[:\-]?\s*/i, '').replace(/\s*terbaru$/i, '');
  text = text.replace(/^baca\s+/i, '').replace(/\s+bahasa\s+indonesia\s*$/i, '');
  // buang ekor waktu: "2 hari lalu", "18 jam lalu", "3 weeks ago", "1 bln lalu"
  text = text.replace(/\s*\b\d+\s*(jam|hari|minggu|pekan|bulan|tahun|bln|thn|hour|day|week|month|year)s?\s*(lalu|ago)\b\s*$/i, '');
  text = text.replace(/\s*\b(dijual|rilis|update)?\s*\d+\s*(jam|hari)\s*(lalu|ago)\b\s*$/i, '');
  text = text.replace(/^\|\s*|\s*\|$/g, '').trim();
  if (!text) return num >= 0 ? `Chapter ${num}` : 'Chapter';
  if (/^\d+(\.\d+)?$/.test(text) && num >= 0) return `Chapter ${text}`;
  return text;
}

function chapterNumFromUrl(href) {
  const m = String(href).match(/(?:chapter|ch|bab|episode)[-/_]?(\d{1,4}(?:[.,]\d{1,2})?)/i);
  if (m) return toNumber(m[1]);
  return -1;
}

function looksLikeChapter(href, text) {
  const hay = `${href} ${text}`.toLowerCase();
  return /chapter|episode|\bbab\b|\bch[-_/]|part[-_/]?\d/.test(hay);
}

// Migrasi data lama: latestChapter dulunya string, sekarang objek
function normalizeItem(item) {
  if (item.hiatus === undefined) item.hiatus = false;
  if (item.latestChapter && typeof item.latestChapter === 'string') {
    const num = toNumber(item.latestChapter);
    const url = item.latestChapterUrl || '';
    item.latestChapter = {
      title: cleanChapterTitle(item.latestChapter, num),
      url,
      num: num >= 0 ? num : chapterNumFromUrl(url)
    };
  }
  if (item.readChapter && typeof item.readChapter === 'string') {
    const num = toNumber(item.readChapter);
    item.readChapterNum = Number.isFinite(num) && num >= 0 ? num : (item.readChapterNum ?? -1);
  }
  if (item.readChapterNum === undefined) item.readChapterNum = -1;
  if (item.read === undefined) item.read = false;
  return item;
}

async function fetchText(url) {
  const check = await validateRemoteUrl(url, { allowPrivate: ALLOW_PRIVATE_FETCH });
  if (!check.ok) throw new Error(check.reason);
  const resp = await fetch(check.url.href, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, 'Accept-Language': 'id-ID,id;q=0.9' }
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

/* ------------------------------------------------------------------ api */

app.get('/api/items', (_req, res) => {
  const db = readDb();
  const items = [...db.items].sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  res.json(items);
});

app.post('/api/items', (req, res) => {
  const db = readDb();
  const { title, type, url, cover, note, readChapterNum, hiatus } = sanitizeBody(req.body);
  if (!title || !type || !url) return res.status(400).json({ error: 'Data tidak lengkap' });
  const num = toNumber(readChapterNum);
  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    title, type, url: String(url), cover: cover || '', note: note || '',
    source: hostnameOf(url),
    hiatus: hiatus === true,
    read: false,
    readChapter: '',
    readChapterNum: Number.isFinite(num) && num >= 0 ? num : -1,
    latestChapter: null,
    nextChapter: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  db.items.unshift(item);
  writeDb(db);
  res.json(item);
});

app.put('/api/items/:id', (req, res) => {
  const db = readDb();
  const item = db.items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Tidak ditemukan' });
  const body = sanitizeBody(req.body);
  if (body.readChapterNum !== undefined) {
    const num = toNumber(body.readChapterNum);
    body.readChapterNum = Number.isFinite(num) && num >= 0 ? num : -1;
  }
  // Sumber berubah (pindah mirror) -> buang tautan chapter lama, riwayat baca tetap disimpan
  if (body.url && body.url !== item.url) {
    body.latestChapter = null;
    body.nextChapter = null;
    body.latestChapterUrl = '';
    body.latestVideo = null;
  }
  Object.assign(item, body);
  item.source = hostnameOf(item.url);
  item.updatedAt = new Date().toISOString();
  writeDb(db);
  res.json(item);
});

app.delete('/api/items/:id', (req, res) => {
  const db = readDb();
  const before = db.items.length;
  db.items = db.items.filter(i => i.id !== req.params.id);
  if (db.items.length === before) return res.status(404).json({ error: 'Tidak ditemukan' });
  writeDb(db);
  res.json({ ok: true });
});

// Tandai dibaca / belum dibaca
app.post('/api/items/:id/read', (req, res) => {
  const db = readDb();
  const item = db.items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Tidak ditemukan' });
  const { read, readChapter, readChapterNum } = sanitizeBody(req.body);
  if (typeof read === 'boolean') item.read = read;
  if (readChapter !== undefined) item.readChapter = readChapter || '';
  if (readChapterNum !== undefined) {
    const num = toNumber(readChapterNum);
    item.readChapterNum = Number.isFinite(num) && num >= 0 ? num : -1;
  }
  item.updatedAt = new Date().toISOString();
  writeDb(db);
  res.json(item);
});

// Proxy gambar (mengatasi hotlink blocking + format webp)
app.get('/api/image-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('url diperlukan');
  if (!rateLimit(req.ip)) return res.status(429).send('terlalu banyak permintaan');
  const check = await validateRemoteUrl(url, { allowPrivate: ALLOW_PRIVATE_FETCH });
  if (!check.ok) return res.status(400).send(check.reason);
  try {
    const parsed = check.url;
    const referer = `${parsed.protocol}//${parsed.hostname}/`;
    const resp = await fetch(parsed.href, {
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Referer': referer,
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//i.test(contentType)) return res.status(415).send('tidak bukan gambar');
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    const buffer = await resp.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(502).send('gagal memuat gambar');
  }
});

// Ambil metadata + daftar chapter dari situs komik
app.get('/api/fetch-meta', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, error: 'url diperlukan' });
  try {
    const html = await fetchText(url);
    const $ = cheerio.load(html);

    const title = $('meta[property="og:title"]').attr('content')
      || $('meta[name="twitter:title"]').attr('content')
      || $('h1').first().text().trim()
      || $('title').text().trim()
      || '';

    const image = $('meta[property="og:image"]').attr('content')
      || $('meta[name="twitter:image"]').attr('content')
      || $('meta[property="og:image:url"]').attr('content')
      || '';

    const chapters = new Map();

    const addChapter = (href, rawText, attrTitle, releaseDate) => {
      if (!href) return;
      const absolute = resolveUrl(url, href);
      const numFromUrl = chapterNumFromUrl(absolute);
      const numFromText = toNumber(rawText);
      const numFromAttr = toNumber(attrTitle);
      let num = numFromUrl;
      if (num < 0) num = numFromText;
      if (num < 0) num = numFromAttr;
      if (num < 0) return;
      if (chapters.has(num)) return;
      const label = cleanChapterTitle(rawText || attrTitle || '', num);
      chapters.set(num, { title: label, url: absolute, num, date: releaseDate || null });
    };

    // 1) Struktur umum: daftar chapter (td.judulseries, table#daftarChapter, itemprop=url)
    $('td.judulseries a[href], a[itemprop="url"], span[itemprop="name"]').each((_i, el) => {
      const $el = $(el);
      if ($el.is('span')) return;
      const href = $el.attr('href') || '';
      const spanText = $el.find('span[itemprop="name"]').first().text().trim();
      const text = spanText || $el.text().trim();
      const attrTitle = $el.attr('title') || '';
      if (!looksLikeChapter(href, `${text} ${attrTitle}`)) return;
      const row = $el.closest('tr');
      const dateText = row.length ? row.find('td').not('.judulseries').first().text() : '';
      addChapter(href, text, attrTitle, parseReleaseDate(dateText));
    });

    // 2) Fallback: semua link yang mengandung pola chapter
    if (chapters.size === 0) {
      $('a[href]').each((_i, el) => {
        const $el = $(el);
        const href = $el.attr('href') || '';
        if (!looksLikeChapter(href, $el.text())) return;
        addChapter(href, $el.text().trim(), $el.attr('title') || '');
      });
    }

    const list = [...chapters.values()].sort((a, b) => b.num - a.num);
    const latest = list[0] || null;

    res.json({
      ok: true,
      title: title.replace(/\s*[-|]\s*(Komiku|Manga|Baca).*$/i, '').trim() || title,
      image,
      latestChapter: latest,
      chapters: list
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Ekstrak objek JSON setelah penanda (bracket balancing, aman dari string berisi "};")
function extractJsonAfter(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const open = html.indexOf('{', start + marker.length);
  if (open === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let j = open; j < html.length; j++) {
    const ch = html[j];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(open, j + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

// Ubah teks umur relatif ("4 h lalu", "3 days ago") -> menit
function parseAgeMinutes(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/ /g, ' ');
  const m = t.match(/(\d+)\s*([a-z]+)/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  const unit = m[2];
  const units = [
    [/second|detik|secs?/, 1 / 60],
    [/minute|menit|menit|mnt|min/, 1],
    [/hour|jam|^h$/, 60],
    [/day|hari|^d$/, 1440],
    [/week|minggu|pekan/, 10080],
    [/month|bulan|bln/, 43200],
    [/year|tahun|thn/, 525600]
  ];
  for (const [re, mult] of units) {
    if (re.test(unit)) return num * mult;
  }
  return null;
}

// Playlist "UU..." = uploads channel (terbaru di depan), "PL..." = playlist biasa (terbaru di belakang)
function isUploadsPlaylist(listId) {
  return /^UU/.test(listId || '');
}

// Metadata playlist YouTube + daftar video (urutan)
app.get('/api/youtube', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, error: 'url diperlukan' });
  const m = url.match(/[?&]list=([^&]+)/);
  if (!m) return res.status(400).json({ ok: false, error: 'ID playlist YouTube tidak ditemukan' });
  const listId = m[1];
  try {
    const html = await fetchText(`https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`);
    const $ = cheerio.load(html);
    const title = $('meta[property="og:title"]').attr('content')
      || $('title').text().replace(' - YouTube', '').trim()
      || 'Playlist YouTube';

    const videos = [];
    const seen = new Set();
    const pushVideo = (id, label, age) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      videos.push({ id, title: label || '', age });
    };

    const data = extractJsonAfter(html, 'var ytInitialData =')
      || extractJsonAfter(html, 'ytInitialData =')
      || extractJsonAfter(html, 'window["ytInitialData"] =');

    if (data) {
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node.playlistVideoRenderer) {
          const v = node.playlistVideoRenderer;
          const age = parseAgeMinutes(v.publishedTimeText?.simpleText || v.shortBylineText?.runs?.[0]?.text || '');
          pushVideo(v.videoId, v.title?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || '', age);
        }
        if (node.lockupViewModel) {
          const v = node.lockupViewModel;
          const id = v.contentId
            || v.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url?.match(/\/vi\/([^/]+)\//)?.[1]
            || '';
          const meta = v.metadata?.lockupMetadataViewModel || {};
          const label = meta.title?.content || meta.title?.runs?.[0]?.text || '';
          // ambil umur relatif dari baris metadata (mis. "4 h lalu" / "3 days ago")
          let age = null;
          const rows = meta.metadata?.contentMetadataViewModel?.metadataRows || [];
          for (const row of rows) {
            for (const part of row.metadataParts || []) {
              const text = part.text?.content;
              const parsed = parseAgeMinutes(text);
              if (parsed !== null) age = parsed;
            }
          }
          pushVideo(id, label, age);
        }
        for (const key of Object.keys(node)) walk(node[key]);
      };
      walk(data);
    }

    // Tentukan video terbaru: pakai umur relatif, fallback ke jenis playlist
    let latestIndex = -1;
    const withAge = videos.map((v, i) => ({ ...v, i })).filter((v) => typeof v.age === 'number');
    if (withAge.length) {
      const minAge = Math.min(...withAge.map((v) => v.age));
      const candidates = withAge.filter((v) => v.age === minAge);
      latestIndex = candidates[0].i;
    } else {
      latestIndex = isUploadsPlaylist(listId) ? 0 : videos.length - 1;
    }
    const latest = latestIndex >= 0 ? videos[latestIndex] : null;
    const newestFirst = isUploadsPlaylist(listId);

    res.json({
      ok: true,
      title,
      playlistId: listId,
      newestFirst,
      embedUrl: `https://www.youtube-nocookie.com/embed/videoseries?list=${listId}`,
      embedUrlLatest: latest
        ? `https://www.youtube-nocookie.com/embed/${latest.id}?list=${listId}&index=${latestIndex}&autoplay=1`
        : `https://www.youtube-nocookie.com/embed/videoseries?list=${listId}`,
      videoCount: videos.length,
      latestVideo: latest ? {
        id: latest.id,
        title: latest.title,
        index: latestIndex,
        url: `https://www.youtube.com/watch?v=${latest.id}`
      } : null
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  const lines = [
    '',
    `  Rak berjalan di http://${displayHost}:${PORT}`,
    `  • listen   : ${HOST} (${IS_LOOPBACK ? 'hanya perangkat ini' : 'terbuka ke jaringan'})`,
    `  • data     : ${DB_PATH}`,
    `  • auth     : ${AUTH_REQUIRED ? 'password wajib' : (IS_LOOPBACK ? 'tidak perlu (hanya loopback)' : 'DIMATIKAN (RAK_NO_AUTH=1)')}`,
    ''
  ];
  if (!AUTH_REQUIRED && !IS_LOOPBACK) {
    lines.push('  ⚠  Password dimatikan sementara.');
    lines.push('     Jangan buka server ini ke internet tanpa menyalakan password lagi');
    lines.push('     (hapus RAK_NO_AUTH=1 di .env).');
    lines.push('');
  }  if (AUTH_REQUIRED) {
    lines.push('  🔒  Rak ini dilindungi password.');
    if (generatedPassword) {
      lines.push('      Password (simpan baik-baik, hanya ditampilkan sekali):');
      lines.push('');
      lines.push(`        ${generatedPassword}`);
      lines.push('');
      lines.push('      Simpan juga di .env sebagai RAK_PASSWORD=... untuk password tetap.');
    } else {
      lines.push('      Password diatur lewat RAK_PASSWORD di .env.');
    }
    lines.push('      Halaman login: http://' + displayHost + `:${PORT}/login`);
    lines.push('');
  }
  console.log(lines.join('\n'));
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});
