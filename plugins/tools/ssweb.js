// plugins/tools/ssweb.js
// Screenshot website via apiii-xrina.vercel.app/tools/ssweb (microlink).
// Pilih tampilan desktop/tablet/mobile; hasil PNG dikembalikan sebagai biner -> tampil di playground.
const UPSTREAM = "https://apiii-xrina.vercel.app/tools/ssweb";
const VIEWS = ["desktop", "tablet", "mobile"];
const MAX_BYTES = 4 * 1024 * 1024; // batas aman respons Vercel

function err(status, message) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: message }),
  };
}

module.exports = {
  name: "ssweb",
  category: "tools",
  description: "Screenshot website (desktop/tablet/mobile)",
  method: "GET",
  url: UPSTREAM,

  params: [
    { name: "url", label: "URL Website", type: "text", required: true, example: "https://google.com" },
    {
      name: "view",
      label: "Tampilan",
      type: "select",
      options: VIEWS,
      default: "desktop",
    },
  ],

  async run({ url, view = "desktop" }, { axios }) {
    if (!/^https?:\/\//i.test(url || "")) {
      return err(400, "url tidak valid (harus http/https). Contoh: ?url=https://google.com");
    }
    const mode = VIEWS.includes(view) ? view : "desktop";

    // 1) Minta metadata screenshot ke upstream
    let meta;
    try {
      const res = await axios.get(UPSTREAM, {
        params: { url },
        timeout: 60000,
        validateStatus: () => true,
      });
      meta = res.data;
    } catch (e) {
      return err(502, "gagal ambil screenshot: " + (e.message || "upstream error"));
    }

    const shot = meta && meta.data && meta.data[mode];
    if (!meta || !meta.status || !shot || !shot.url) {
      return err(502, "upstream tidak mengembalikan gambar untuk tampilan " + mode);
    }

    // 2) Unduh gambar
    const imgRes = await axios.get(shot.url, {
      responseType: "arraybuffer",
      timeout: 60000,
      maxContentLength: 20 * 1024 * 1024,
      validateStatus: () => true,
    });
    if (imgRes.status < 200 || imgRes.status >= 300) {
      return err(502, `gagal unduh gambar (HTTP ${imgRes.status})`);
    }

    const buf = Buffer.from(imgRes.data || []);
    if (buf.length < 100) return err(502, "gambar kosong");

    // 3) Terlalu besar untuk dikirim langsung -> kembalikan URL saja
    if (buf.length > MAX_BYTES) {
      return {
        success: true,
        data: {
          target: meta.target || url,
          view: mode,
          image_url: shot.url,
          width: shot.width || null,
          height: shot.height || null,
          size: buf.length,
          note: "File terlalu besar untuk dikirim langsung; gunakan image_url.",
        },
      };
    }

    const headerCt = String(imgRes.headers["content-type"] || "");
    const ct = /^image\//.test(headerCt) ? headerCt : shot.type ? `image/${shot.type}` : "image/png";
    return {
      status: 200,
      contentType: ct,
      body: buf,
    };
  },
};
