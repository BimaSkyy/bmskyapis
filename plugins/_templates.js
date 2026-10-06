// Copy this file into plugins/<category>/<name>.js and remove the leading "_".
// Files starting with "_" are ignored. No restart needed: changes load automatically.
module.exports = {
  name: "example",              // unique, used in /api/example
  category: "tools",            // optional, defaults to the folder name
  description: "What it does",
  method: "GET",                // GET (default) or POST
  url: "https://example.com/api",
  timeout: 60000,               // optional, ms
  headers: {},                  // optional upstream headers

  // type: text (default) | number | textarea | select (with options)
  // key: optional, upstream parameter name if different from "name"
  params: [
    { name: "q", label: "Query", required: true, example: "hello" },
    { name: "lang", label: "Language", type: "select", options: ["en", "id"], default: "en" },
  ],

  // Optional: replace the simple proxy with custom logic.
  // Return a value (sent as JSON) or { status, contentType, body } for raw/binary output.
  // async run({ q, lang }, { axios }) {
  //   const r = await axios.get("https://example.com/api", {
  //     params: { q, lang },
  //     responseType: "arraybuffer",
  //   });
  //   return { contentType: r.headers["content-type"], body: Buffer.from(r.data) };
  // },
};
