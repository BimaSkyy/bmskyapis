module.exports = {
  name: "ttsfree",
  category: "tools",
  description: "Text to Speech (OmegaTech) — ubah teks menjadi suara",
  method: "GET",
  url: "https://api.omegatech.app/api/ai/clideo",

  params: [
    { name: "text", label: "Teks", type: "textarea", required: true, example: "halo aku alesya" },
    { name: "lang", label: "Bahasa", type: "text", required: false, default: "Id", example: "Id" },
    { name: "mood", label: "Suasana", type: "text", required: false, default: "EXCITED", example: "EXCITED" },
  ],

  async run({ text, lang = "Id", mood = "EXCITED" }, { axios }) {
    if (!text?.trim()) {
      return {
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "text diperlukan" }),
      };
    }

    const apiUrl = "https://api.omegatech.app/api/ai/clideo";
    const res = await axios.get(apiUrl, {
      params: { action: "generate", text, lang, mood },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (!res.data?.success || !res.data?.data?.previewUrl) {
      return {
        status: res.status || 502,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: res.data?.error || res.data?.message || "gagal dapatkan URL audio",
        }),
      };
    }

    const previewUrl = res.data.data.previewUrl;

    // Ambil file audio MP3 dan kembalikan langsung
    const mp3Res = await axios.get(previewUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
      validateStatus: () => true,
    });

    if (mp3Res.status >= 400) {
      return {
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "gagal unduh audio" }),
      };
    }

    return {
      status: 200,
      contentType: "audio/mpeg",
      body: Buffer.from(mp3Res.data),
    };
  },
};