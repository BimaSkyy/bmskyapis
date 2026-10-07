// plugins/tools/removebg.js
// Hapus background gambar via iloveimg.com.
// Parameter wajib: url gambar (http/https). Hasil: PNG transparan (biner) -> tampil langsung di playground.
const FormData = require("form-data");
const axios = require("axios");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PAGE_URL = "https://www.iloveimg.com/remove-background";

const SERVERS = [
  "api1g", "api2g", "api3g", "api8g", "api9g", "api10g", "api11g", "api12g", "api13g", "api14g",
  "api15g", "api16g", "api17g", "api18g", "api19g", "api20g", "api21g", "api22g", "api24g", "api25g",
];

const TASK =
  "r68zl88mq72xq94j2d5p66bn2z9lrbx20njsbw2qsAvgmzr11lvfhAx9kl87pp6yqgx7c8vg7sfbqnrr42qb16v0gj8jl5s0kq1kgp26mdyjjspd8c5A2wk8b4Adbm6vf5tpwbqlqdr8A9tfn7vbqvy28ylphlxdl379psxpd8r70nzs3sk1";
const HTTP_TIMEOUT_MS = 45_000;
const GPU_TIMEOUT_MS = 180_000;
const TOKEN_TTL_MS = 10 * 60_000;
const MAX_RETRIES = 3;

const sessionCache = new Map();

function parseConfig(html) {
  const text = typeof html === "string" ? html : Buffer.from(html || "").toString();
  let token = null;
  let cfg = null;
  const cfgIdx = text.indexOf("ilovepdfConfig");
  if (cfgIdx !== -1) {
    const objStart = text.indexOf("{", cfgIdx);
    const objEnd = text.indexOf("};", objStart);
    if (objStart !== -1 && objEnd !== -1) {
      try {
        cfg = JSON.parse(text.slice(objStart, objEnd + 1));
        token = cfg?.token || null;
      } catch {}
    }
  }
  const csrf =
    text.match(/<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i)?.[1] || null;
  return { token, csrf, servers: Array.isArray(cfg?.servers) && cfg.servers.length ? cfg.servers : null };
}

async function getTokenInfo(force = false, pageUrl = PAGE_URL) {
  const now = Date.now();
  const hit = sessionCache.get(pageUrl);
  if (!force && hit?.token && hit?.csrf && now - hit.ts < TOKEN_TTL_MS) {
    return { token: hit.token, csrf: hit.csrf, servers: hit.servers };
  }
  const res = await axios.get(pageUrl, { timeout: 15_000, headers: { "User-Agent": UA, Accept: "text/html" } });
  const { token, csrf, servers } = parseConfig(res.data);
  if (!token || !csrf) throw new Error("Token/CSRF gagal diambil dari iloveimg.com (mungkin sedang down)");
  sessionCache.set(pageUrl, { token, csrf, servers, ts: now });
  return { token, csrf, servers };
}

function buildHeaders(token, csrf, multipart) {
  return {
    Authorization: `Bearer ${token}`,
    Origin: "https://www.iloveimg.com/",
    Cookie: `_csrf=${csrf}`,
    "User-Agent": UA,
    ...(multipart ? multipart.getHeaders() : {}),
  };
}

function classifyError(err) {
  const st = err?.response?.status;
  if (st === 401 || st === 403) return "auth";
  if (st === 429) return "rate";
  if (st && st >= 500) return "server";
  if (/unauthorized|forbidden|invalid token/i.test(String(err?.message || ""))) return "auth";
  return null;
}

function pickServer(pool = SERVERS, used = []) {
  const avail = pool.filter((s) => !used.includes(s));
  const src = avail.length ? avail : pool;
  if (!src.length) return null;
  return src[Math.floor(Math.random() * src.length)];
}

