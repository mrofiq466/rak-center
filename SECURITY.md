# Keamanan

## Model Ancaman

Rak adalah aplikasi **lokal-first**. Setiap pengguna menjalankan servernya sendiri di
komputernya sendiri. Tidak ada akun, tidak ada cloud, tidak ada telemetri.

- **Data pengguna** (koleksi komik, riwayat baca) hanya ada di `data/db.json` di
  komputer pengguna. Tidak pernah dikirim ke server kami — memang tidak ada server kami.
- **Tidak ada dependensi runtime yang mengirim data ke pihak ketiga**, kecuali ke
  situs komik / YouTube yang **kamu sendiri** daftarkan (untuk mengambil judul,
  daftar chapter, dan gambar sampul).

### Dua mode operasional

| Mode | Konfigurasi | Autentikasi | Cocok untuk |
|---|---|---|---|
| **Lokal** | `HOST=127.0.0.1` | Tidak ada password | Dipakai sendiri di laptop |
| **Server** | `HOST=0.0.0.0` | **Password wajib** | VPS + Cloudflare Tunnel |

Mode server **wajib** memakai password. Alasannya: begitu aplikasi bisa dijangkau
publik (mis. lewat tunnel), siapa pun bisa membuka halaman. Token yang
disisipkan ke HTML ternyata **bocor ke pembaca halaman**, jadi token HTML tidak
cukup jadi satu-satunya proteksi. Karena itu mode server memakai password gate
sungguhan, bukan token HTML.

## Yang Dilakukan

| Ancaman | Mitigasi |
|---|---|
| Server dapat diakses tanpa izin | Mode server mewajibkan **password** (hash scrypt, `data/auth.json`). Halaman `/` dialihkan ke `/login`, seluruh `/api/*` menolak request tanpa sesi valid. |
| Sesi dipalsukan | Cookie sesi `rak_session` ditandatangani HMAC-SHA256 dengan secret per-install, diverifikasi dengan `timingSafeEqual`, dan punya masa berlaku 14 hari. |
| Serangan brute force | Login dibatasi 12 percobaan per IP per 15 menit. |
| Pencurian cookie | Cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` otomatis saat HTTPS). |
| Bocornya password | Password tidak pernah disimpan plaintext; `data/auth.json` dan `.env` tidak bisa diunduh lewat HTTP. |
| SSRF lewat proxy gambar / scrape | `lib/guard.js`: hanya `http`/`https`, tolak IP loopback/private/link-local/metadata cloud, cek DNS untuk menutupi DNS rebinding, tolak hostname internal. |
| Prototype pollution | `sanitizeBody()` membuang `__proto__` / `constructor` / `prototype` secara rekursif. |
| Kebocoran berkas proyek | Halaman statis memakai **daftar putih** (`PUBLIC_FILES`); `data/db.json`, `server.js`, dan `.env` tidak dapat diunduh lewat HTTP. |
| Penyalahgunaan proxy | Rate limit 40 permintaan/menit per IP + batas ukuran body 256 KB. |
| Request tanpa batas | `express.json({ limit: '256kb' })`. |

## Lapisan tambahan untuk server publik

Untuk deployment lewat Cloudflare Tunnel, aktifkan juga **Cloudflare Access**
(Zero Trust) sehingga hanya email yang kamu izinkan yang bisa menjangkau aplikasi.
Panduan lengkap ada di [DEPLOY.md](DEPLOY.md).

## Konfigurasi

| Variabel | Default | Arti |
|---|---|---|
| `PORT` | `3000` | Port server |
| `HOST` | `0.0.0.0` | Alamat listen. `127.0.0.1` = mode lokal tanpa password. |
| `RAK_PASSWORD` | acak (dibuat saat pertama jalan) | Password Rak. Kalau diisi, selalu menggantikan hash yang tersimpan. |
| `RAK_TOKEN` | kosong | Token untuk akses programatik lewat header `X-Rak-Token`. |
| `RAK_NO_AUTH` | kosong | Set `1` untuk mematikan password (jangan di server publik). |
| `RAK_ALLOW_PRIVATE_FETCH` | `0` | Set `1` hanya jika kamu memang ingin app menjangkau alamat internal (mis. komik di NAS sendiri). |

Semua variabel bisa ditulis di file `.env` (sudah masuk `.gitignore`).

## Melaporkan Kerentanan

Jika menemukan masalah keamanan, buka issue publik di repo ini (kecualiidityanya
berpotensi merusak, laporkan lewat pesan pribadi terlebih dahulu).

Before sharing, please run the security tests:

```sh
node test-security.js
```

## Catatan untuk Pengguna

- Jangan pernah meng-commit `data/db.json` — isinya riwayat baca pribadi.
  Sudah tercakup di `.gitignore`.
- Kalau memakai `HOST=0.0.0.0`, isi token yang ditampilkan di terminal saat server
  started. Token juga bisa diatur sendiri lewat `RAK_TOKEN`.
