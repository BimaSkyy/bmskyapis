// plugins/tools/transkripsi.js
// Transkripsi audio/video ke teks via apiii-xrina.vercel.app/tools/transkripsi.
// Masukkan URL media (http/https); hasil JSON disederhanakan: language, text, segments.
const UPSTREAM = "https://apiii-xrina.vercel.app/tools/transkripsi";

function err(status, message) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: message }),
  };
}

module.exports = {
  name: "transkripsi",
  category: "tools",
  description: "Transkripsi audio/video jadi teks (dengan timestamp)",
  method: "GET",
  url: UPSTREAM,

  params: [
    {
      name: "url",
      label: "URL Media (audio/video)",
      type: "text",
      required: true,
      example: "https://u.pone.rs/kxxnsnjd.opus",
    },
  ],

  async run({ url }, { axios }) {
    if (!/^https?:\/\//i.test(url || "")) {
      return err(400, "url tidak valid (harus http/https). Contoh: ?url=https://u.pone.rs/kxxnsnjd.opus");
    }

    let res;
    try {
      res = await axios.get(UPSTREAM, {
        params: { url },
        timeout: 180000,
        validateStatus: () => true,
      });
    } catch (e) {
      return err(502, "gagal transkripsi: " + (e.message || "upstream error"));
    }

    const payload = res.data;
    if (res.status >= 400 || !payload || !payload.status) {
      return err(502, `upstream gagal (HTTP ${res.status})`);
    }

    const raw = payload.data && payload.data.raw;
    const result = raw && raw.result;
    if (!result || !result.text) {
      return err(502, raw && raw.failureReason ? `gagal: ${raw.failureReason}` : "tidak ada hasil transkripsi");
    }

    const segments = Array.isArray(result.segments)
      ? result.segments.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
        }))
      : [];

    return {
      success: true,
      data: {
        language: payload.data.language || raw.languageCode || null,
        duration: raw.duration || null,
        text: result.text,
        segments,
      },
    };
  },
};
