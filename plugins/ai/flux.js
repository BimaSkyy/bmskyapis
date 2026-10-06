const { translate } = require("@vitalets/google-translate-api");

async function idToEn(text) {
  try {
    const { text: enText } = await translate(text, { to: "en" });
    return enText;
  } catch (e) {
    return text; // pakai asli kalau gagal terjemahkan
  }
}

module.exports = {
  name: "flux",
  category: "ai",
  description: "Generate gambar dari deskripsi — prompt otomatis diterjemah ke Inggris",
  method: "GET",
  url: "https://apiii-xrina.vercel.app/ai-image/flux",

  params: [
    { name: "prompt", label: "Deskripsi Gambar", type: "textarea", required: true, example: "anime wanita dewasa bajak laut" },
  ],

  async run({ prompt }, { axios }) {
    if (!prompt?.trim()) {
      return {
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: "prompt diperlukan. Contoh: ?prompt=langit malam penuh bintang gaya anime",
        }),
      };
    }

    const enPrompt = await idToEn(prompt);

    const res = await axios.get("https://apiii-xrina.vercel.app/ai-image/flux", {
      params: { prompt: enPrompt },
      responseType: "arraybuffer",
      timeout: 180000,
      validateStatus: () => true,
    });

    if (res.status >= 400) {
      return {
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "gagal generate gambar" }),
      };
    }

    const buf = Buffer.from(res.data);
    if (buf.length < 100) {
      return {
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "respons bukan gambar" }),
      };
    }

    return {
      status: 200,
      contentType: res.headers["content-type"] || "image/jpeg",
      body: buf,
    };
  },
};