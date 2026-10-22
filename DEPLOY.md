# Deploy di Server + Cloudflare Tunnel

Rak siap dipakai di server VPS yang terhubung ke Cloudflare Tunnel.

## 1. Siapkan di server

```sh
git clone https://github.com/mrofiq466/rak-center.git
cd rak-center
npm install --omit=dev
cp .env.example .env
nano .env
```

Isi `.env`:

```env
HOST=0.0.0.0
PORT=3000
RAK_NO_AUTH=0
RAK_PASSWORD=ganti-dengan-password-kuat-miliknya
```

> `RAK_PASSWORD` wajib diisi untuk server produksi. Kalau dikosongkan, server
> membuat password acak dan menampilkannya di terminal (sekali saja).
> `RAK_NO_AUTH=0` berarti password aktif. **Jangan** diisi `1` di server publik.

## 2. Jalankan sebagai service (systemd)

Buat `/etc/systemd/system/rak.service`:

```ini
[Unit]
Description=Rak - Komik & YouTube
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/rak-center
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/home/YOUR_USER/rak-center/.env

[Install]
WantedBy=multi-user.target
```

Lalu:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now rak
sudo systemctl status rak
journalctl -u rak -f     # lihat log
```

## 3. Cloudflare Tunnel

Install `cloudflared` di server, lalu buat tunnel:

```sh
cloudflared tunnel login
cloudflared tunnel create rak
```

Edit konfigurasi tunnel (`~/.cloudflared/<TUNNEL_ID>.yml`):

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /home/YOUR_USER/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: rak.example.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

Jalankan:

```sh
cloudflared tunnel run rak
```

Atau sebagai service:

```sh
sudo cloudflared service install
sudo systemctl enable cloudflared
```

## 4. Lindungi dengan Cloudflare Access (sangat disarankan)

Karena tunnel membuat aplikasi bisa diakses publik, tambahkan **Cloudflare Access**
(Zero Trust) di depan aplikasi:

1. Dashboard Cloudflare → **Zero Trust** → **Access** → **Applications**
2. Add application → **Self-hosted** → domain `rak.example.com`
3. Policy: Allow, misalnya **Emails** (daftar email kamu) atau **One-time PIN**
4. Proteksi juga **Path**: `/api/*`

Dengan Access, hanya email yang kamu izinkan yang bisa sampai ke aplikasi — dan
password Rak menjadi lapisan kedua.

## 5. Daftar periksa keamanan server

- [ ] Firewall hanya mengizinkan SSH (22) dan Cloudflare (7844). **Jangan** buka port 3000 ke publik.
- [ ] `RAK_PASSWORD` kuat dan unik.
- [ ] `RAK_NO_AUTH=0` (password aktif).
- [ ] Cloudflare Access aktif.
- [ ] Folder `data/` tidak pernah masuk git (sudah otomatis lewat `.gitignore`).
- [ ] Cadangkan `data/db.json` secara berkala — di situ riwayat bacamu.
- [ ] Jalankan `npm test` (uji keamanan) setelah perubahan kode.

## Catatan

- Reverse proxy di tunnel meneruskan `X-Forwarded-Proto`, jadi cookie sesi otomatis
  memakai flag `Secure` saat diakses lewat HTTPS.
- Kalau kamu memakai **service token** Cloudflare untuk akses programatik, kirim
  header `CF-Access-Client-Id` dan `CF-Access-Client-Secret`; atau pakai token
  internal Rak lewat header `X-Rak-Token` (atur `RAK_TOKEN` di `.env`).
- `RAK_ALLOW_PRIVATE_FETCH=1` hanya boleh dipakai jika kamu memang ingin aplikasi
  menjangkau alamat internal (misalnya mirror komik di NAS sendiri). Sebaiknya jangan.
