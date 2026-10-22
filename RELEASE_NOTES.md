# Rak v1.0.0

Rak pertama kali dirilis publik. Dashboard lokal untuk menyimpan tautan komik dan
playlist YouTube dalam satu rak — tanpa akun, tanpa cloud, tanpa telemetri.

## Fitur

### Koleksi & riwayat baca

- Semua koleksi dan progress disimpan di `data/db.json` **di perangkat sendiri**.
- Chapter **pertama yang belum dibaca** yang ditunjuk, bukan yang terbaru.
  Contoh: sudah baca Chapter 28, lalu ada Chapter 29 & 30 → app menunjuk **Chapter 29**.
- Status **Belum dibaca** / **Sudah dibaca** per koleksi, dengan badge di kartu.
- Pencarian & filter (Semua / Komik / YouTube / HaHiatus).

### Perbarui dari sumber

Server mengambil daftar chapter dari situs komik yang kamu daftarkan, lalu menentukan
chapter pertama yang belum dibaca. Didukung parsing `table#daftarChapter`,
`td.judulseries`, `itemprop="url"`, dan pola umum `chapter` / `bab` / `episode`.

### Rak HaHiatus

Komik yang lama tidak update atau sedang disingkirkan bisa dipindahkan ke rak
terpisah lewat ikon **⏸**, sehingga tidak memenuhi halaman utama. Peringatan
"**sudah N hari tidak update**" muncul otomatis bila rilis terakhir sudah > 30 hari.

### Playlist YouTube

- Video **terbaru** dideteksi dari metadata umur tiap video — benar untuk playlist
  *uploads* (terbaru di depan) maupun playlist manual (terbaru di belakang).
- Diputar dari video terbaru dengan antrean playlist tetap aktif.
- Status **Belum ditonton** / **Sudah ditonton** + posisi video terakhir diputar.

### Panel baca

- Memenuhi layar, bukan dialog kecil.
- Zoom 35%–300%, paskan lebar, layar penuh. Level zoom tersimpan otomatis.
- Pintasan keyboard: `+` `−` zoom, `0` reset, `F` layar penuh, `W` paskan lebar, `Esc` tutup.

### Rak Support

Kode QRIS untuk mendukung pengembangan, bisa dibuka dari menu **Rak Support**.
Ganti dengan QRIS-mu sendiri lewat `RAK_QRIS_FILE`.

### Ganti sumber / mirror

Kalau situs komik down, ikon **⇄** mengganti URL ke mirror lain. **Riwayat baca
tetap ikut** dan chapter langsung dideteksi ulang dari situs baru.

## Keamanan

- Server default `0.0.0.0`; password **wajib** di mode server
  (hash scrypt + sesi cookie HttpOnly/SameSite=Strict, rate limit login).
- `RAK_NO_AUTH=1` untuk mematikan password sementara.
- Guard **anti-SSRF** untuk proxy gambar & scraping: menolak IP privat, loopback,
  cloud metadata, dan hostname internal (cek DNS anti-rebinding).
- **Anti prototype pollution** pada body request.
- Berkas proyek memakai **daftar putih** — `data/db.json`, `.env`, dan `server.js`
  tidak bisa diunduh lewat HTTP.
- Rate limit 40 req/menit untuk proxy gambar, body dibatasi 256 KB.

Rincian lengkap: [SECURITY.md](SECURITY.md) · Panduan server: [DEPLOY.md](DEPLOY.md)

## Pasang

```sh
git clone https://github.com/mrofiq466/rak-center.git
cd rak-center
npm install
npm start
```

Buka <http://localhost:3000>. Butuh **Node.js 18+**.

## Pengujian

```sh
npm test              # keamanan + autentikasi
npm run test:browser  # Chrome & Firefox
npm run test:e2e
```

Butuh Google Chrome (Puppeteer) dan `geckodriver` (Selenium/Firefox).

## Lisensi

MIT — bebas dipakai, diubah, dan dibagikan.

## Terima kasih

Terima kasih sudah dipakai & didukung lewat QRIS. Reported bug dan pull request
sangat diterima di [Issues](https://github.com/mrofiq466/rak-center/issues).
