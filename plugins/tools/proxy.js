// plugins/tools/proxy.js
// Proxy scraper & tester via Omegatech.
//   action: scrape | test
//   protocols: socks4, socks5, http, https (boleh gabung dengan koma)
//   limit: 1-10
//   speedFilter: node | medium | fast | fastest
//   testUrl: URL tujuan untuk menguji proxy (opsional)
const UPSTREAM = "https://api.omegatech.app/api/tools/Proxy";
const TIMEOUT = 120000;

const PROTOCOLS = ["socks4", "socks5", "http", "https"];
const SPEEDS = ["node", "medium", "fast", "fastest"];

function err(status, message) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: message }),
  };
}

module.exports = {
  name: "proxy",
  category: "tools",
  description: "Scrape / tes proxy (socks4, socks5, http, https) via Omegatech",
  method: "GET",
  url: UPSTREAM,
  timeout: TIMEOUT,

  params: [
    {
      name: "action",
      label: "Aksi",
      type: "select",
      options: ["scrape", "test"],
      default: "scrape",
      required: false,
    },
    {
      name: "protocols",
      label: "Protokol (boleh gabung, mis. socks5,http)",
      type: "text",
      default: "socks5",
      required: false,
      example: "socks5,http",
    },
    {
      name: "limit",
      label: "Jumlah (maks 10)",
      type: "number",
      default: "10",
      required: false,
    },
    {
      name: "speedFilter",
      label: "Filter Kecepatan",
      type: "select",
      options: SPEEDS,
      default: "medium",
      required: false,
    },
    {
      name: "testUrl",
      label: "URL Uji (opsional)",
      type: "text",
      required: false,
      example: "https://example.com",
    },
  ],

  async run({ action = "scrape", protocols = "socks5", limit = "10", speedFilter = "medium", testUrl }, { axios }) {
    try {
      const act = String(action).toLowerCase();
      if (act !== "scrape" && act !== "test") {
        return err(400, `action tidak dikenal: ${action} (pilih: scrape, test)`);
      }

      // Bersihkan daftar protokol.
      const protos = String(protocols || "socks5")
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
      const invalid = protos.filter((p) => !PROTOCOLS.includes(p));
      if (!protos.length || invalid.length) {
        return err(400, `protokol tidak valid: ${invalid.join(", ") || "(kosong)"} (pilih: ${PROTOCOLS.join(", ")})`);
      }

      const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 10);

      const sp = String(speedFilter || "medium").toLowerCase();
      if (!SPEEDS.includes(sp)) {
        return err(400, `speedFilter tidak valid: ${speedFilter} (pilih: ${SPEEDS.join(", ")})`);
      }

      const params = {
        action: act,
        protocols: protos.join(","),
        limit: lim,
        speedFilter: sp,
      };
      if (testUrl && String(testUrl).trim()) params.testUrl = String(testUrl).trim();

      const up = await axios({
        method: "GET",
        url: UPSTREAM,
        params,
        timeout: TIMEOUT,
        validateStatus: () => true,
        headers: { Accept: "application/json" },
      });

      if (up.status < 200 || up.status >= 300) {
        return err(502, `upstream membalas HTTP ${up.status}`);
      }

      return {
        status: 200,
        contentType: "application/json",
        body: typeof up.data === "string" ? up.data : JSON.stringify(up.data),
      };
    } catch (e) {
      const msg = e.code === "ECONNABORTED" ? "upstream timeout" : e.message || "gagal mengambil proxy";
      return err(502, msg);
    }
  },
};
