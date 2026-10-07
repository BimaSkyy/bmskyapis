---
name: bmskyapis
description: Aturan dan alur kerja proyek BmSkyApis (REST API di Vercel dengan sistem plugin dan halaman playground). Gunakan skill ini setiap kali user minta menambah, mengubah, atau memperbaiki endpoint/plugin API, tampilan web, atau minta deploy proyek ini, walaupun user tidak menyebut nama proyeknya.
---

# BmSkyApis

REST API di Vercel berbasis plugin. Satu server Express memuat semua file di `plugins/` secara otomatis, dan satu file HTML statis menjadi playground.
Repo: https://github.com/BimaSkyy/bmskyapis. Folder kerja di Termux: `~/webApiVercel`.
Setiap `git push` ke branch `main` otomatis dideploy oleh Vercel.

## Struktur (jangan diubah)

```
api/index.js              pintu masuk Vercel, hanya me-require ../server
server.js                 loader plugin + route /api/:name dan /meta/plugins
plugins/<kategori>/<nama>.js   satu file = satu endpoint -> /api/<nama>
plugins/_templates.js     contoh/kerangka (awalan "_" diabaikan loader)
public/index.html         playground, daftar fitur dibaca dari /meta/plugins
package.json, vercel.json
```

Endpoint berbentuk `/api/<name>` (bukan `/api/<kategori>/<nama>`). Kategori hanya untuk pengelompokan di web, diambil dari field `category` atau nama folder. `name` harus unik. Nama file huruf kecil semua.

## Menambah endpoint baru

Cukup SATU langkah: buat `plugins/<kategori>/<nama>.js`. Tidak perlu mengedit `server.js` atau `public/index.html`; web membaca daftar plugin otomatis. Salin dari `plugins/_templates.js`.

### Mode 1: proxy sederhana (deklaratif)

Dipakai kalau upstream tinggal diteruskan apa adanya dan semua parameter berasal dari user.

```js
module.exports = {
  name: "deepai",
  category: "ai",
  description: "Ask anything to DeepAI",
  method: "GET",                       // GET (default) atau POST
  url: "https://example.com/api",
  timeout: 60000,                      // opsional
  headers: {},                         // opsional
  params: [
    { name: "text", label: "Question", required: true, example: "hello" },
  ],
};
```

Field `params`: `name`, `label`, `type` (`text` | `number` | `textarea` | `select` dengan `options`), `required` (default true; `false` = opsional), `default`, `example`, dan `key` (nama parameter di upstream kalau beda dari `name`).

### Mode 2: logika kustom (`run`)

Dipakai kalau upstream butuh parameter tetap (misalnya `action=generate`), perlu memproses/menyaring respons, atau mengembalikan data biner.

```js
async run({ prompt, ratio }, { axios, req }) {
  const r = await axios.get("https://example.com/api", {
    params: { action: "generate", prompt, ratio },
    timeout: 120000,
    validateStatus: () => true,
  });
  // 1) kembalikan nilai biasa -> dikirim sebagai JSON
  return { success: true, data: { ... } };
  // 2) atau respons mentah/biner:
  // return { status: 200, contentType: "video/mp4", body: Buffer.from(r.data) };
}
```

Kalau `run` ada, `url` tetap wajib diisi (loader menolak plugin tanpa `url` dan tanpa `run`); isi dengan URL upstream sebagai penanda.

### Aturan

- Hanya `axios` yang tersedia lewat argumen kedua `run`. Modul lain: `npm install <nama>` agar tercatat di `package.json`.
- Parameter yang masuk ke `run` selalu berupa string. Server sudah mengecek `required` dan mengisi `default`, tapi tetap batasi panjang/whitelist nilai penting sendiri.
- URL upstream, token, dan API key tidak boleh bocor ke client. Simpan rahasia di Environment Variables Vercel (`process.env.X`), jangan di kode atau repo.
- Error upstream: `validateStatus: () => true` lalu kembalikan `{ status, contentType: "application/json", body: JSON.stringify({ success: false, error: "..." }) }`. Jangan teruskan pesan mentah upstream kecuali sudah pasti string biasa. Exception yang tidak ditangani otomatis menjadi 502.
- Format JSON sukses: `{ success: true, data: {...} }`.
- Tidak ada rate limit bawaan di server saat ini. Jangan menambahkannya kecuali user minta.
- Perubahan file plugin terbaca otomatis tanpa restart (loader memeriksa waktu modifikasi tiap request).

## Playground (public/index.html)

Web menampilkan hasil berdasarkan `Content-Type` respons: `image/*`, `video/*`, `audio/*` dirender langsung; JSON/teks ditampilkan sebagai teks; sisanya jadi link unduh. Artinya:

- Plugin yang hanya mengembalikan JSON berisi URL (misalnya `videoUrl`) tampil sebagai JSON di playground, bukan pemutar video.
- Untuk pemutar langsung, `run` harus mengembalikan byte dengan `contentType` media. Hati-hati: fungsi serverless Vercel punya batas ukuran respons sekitar 4,5 MB, jadi file besar lebih aman dikembalikan sebagai URL.

Aturan tampilan: web tetap bersih dan ringan, satu file HTML, tanpa library eksternal. Jangan menambah banner atau blok dokumentasi panjang.

## Deploy

```
node --check plugins/<kategori>/<nama>.js
git add -A && git commit -m "tambah plugin <nama>" && git push
```

`vercel.json` sudah menyertakan `plugins/**` lewat `includeFiles` dan merewrite `/api/*` dan `/meta/*` ke `api/index.js`. Jangan hapus itu. Jangan commit `node_modules`, `.vercel`, atau `.env`.

Untuk plugin yang lama (video AI dan sejenisnya): fungsi Vercel punya batas durasi sesuai paket. Kalau sering timeout, atur `maxDuration` untuk `api/index.js` di bagian `functions` pada `vercel.json` sesuai batas paketmu.

## Kalau ada masalah

- `404 {"error":"Plugin not found"}`: file plugin salah folder, namanya diawali "_", `name` tidak cocok dengan URL, atau belum ter-deploy. Cek log `[plugin] skipped ...`.
- `400 Missing parameter`: parameter wajib belum dikirim.
- `502`: upstream gagal atau timeout, bukan masalah di route.
- Plugin tidak muncul di web: ada error saat dimuat (cek log), atau `/meta/plugins` tidak ter-rewrite.
