module.exports = {
  name: "ainologin",
  category: "ai",
  description: "Chat AI NoLogin (ainologin.com) - uncensored, dukung lanjut sesi via sesiId",
  method: "GET",
  url: "https://ainologin.com/api/dispatch",

  params: [
    { name: "query", label: "Pertanyaan/Pesan", type: "textarea", required: true, example: "halo, apa itu sunrise?" },
    { name: "sesiId", label: "ID Sesi (opsional, untuk lanjut percakapan)", type: "text", required: false },
  ],

  async run({ query, sesiId }, { axios }) {
    const CREATOR = "@BimaSky";

    if (!query || !query.trim()) {
      return {
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: "parameter 'query' wajib diisi. Contoh: ?query=halo",
        }),
      };
    }

    if (query.length > 4000) {
      return {
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: "query terlalu panjang (maks 4000 karakter)",
        }),
      };
    }

    // sesiId = base64 dari "chatId|uid". Tanpa sesiId = sesi baru setiap kali run.
    let chatId = null;
    let uid = null;
    if (sesiId && sesiId.trim()) {
      try {
        const decoded = Buffer.from(sesiId, "base64").toString("utf8");
        const parts = decoded.split("|");
        if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("format salah");
        chatId = parts[0];
        uid = parts[1];
      } catch (e) {
        return {
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            error: "sesiId tidak valid. Gunakan sesiId dari respons sebelumnya",
          }),
        };
      }
    }

    try {
      const res = await axios({
        method: "POST",
        url: "https://ainologin.com/api/dispatch",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://ainologin.com",
          Referer: "https://ainologin.com/chat",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          ...(uid ? { Cookie: "uid=" + uid } : {}),
        },
        data: {
          user_input: query,
          mode: "usual",
          model: "C",
          persona: "normal",
          max_turns: 3,
          chat_id: chatId,
          attachments: [],
          regenerate: false,
          edit: false,
          edit_mid: null,
          via: "typed",
        },
        timeout: 120000,
        validateStatus: () => true,
        // Respons SSE diambil mentah sebagai teks lalu diparse manual
        responseType: "text",
        transformResponse: [(d) => d],
      });

      // Cookie uid dari server dipakai untuk melanjutkan sesi
      const setCookies = res.headers["set-cookie"] || [];
      let newUid = uid;
      for (const c of setCookies) {
        const m = c.match(/uid=([^;]+)/);
        if (m) newUid = m[1];
      }

      if (res.status !== 200 || typeof res.data !== "string") {
        return {
          status: res.status >= 400 ? res.status : 502,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            error:
              res.status === 429
                ? "rate limit dari ainologin.com, tunggu sebentar lalu coba lagi"
                : "upstream error (HTTP " + res.status + ")",
          }),
        };
      }

      // Parse event SSE: chat_meta (chat_id), delta (potongan teks), message (final)
      let seseId = null;
      let jawaban = "";
      let pesanFinal = null;
      let errorMsg = null;

      for (const line of res.data.split("\n")) {
        const l = line.trim();
        if (!l.startsWith("data: ")) continue;
        let evt;
        try {
          evt = JSON.parse(l.slice(6));
        } catch (e) {
          continue;
        }

        if (evt.type === "chat_meta" && evt.chat_id) seseId = evt.chat_id;
        else if (evt.type === "delta" && evt.chunk) jawaban += evt.chunk;
        else if (evt.type === "message" && evt.content) pesanFinal = evt.content;
        else if (evt.type === "error") errorMsg = evt.content || "unknown error";
      }

      if (errorMsg && !pesanFinal && !jawaban) {
        return {
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error: errorMsg }),
        };
      }

      const teks = pesanFinal || jawaban;

      if (!teks) {
        return {
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            error: "AI tidak memberikan jawaban (mungkin timeout atau diblokir)",
          }),
        };
      }

      const token =
        seseId && newUid
          ? Buffer.from(seseId + "|" + newUid).toString("base64")
          : null;

      return {
        success: true,
        creator: CREATOR,
        data: {
          response: teks,
          sesiId: token,
        },
      };
    } catch (e) {
      return {
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: e.message || "gagal menghubungi upstream",
        }),
      };
    }
  },
};
