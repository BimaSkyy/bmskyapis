---
name: bmskyapis
description: Aturan dan alur kerja proyek BmSkyApis (REST API di Vercel dengan halaman playground). Gunakan skill ini setiap kali user minta menambah, mengubah, atau memperbaiki fitur/endpoint API, tampilan web, rate limit, atau minta deploy proyek ini, walaupun user tidak menyebut nama proyeknya.
---

# BmSkyApis

REST API sederhana di Vercel. Backend berupa serverless function Node.js (CommonJS), frontend satu file HTML statis.
Repo: https://github.com/BimaSkyy/bmskyapis. Folder kerja di Termux: `~/webApiVercel`.
Setiap `git push` ke branch `main` otomatis dideploy oleh Vercel.

## Struktur (jangan diubah)

```
api/_lib/guard.js      rate limit anti-spam + helper fail()
api/<kategori>/<nama>.js   satu file = satu endpoint  -> /api/<kategori>/<nama>
public/index.html      halaman: kategori -> daftar fitur -> panel Playground
package.json, vercel.json
```

Folder `api/` dan `public/` harus langsung di root repo. Nama file huruf kecil semua (Vercel peka huruf besar-kecil). File di `api/_lib/` tidak menjadi route.

## Menambah fitur baru (3 langkah)

### 1. Buat `api/<kategori>/<nama>.js`

Ikuti pola `api/ai/gemini.js` / `text2video.js`. Kerangka minimal:

```js
'use strict';
const { rateLimit, fail } = require('../_lib/guard');

const UPSTREAM = 'https://...';
const UPSTREAM_TIMEOUT_MS = 55 * 1000;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Gunakan metode GET.');
  }

  if (!rateLimit(req, res, '<nama>')) return;   // wajib, nama unik per endpoint

  // validasi parameter (tipe string, panjang dibatasi) -> fail(res, 400, 'INVALID_PARAMETER', '...')
  // panggil upstream dengan fetch + AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  //   timeout -> fail(res, 504, 'TIMEOUT', ...)
  //   gagal   -> fail(res, 502, 'UPSTREAM_ERROR' / 'GENERATE_FAILED', ...)
  // sukses:
  return res.status(200).json({ success: true, data: { /* ... */ } });
};
```

Aturan:
- Hanya metode GET. Format sukses `{ success: true, data: {...} }`, gagal `{ success: false, error: { code, message } }` (pakai `fail()`).
- Pakai `fetch` bawaan Node, bukan axios, kecuali memang perlu module. Kalau perlu module: `npm install <nama>` supaya tercatat di `package.json`.
- Semua input dari query harus divalidasi: pastikan bertipe string, batasi panjang, buang karakter kontrol, whitelist untuk nilai pilihan (seperti `ratio`, `lang`).
- URL upstream, model, dan kunci rahasia hanya ada di server. Jangan kirim ke client dan jangan tulis token/API key di kode atau repo (pakai Environment Variables Vercel).
- Pesan error dari upstream jangan diteruskan mentah kecuali sudah dipastikan berupa string biasa.
- Jangan ubah angka rate limit di `guard.js` kecuali user memintanya.

### 2. Daftarkan di array `ENDPOINTS` di `public/index.html`

```js
{
  id: 'nama',
  category: 'ai',                 // kategori baru otomatis muncul sebagai baris baru
  title: 'Judul Fitur',
  method: 'GET',
  path: '/api/ai/nama',
  result: { type: 'video' | 'audio' | 'text', field: 'namaFieldDiData', label: 'kata untuk "Membuat ..."' },
  params: [
    { name: 'text', type: 'textarea', label: 'Teks', required: true, max: 500, min: 1, placeholder: '...', value: 'contoh' },
    { name: 'lang', type: 'input', label: 'Bahasa', limit: 20, value: 'Id' },
    { name: 'ratio', type: 'select', label: 'Rasio', value: 'auto', options: [['auto', 'Otomatis'], ['16:9', '16:9']] }
  ]
}
```

- `result.type`: `video` dan `audio` mengharapkan `data[field]` berupa URL `https://`; `text` mengharapkan string.
- Kalau kategori punya singkatan yang harus huruf besar (misalnya `ai` jadi `AI`), tambahkan di objek `LABELS`.
- Kalau jenis hasil baru belum didukung (misalnya gambar), tambahkan penanganannya di `createPlayground` di file yang sama.

### 3. Cek lalu deploy

```
node --check api/<kategori>/<nama>.js
git add -A && git commit -m "tambah fitur <nama>" && git push
```

Setelah push, Vercel deploy otomatis. Jangan commit `node_modules`, `.vercel`, atau file `.env` (pastikan ada di `.gitignore`).

## Aturan tampilan

Web harus tetap bersih dan ringan: judul, daftar kategori, klik kategori membuka list fitur, klik fitur membuka Playground. Jangan menambah blok teks, banner, atau dokumentasi panjang di halaman. Satu file HTML, tanpa library eksternal selain font yang sudah ada.

## Kalau ada masalah

- 404 HTML dari Vercel pada `/api/...`: file endpoint belum ter-deploy, salah folder, atau nama file salah huruf besar-kecil.
- 429: kena rate limit (3/menit, 20/jam per IP, spam berulang diblokir 10 menit). Itu perilaku normal, bukan bug.
- 502 `GENERATE_FAILED`/`UPSTREAM_ERROR`: masalah di API upstream, bukan di route.
