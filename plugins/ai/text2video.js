// plugins/ai/text2video.js
// Buat video dari teks (AI) via Omegatech API.
// Generasi video lama (bisa puluhan detik), jadi timeout dibuat 120 detik.
module.exports = {
  name: "text2video",
  category: "ai",
  description: "Buat video dari teks (AI)",
  method: "GET",
  url: "https://api.omegatech.app/api/ai/Txt2video", // dipakai sebagai penanda; logika ada di run()
  timeout: 120000,

  params: [
    { name: "prompt", label: "Prompt", type: "textarea", required: true, example: "a cow in city" },
    { name: "ratio", label: "Rasio", type: "select", options: ["auto", "16:9", "9:16"], default: "auto" },
    { name: "sound", label: "Suara", type: "select", options: ["true", "false"], default: "true" },
  ],

  async run({ prompt, ratio, sound }, { axios }) {
    const r = await axios.get("https://api.omegatech.app/api/ai/Txt2video", {
      params: { action: "generate", prompt, ratio, sound },
      timeout: 120000,
      validateStatus: () => true,
    });

    const body = r.data;
    const videoUrl = body && body.success && body.data && body.data.videoUrl;

    if (!videoUrl) {
      return {
        status: r.status >= 400 ? r.status : 502,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "Gagal membuat video dari prompt tersebut." }),
      };
    }

    return { success: true, data: { videoUrl, prompt } };
  },
};
