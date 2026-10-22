# Kontribusi

Terima kasih sudah mau membantu Rak!

## Menjalankan lokal

```sh
git clone https://github.com/mrofiq466/rak-center.git
cd rak-center
npm install
npm start
```

Butuh **Node.js 18+** dan (untuk uji browser) **Google Chrome** yang sudah terpasang.

## Sebelum mengirim pull request

Jalankan semua pemeriksaan:

```sh
npm test               # uji keamanan + autentikasi + ejaan
npm run spellcheck     # cek ejaan (kamus Indonesia + Inggris)
npm run test:browser   # uji Chrome dan Firefox (butuh server jalan)
node test-e2e.js       # uji end-to-end di Chrome
node test-youtube.js   # uji playlist YouTube (opsional)
```

Semua harus lulus dan tanpa error di console browser.

Kata-kata khusus proyek (nama class, istilah teknis, singkatan) didaftarkan di
`.cspell.json` pada bagian `words`. Tambahkan di sana kalau cspell menandai kata
yang sebenarnya sah.

### Uji di Firefox

`npm run test:browser` menjalankan skenario yang sama di Chrome **dan** Firefox.
Firefox digerakkan lewat `geckodriver` memakai **Firefox milikmu sendiri**, jadi
uji ini juga memverifikasi perilaku iframe / `X-Frame-Options` di browser yang
benar-benar kamu pakai.

```sh
brew install geckodriver   # macOS
npm run test:browser
```

Kalau `geckodriver` tidak ada di PATH, set `GECKODRIVER_PATH=/path/ke/geckodriver`.

## Gaya kode

- **JavaScript modern** (ES2022), tanpa build step, tanpa framework.
- **Tanpa dependensi baru** tanpa alasan kuat — app ini harus tetap ringan dan bisa
  di-install tanpa proses build. Dependensi runtime saat ini: `express`, `cors`, `cheerio`.
- **Server harus tetap aman secara default**: bind loopback, guard anti-SSRF untuk
  semua fetch berbasis input pengguna, dan jangan pernah menyajikan berkas di luar
  daftar putih `PUBLIC_FILES`.
- Komentar dalam bahasa Indonesia, konsisten dengan gaya kode yang ada.

## Struktur

```
server.js        # server Express + API
lib/guard.js     # guard keamanan (SSRF, sanitasi body, rate limit)
lib/auth.js      # password (scrypt) + sesi cookie
lib/browser.js   # adapter browser untuk pengujian (Puppeteer + Selenium)
app.js           # logika frontend
index.html       # kerangka halaman
login.html       # halaman login
styles.css       # style utama
styles-extra.css # style tambahan
data/            # data pengguna (diabaikan git)
```

## Menambah sumber komik baru

Deteksi chapter ada di `server.js` pada handler `/api/fetch-meta`. Cara kerjanya
mencari tautan yang mengandung pola chapter (`chapter`, `bab`, `episode`, `ch-`)
lalu mengambil nomornya dari URL, dengan cadangan ke teks tautan.

Kalau sebuah situs tidak terdeteksi, buka issue berisi:
1. URL halaman komiknya
2. Contoh struktur HTML daftar chapter-nya

Sangat membantu kalau sertakan potongan HTML (10 baris cukup).

## Data pengguna

Jangan pernah meng-commit `data/db.json` maupun `data/auth.json` — isinya riwayat
baca pribadi pengguna dan hash password. Sudah tercakup `.gitignore`, tapi tetap
tolong perhatikan.
