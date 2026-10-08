/* Share popup: preview kartu endpoint + salin URL share. creator: @BimaSky */
(function () {
  "use strict";

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c);
    return n;
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "share-toast";
    t.textContent = msg;
    document.body.append(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 300);
    }, 1400);
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = el("textarea", { style: "position:fixed;opacity:0" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(label + " copied");
  }

  function shareUrl(name) {
    return location.origin + "/?api=" + encodeURIComponent(name);
  }

  function openShare(name, description) {
    const url = shareUrl(name);
    const dlg = el(
      "div",
      { class: "share-dlg", role: "dialog", "aria-modal": "true" },
      el("div", { class: "share-head" },
        el("strong", {}, "Share endpoint"),
        el("button", { class: "share-x", type: "button", "aria-label": "Tutup", onclick: () => close() }, "\u00d7")
      ),
      el("div", { class: "share-body" },
        el("img", { class: "share-card", src: "/og/" + encodeURIComponent(name), alt: "Preview " + name }),
        el("div", { class: "share-name" }, "/api/" + name),
        el("div", { class: "share-desc" }, description || "REST API endpoint"),
        el("div", { class: "share-url" }, url),
        el("div", { class: "share-actions" },
          el("button", { class: "share-btn primary", type: "button", onclick: () => copy(url, "URL share") }, "Salin URL"),
          navigator.share
            ? el("button", { class: "share-btn", type: "button", onclick: () => navigator.share({ title: "API " + name, text: description || "", url: url }) }, "Bagikan")
            : null,
          el("button", { class: "share-btn", type: "button", onclick: () => copy(url, "URL") }, "Copy link")
        ),
        el("div", { class: "share-hint" }, "Paste di WA/FB/dll - link ini otomatis menampilkan gambar preview endpoint."))
    );
    const backdrop = el("div", { class: "share-backdrop" }, dlg);
    function close() { backdrop.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", onKey);
    document.body.append(backdrop);
  }

  /* Suntik tombol Share ke header playground setiap kali dialog dibuka.
     Nama endpoint dibaca dari #dlg-title yang diisi openPlayground. */
  const title = document.getElementById("dlg-title");
  const head = title ? title.parentElement : null;
  if (title && head) {
    let last = null;
    new MutationObserver(() => {
      const name = title.textContent.trim();
      if (!name || name === last) return;
      last = name;
      const old = head.querySelector(".share-open");
      if (old) old.remove();
      const btn = el("button", {
        class: "btn share-open", type: "button",
        onclick: () => openShare(name, null),
      }, "Share");
      const closeBtn = document.getElementById("dlg-close");
      head.insertBefore(btn, closeBtn || null);
    }).observe(title, { childList: true, characterData: true, subtree: true });
  }

  /* Deep-link: ?api=<nama> langsung membuka playground endpoint itu. */
  const apiParam = new URLSearchParams(location.search).get("api");
  if (apiParam) {
    history.replaceState(null, "", location.pathname);
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      const btn = [...document.querySelectorAll(".feat")].find(
        (b) => b.querySelector(".feat-name") && b.querySelector(".feat-name").textContent === apiParam
      );
      if (btn) { clearInterval(iv); btn.click(); }
      else if (tries > 20) clearInterval(iv);
    }, 250);
  }
})();
