# Vanz License — Website License Pribadi

Website pribadi untuk generate & validasi license key script kamu.
Tampilan putih bersih + biru, cuma kamu yang bisa akses (gerbang kunci rahasia).

## 1. Setup Awal

```bash
npm install
cp .env.example .env
```

Edit `.env`, isi 3 nilai wajib:
- `ADMIN_SECRET_KEY` → kunci buat kamu login ke dashboard lewat browser
- `BOT_API_KEY` → kunci buat bot (developer & buyer) akses API Vanz
- `SESSION_SECRET` → string acak buat enkripsi session login

```bash
npm start
```

Buka `http://localhost:3000` → akan diarahkan ke halaman login → masukkan `ADMIN_SECRET_KEY`.

## 2. Deploy ke Hosting

Website ini **butuh proses yang jalan terus** (bukan serverless) karena pakai session login biasa.
Jadi **jangan di Vercel** — pakai:
- **Railway** / **Render** (ada free tier, tinggal connect repo)
- VPS kamu sendiri (pasang PM2 biar auto-restart: `pm2 start server.js --name vanz`)

Set environment variables yang sama seperti di `.env` lewat dashboard hosting-nya (jangan upload file `.env` ke GitHub!).

## 3. Dashboard

- **Generate License Manual** — buat key manual (misal buat testing atau request khusus).
- **Daftar License** — lihat semua key: buyer, produk, status (Aktif/Expired/Direvoke), tombol Revoke.
- Key otomatis ke-bind ke 1 HWID (device) begitu dipakai pertama kali — gak bisa dipindah ke server lain tanpa kamu reset manual (hapus `hwid` di `data/licenses.json`, atau generate key baru + revoke yang lama).

## 4. Integrasi dengan Bot

### a) Bot DEVELOPER (saat ACC order script → minta Vanz generate key)

```js
const response = await fetch('https://vanz-kamu.up.railway.app/api/generate', {
    method: 'POST',
    headers: {
        'content-type': 'application/json',
        'X-Bot-Key': 'ISI_SAMA_DENGAN_BOT_API_KEY_DI_ENV'
    },
    body: JSON.stringify({ buyer: 'Nama Buyer', product: 'Script FULL UPDATE', durationDays: 30 })
});
const data = await response.json();
// data.key        -> kode license buat dikirim ke buyer
// data.expiredAt  -> tanggal expired
```

### b) Bot BUYER (vanzky-guard — validasi tiap bot start)

```js
const response = await fetch('https://vanz-kamu.up.railway.app/api/validate', {
    method: 'POST',
    headers: {
        'content-type': 'application/json',
        'X-Bot-Key': 'ISI_SAMA_DENGAN_BOT_API_KEY_DI_ENV'
    },
    body: JSON.stringify({ key: 'VANZ-XXXX-XXXX-XXXX', hwid: 'fingerprint-server' })
});
const data = await response.json();
// data.ok -> true/false
```

Kedua integrasi ini **sudah saya pasang otomatis** di `vanzky-guard/vanzky-core.js` dan `index.js` pada paket bot Developer & Buyer yang saya kirim bersamaan ini. Kamu tinggal ganti 2 nilai di `vanzky-core.js`:
```js
const VANZ_BASE_URL = 'https://vanz-kamu.up.railway.app'; // URL Vanz setelah deploy
const VANZ_BOT_KEY  = 'ISI_SAMA_DENGAN_BOT_API_KEY_DI_ENV';
```

## 5. Keamanan

- `ADMIN_SECRET_KEY` dan `BOT_API_KEY` itu 2 kunci BERBEDA dengan tujuan beda — jangan disamakan.
- Jangan pernah commit file `.env` ke GitHub publik.
- `data/licenses.json` adalah database kamu — backup berkala kalau penting.
