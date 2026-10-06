module.exports = {
  name: "clara",
  category: "ai",
  description: "Chat dengan AI Clara — ngobrol santai",
  method: "GET",
  url: "https://apiii-xrina.vercel.app/ai/clara",

  params: [
    { name: "text", label: "Pertanyaan/Pesan", type: "textarea", required: true, example: "halo Clara, apa kabar?" },
  ],

  async run({ text }, { axios }) {
    if (!text?.trim()) {
      return {
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: "text diperlukan. Contoh: ?text=halo Clara, apa kabar?",
        }),
      };
    }

    const res = await axios.get("https://apiii-xrina.vercel.app/ai/clara", {
      params: { text },
      timeout: 30000,
      validateStatus: () => true,
    });

    const responseText = res.data?.data?.response || res.data?.response;

    if (!responseText) {
      return {
        status: res.status >= 400 ? res.status : 502,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: res.data?.message || "Clara tidak memberi respons",
        }),
      };
    }

    return {
      success: true,
      data: { response: responseText },
    };
  },
};