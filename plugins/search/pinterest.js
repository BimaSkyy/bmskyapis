// plugins/search/pinterest.js
// Cari gambar Pinterest via zellrayy.com.
// Hasil: JSON berisi daftar pin (image, url, username, dll) -> tampil sebagai JSON di playground.
const UPSTREAM = "https://zellrayy.com/search/pinterest";

function err(status, message) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: message }),
  };
}

module.exports = {
  name: "pinterest",
  category: "search",
  description: "Cari gambar Pinterest",
  method: "GET",
  url: UPSTREAM,

  params: [
    { name: "q", label: "Kata Kunci", type: "text", required: true, example: "girls" },
    {
      name: "limit",
      label: "Jumlah",
      type: "select",
      options: ["5", "10", "15", "20"],
      default: "5",
    },
    {
      name: "scope",
      label: "Scope",
      type: "select",
      options: ["pins", "boards"],
      default: "pins",
    },
  ],

  async run({ q, limit = "5", scope = "pins" }, { axios }) {
    if (!q || !q.trim()) {
      return err(400, "q diperlukan. Contoh: ?q=girls");
    }

    const lim = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 50);

    let res;
    try {
      res = await axios.get(UPSTREAM, {
        params: { q: q.trim(), limit: lim, scope },
        timeout: 30000,
        validateStatus: () => true,
      });
    } catch (e) {
      return err(502, "gagal cari pinterest: " + (e.message || "upstream error"));
    }

    const data = res.data;
    if (res.status >= 400) {
      return err(502, `upstream membalas HTTP ${res.status}`);
    }
    if (!data || !data.status || !Array.isArray(data.result) || data.result.length === 0) {
      return err(404, "tidak ada hasil untuk: " + q.trim());
    }

    const items = data.result
      .filter((it) => it && it.image)
      .slice(0, lim)
      .map((it) => ({
        title: it.title || q.trim(),
        image: it.image,
        video: it.video || null,
        username: it.username || null,
        fullName: it.fullName || null,
        url: it.url || null,
      }));

    if (items.length === 0) {
      return err(404, "hasil tidak punya gambar");
    }

    return {
      success: true,
      data: {
        query: data.query || q.trim(),
        count: items.length,
        result: items,
      },
    };
  },
};