async function postToTool({ server, path, token, csrf, form, timeout, responseType }) {
  const res = await axios.post(`https://${server}.iloveimg.com/v1/${path}`, form, {
    headers: buildHeaders(token, csrf, form),
    responseType,
    timeout,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) {
    const body =
      responseType === "arraybuffer" ? Buffer.from(res.data || []).toString("utf8") : JSON.stringify(res.data);
    const e = new Error(`HTTP ${res.status} pada /v1/${path}: ${String(body).slice(0, 200)}`);
    e.response = { status: res.status };
    throw e;
  }
  return res;
}

function buildUploadForm(fileName) {
  const form = new FormData();
  form.append("name", fileName);
  form.append("chunk", "0");
  form.append("chunks", "1");
  form.append("task", TASK);
  form.append("preview", "1");
  return form;
}

const RM_BG_MAX_BYTES = 2 * 1024 * 1024;
const RM_BG_MAX_PIXELS = 4_403_200;
const RM_BG_MIME = "image/jpeg,image/jpg,image/png";
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function inspectPng(buf) {
  if (!buf || buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function uploadForRmBg({ server, token, csrf, buffer, fileName, contentType }) {
  const form = buildUploadForm(fileName);
  form.append("file", buffer, { filename: fileName, contentType: contentType || "image/jpeg" });
  const res = await postToTool({ server, path: "upload", token, csrf, form, timeout: HTTP_TIMEOUT_MS });
  const serverFilename = res.data?.server_filename;
  if (!serverFilename) throw new Error("Upload gagal: server_filename tidak ada di response");
  return serverFilename;
}

async function requestRemoveBackground({ server, token, csrf, serverFilename }) {
  const form = new FormData();
  form.append("task", TASK);
  form.append("server_filename", serverFilename);
  const res = await postToTool({
    server,
    path: "removebackground",
    token,
    csrf,
    form,
    timeout: GPU_TIMEOUT_MS,
    responseType: "arraybuffer",
  });
  return Buffer.from(res.data || []);
}

async function removeBackgroundImage(buffer, opts = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("Buffer gambar kosong / bukan Buffer");
  if (buffer.length > RM_BG_MAX_BYTES) {
    throw new Error(
      `Ukuran ${(buffer.length / 1048576).toFixed(2)} MB melebihi batas 2 MB iLoveIMG. Kompres/resize dulu.`
    );
  }
  const fileName = String(opts.fileName || "image.jpg").replace(/[^\w.\-]/g, "_") || "image.jpg";
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const step = (stage, detail) => {
    if (!onProgress) return;
    try {
      onProgress(stage, detail);
    } catch {}
  };
  step("token");
  let session = await getTokenInfo(false, PAGE_URL);
  const pool = (Array.isArray(session.servers) && session.servers.length ? session.servers : SERVERS).filter(Boolean);
  const used = [];
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const server = pickServer(pool, used);
    if (!server) break;
    used.push(server);
    try {
      step("upload", server);
      const serverFilename = await uploadForRmBg({
        server,
        ...session,
        buffer,
        fileName,
        contentType: opts.contentType,
      });
      step("process", server);
      const out = await requestRemoveBackground({ server, ...session, serverFilename });
      if (!out.length) throw new Error("Hasil remove-background kosong dari server");
      const png = inspectPng(out);
      if (!png) throw new Error("Server membalas data yang bukan PNG yang valid");
      if (png.width * png.height > RM_BG_MAX_PIXELS)
        throw new Error(`Hasil ${png.width}×${png.height} melebihi batas 4.4MP`);
      return { buffer: out, width: png.width, height: png.height, server, transparent: true };
    } catch (err) {
      lastErr = err;
      if (classifyError(err) === "auth") {
        try {
          session = await getTokenInfo(true, PAGE_URL);
        } catch {}
      }
    }
  }
  throw lastErr || new Error("Gagal remove background (semua server error)");
}

// --- helper plugin ---
function err(status, message) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: message }),
  };
}

function extFromType(ct) {
  return /png/i.test(String(ct || "")) ? "png" : "jpg";
}

function baseName(u) {
  try {
    const b = new URL(u).pathname.split("/").pop() || "";
    const clean = b.replace(/\.[^.]*$/, "").replace(/[^\w.\-]/g, "_");
    if (clean) return clean;
  } catch {}
  return "image";
}

module.exports = {
  name: "removebg",
  category: "tools",
  description: "Hapus background gambar (iLoveIMG) — masukkan URL gambar, hasil PNG transparan",
  method: "GET",
  url: PAGE_URL,

  params: [
    {
      name: "url",
      label: "URL Gambar",
      type: "text",
      required: true,
      example: "https://example.com/foto.jpg",
    },
  ],

  async run({ url }, { axios: ax }) {
    try {
      if (!/^https?:\/\//i.test(url || "")) {
        return err(400, "url gambar tidak valid (harus http/https)");
      }

      const imgRes = await ax.get(url, {
        responseType: "arraybuffer",
        timeout: HTTP_TIMEOUT_MS,
        maxContentLength: 20 * 1024 * 1024,
        validateStatus: () => true,
      });
      if (imgRes.status < 200 || imgRes.status >= 300) {
        return err(502, `gagal unduh gambar (HTTP ${imgRes.status})`);
      }

      const buffer = Buffer.from(imgRes.data || []);
      if (!buffer.length) return err(502, "gambar kosong");
      if (buffer.length > RM_BG_MAX_BYTES) {
        return err(
          413,
          `Ukuran ${(buffer.length / 1048576).toFixed(2)} MB melebihi batas 2 MB iLoveIMG. Kompres/resize dulu.`
        );
      }

      const ct = String(imgRes.headers["content-type"] || "image/jpeg");
      const fileName = `${baseName(url)}.${extFromType(ct)}`;
      const out = await removeBackgroundImage(buffer, { fileName, contentType: ct });
      return { status: 200, contentType: "image/png", body: out.buffer };
    } catch (e) {
      return err(502, e.message || "gagal remove background");
    }
  },
};
