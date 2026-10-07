// plugins/downloader/play.js
// Cari & unduh lagu YouTube sebagai MP3 via apiii-xrina.vercel.app/download/play.
// Hasil: audio biner (audio/mpeg) -> langsung diputar di playground.
// Kalau audio melebihi batas respons fungsi Vercel, kembalikan JSON berisi audio_url.
const UPSTREAM = "https://apiii-xrina.vercel.app/download/play";
const MAX_DURATION_SEC = 600; // 10 menit, seperti plugin asal
const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // ~4 MB, aman di bawah batas ~4.5 MB Vercel

function err(status, message) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: message }),
  };
}

// "3:45" -> 225, "1:02:03" -> 3723
function durToSec(str) {
  if (!str) return 0;
  const parts = String(str).split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

module.exports = {
  name: "play",
  category: "downloader",
  description: "Cari & unduh lagu YouTube jadi MP3 (langsung diputar di playground)",
  method: "GET",
  url: UPSTREAM,

  params: [
    { name: "q", label: "Judul Lagu", type: "text", required: true, example: "stay happy tj" },
  ],

  async run({ q }, { axios }) {
    if (!q || !q.trim()) {
      return err(400, "q diperlukan. Contoh: ?q=stay happy tj");
    }

    // 1) Ambil metadata + URL audio
    let meta;
    try {
      const res = await axios.get(UPSTREAM, {
        params: { q: q.trim() },
        timeout: 120000,
        validateStatus: () => true,
      });
      meta = res.data;
    } catch (e) {
      return err(502, "gagal cari lagu: " + (e.message || "upstream error"));
    }

    const d = meta && meta.data;
    const audioUrl = d && (d.media?.[0] || d.music);
    if (!meta || !meta.status || !audioUrl) {
      return err(404, "lagu tidak ditemukan / gagal diambil");
    }

    // 2) Batasi durasi (seperti plugin asal)
    const secs = durToSec(d.duration);
    if (secs > MAX_DURATION_SEC) {
      return err(413, `durasi lagu ${d.duration} melebihi 10 menit, download dibatalkan`);
    }

    // 3) Unduh audio
    const audioRes = await axios.get(audioUrl, {
      responseType: "arraybuffer",
      timeout: 180000,
      maxContentLength: 100 * 1024 * 1024,
      headers: {
        "User-Agent":
          "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
      },
      validateStatus: () => true,
    });

    if (audioRes.status < 200 || audioRes.status >= 300) {
      return err(502, `gagal unduh audio (HTTP ${audioRes.status})`);
    }

    const buf = Buffer.from(audioRes.data || []);
    if (buf.length < 1000) return err(502, "audio kosong / gagal diunduh");

    // 4) Terlalu besar untuk respons Vercel -> kirim URL + metadata saja
    if (buf.length > MAX_AUDIO_BYTES) {
      return {
        success: true,
        data: {
          title: d.title || q.trim(),
          duration: d.duration || null,
          cover: d.cover || null,
          audio_url: audioUrl,
          size: buf.length,
          note: "File terlalu besar untuk dikirim langsung; gunakan audio_url.",
        },
      };
    }

    // 5) Kembalikan audio biner agar playground memutarnya langsung
    const ct = String(audioRes.headers["content-type"] || "");
    return {
      status: 200,
      contentType: ct.startsWith("audio/") ? ct : "audio/mpeg",
      body: buf,
    };
  },
};
