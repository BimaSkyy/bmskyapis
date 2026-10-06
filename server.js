const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PLUGIN_DIR = path.join(__dirname, "plugins");

const app = express();
let plugins = new Map();
let signature = "";

// Collect every .js file under plugins/ (files starting with "_" are ignored).
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith(".js") && !e.name.startsWith("_") ? [full] : [];
  });
}

// Reload plugins only when a file was added, removed or modified.
function syncPlugins() {
  const files = walk(PLUGIN_DIR);
  const sig = files.map((f) => f + ":" + fs.statSync(f).mtimeMs).join("|");
  if (sig === signature) return;
  signature = sig;

  const next = new Map();
  for (const file of files) {
    try {
      delete require.cache[require.resolve(file)];
      const p = require(file);
      if (!p.name) throw new Error("missing 'name'");
      if (!p.url && typeof p.run !== "function") throw new Error("needs 'url' or 'run'");
      next.set(p.name, {
        method: "GET",
        params: [],
        timeout: 60000,
        description: "",
        ...p,
        category: p.category || path.basename(path.dirname(file)),
      });
    } catch (e) {
      console.error(`[plugin] skipped ${path.relative(__dirname, file)}: ${e.message}`);
    }
  }
  plugins = next;
  console.log(`[plugin] loaded ${plugins.size} plugin(s)`);
}

app.use(express.static(path.join(__dirname, "public")));

// Metadata used by the web UI (handlers and internals are not exposed).
app.get("/meta/plugins", (req, res) => {
  syncPlugins();
  res.json(
    [...plugins.values()].map(({ name, category, description, method, params }) => ({
      name,
      category,
      description,
      method,
      params,
    }))
  );
});

// Run a plugin. Response is passed through untouched (binary safe).
app.get("/api/:name", async (req, res) => {
  syncPlugins();
  const p = plugins.get(req.params.name);
  if (!p) return res.status(404).json({ error: "Plugin not found" });

  const input = {};
  for (const prm of p.params) {
    const v = req.query[prm.name];
    if (v !== undefined && v !== "") input[prm.name] = String(v);
    else if (prm.default !== undefined) input[prm.name] = String(prm.default);
    else if (prm.required !== false) {
      return res.status(400).json({ error: `Missing parameter: ${prm.name}` });
    }
  }

  try {
    // Custom handler: return { status, contentType, body } or any JSON-able value.
    if (typeof p.run === "function") {
      const out = await p.run(input, { axios, req });
      if (out && out.body !== undefined) {
        return res
          .status(out.status || 200)
          .type(out.contentType || "application/octet-stream")
          .send(out.body);
      }
      return res.json(out);
    }

    // Declarative: forward params to the upstream URL.
    const query = {};
    for (const prm of p.params) {
      if (input[prm.name] !== undefined) query[prm.key || prm.name] = input[prm.name];
    }
    const up = await axios({
      method: p.method,
      url: p.url,
      params: p.method === "GET" ? query : undefined,
      data: p.method !== "GET" ? query : undefined,
      headers: p.headers,
      responseType: "arraybuffer",
      timeout: p.timeout,
      maxContentLength: 100 * 1024 * 1024,
      validateStatus: () => true,
    });
    if (up.headers["content-type"]) res.set("Content-Type", up.headers["content-type"]);
    res.status(up.status).send(Buffer.from(up.data));
  } catch (e) {
    res.status(502).json({ error: e.message || "Upstream request failed" });
  }
});

syncPlugins();
app.listen(PORT, () => console.log(`Panel running on http://localhost:${PORT}`));
