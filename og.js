// Kartu OpenGraph untuk endpoint (PNG 1200x630) + injeksi meta tag.
// Modul terpisah agar server.js tetap ramping. creator: @BimaSky
// Lazy-load dinamis supaya bundler Vercel tidak mencoba membundel binary native.
let ogCanvas = null;
function loadCanvas() {
  if (ogCanvas !== null) return ogCanvas;
  try {
    const { createRequire } = require("module");
    const req = createRequire(__filename);
    ogCanvas = req("@napi-rs/canvas") || false;
  } catch (e) {
    console.error("[og] @napi-rs/canvas tidak tersedia: " + e.message);
    ogCanvas = false;
  }
  return ogCanvas;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function baseUrl(req) {
  return req.protocol + "://" + (req.get("x-forwarded-host") || req.get("host"));
}

// Tambah meta OG ke index.html bila req minta endpoint tertentu (?api=nama).
function injectMeta(html, req, plugin) {
  if (!plugin) return { html, found: false };
  const base = baseUrl(req);
  const meta = [
    ["og:title", "API " + plugin.name],
    ["og:description", plugin.description || "REST API endpoint"],
    ["og:image", base + "/og/" + encodeURIComponent(plugin.name)],
    ["og:image:type", "image/png"],
    ["og:image:width", "1200"],
    ["og:image:height", "630"],
    ["twitter:card", "summary_large_image"],
  ]
    .map(([k, v]) => '<meta property="' + k + '" content="' + esc(v) + '">')
    .join("\n    ");
  return { html: html.replace("</head>", "    " + meta + "\n</head>"), found: true };
}

// Gambar kartu endpoint 1200x630.
async function renderCard(p) {
  const cv = loadCanvas();
  if (!cv) return null;
  const W = 1200, H = 630;
  const canvas = cv.createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#0b1220");
  grad.addColorStop(1, "#123c33");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#2dd4a7";
  ctx.fillRect(0, 0, 14, H);

  ctx.font = "bold 34px sans-serif";
  ctx.fillStyle = "#2dd4a7";
  ctx.fillText(String(p.category || "api").toUpperCase(), 70, 110);

  ctx.font = "bold 84px sans-serif";
  ctx.fillStyle = "#ffffff";
  let name = "/" + p.name;
  const maxW = W - 140;
  if (ctx.measureText(name).width > maxW) {
    while (name.length > 1 && ctx.measureText(name + "...").width > maxW) name = name.slice(0, -1);
    name += "...";
  }
  ctx.fillText(name, 70, 235);

  ctx.font = "40px sans-serif";
  ctx.fillStyle = "#c9d4d2";
  let line = "", y = 315;
  const words = String(p.description || "").split(/\s+/);
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, 70, y);
      y += 54;
      line = w;
      if (y > 460) { line += " ..."; break; }
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, 70, y);

  ctx.font = "34px sans-serif";
  ctx.fillStyle = "#8fa3a0";
  ctx.fillText((p.method || "GET") + "   /api/" + p.name, 70, 575);

  const creator = "@BimaSky";
  ctx.font = "bold 34px sans-serif";
  ctx.fillStyle = "#2dd4a7";
  ctx.fillText(creator, W - 70 - ctx.measureText(creator).width, 575);

  return canvas.encode("png");
}

module.exports = { injectMeta, renderCard };

// Pasang route OG ke app express. deps: { syncPlugins, plugins: () => Map, path, fs, root }
function registerRoutes(app, deps) {
  app.set("trust proxy", true);
  const readIndex = () => deps.fs.readFileSync(deps.path.join(deps.root, "public", "app.html"), "utf8");

  app.get("/", (req, res) => {
    deps.syncPlugins();
    const q = req.query.api ? String(req.query.api).toLowerCase() : null;
    const p = q ? deps.plugins().get(q) : null;
    const out = injectMeta(readIndex(), req, p);
    res.set("Cache-Control", "no-cache");
    res.type("html").send(out.html);
  });

  app.get("/og/:name", async (req, res) => {
    deps.syncPlugins();
    const p = deps.plugins().get(String(req.params.name).toLowerCase());
    if (!p) return res.status(404).json({ error: "OG not found" });
    const png = await renderCard(p);
    if (!png) return res.status(500).send("og image unavailable");
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(png);
  });
}

module.exports = { injectMeta, renderCard, registerRoutes };
