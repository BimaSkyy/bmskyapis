// plugins/search/pinterest.js
// Cari gambar Pinterest via zellrayy.com.
// Hasil: JSON berisi daftar pin (image, url, username, dll) -> tampil sebagai JSON di playground.
const UPSTREAM = "https://zellrayy.com/search/pinterest";

// Header mirip browser: membantu lolos aturan Cloudflare pada IP datacenter (Vercel).
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
  Referer: "https://zellrayy.com/",
  Origin: "https://zellrayy.com",
};

function err(status, message) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: message }),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

    // Coba sampai 2x: retry singkat saat 403/429 (kemungkinan challenge Cloudflare).
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await axios.get(UPSTREAM, {
          params: { q: q.trim(), limit: lim, scope },
          timeout: 30000,
          headers: BROWSER_HEADERS,
          validateStatus: () => true,
        });
      } catch (e) {
        return err(502, "gagal cari pinterest: " + (e.message || "upstream error"));
      }
      if (res.status !== 403 && res.status !== 429) break;
      if (attempt === 0) await sleep(800);
    }

    if (res.status === 403 || res.status === 429) {
      return err(
        res.status === 429 ? 429 : 502,
        `upstream menolak (HTTP ${res.status}) — kemungkinan IP server diblokir Cloudflare zellrayy.com. Coba lagi nanti.`
      );
    }
    if (res.status >= 400) {
      return err(502, `upstream membalas HTTP ${res.status}`);
    }

    const data = res.data;
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
