// plugins/downloader/spotify.js
// Spotify metadata via Partner API + halaman embed (search, track, album, artist).
// Diadaptasi dari scraper ESM (Zane) ke plugin CommonJS proyek ini; tanpa CLI/tulis file.
const BASE = "https://open.spotify.com";
const EMBED_BASE = "https://embed.spotify.com/embed";
const TOKEN_API = "https://clienttoken.spotify.com/v1/clienttoken";
const PARTNER_API = "https://api-partner.spotify.com/pathfinder/v1/query";
const TIMEOUT = 20000;
const RETRIES = 3;
const RETRYABLE = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const BOOTSTRAP_TRACK = "4cOdK2wGLETKBW3PvgPWqT";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
];
const ua = (i) => UAS[i % UAS.length];

async function req(url, { headers = {}, method = "GET", body } = {}) {
  let lastErr;
  for (let i = 0; i <= RETRIES; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT);
    try {
      const res = await fetch(url, {
        method,
        headers: { "User-Agent": ua(i), Accept: "*/*", ...headers },
        body,
        signal: ac.signal,
        redirect: "follow",
      });
      const txt = await res.text();
      if (RETRYABLE.has(res.status) && i < RETRIES) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(ra > 0 ? Math.min(ra * 1000, 5000) : Math.min(1000 * 2 ** i, 8000) + Math.random() * 400);
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return { res, txt };
    } catch (e) {
      lastErr = e;
      if (e.name !== "AbortError" && !(e instanceof TypeError)) break;
      await sleep(Math.min(1000 * 2 ** i, 8000));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr || new Error(`Fetch gagal: ${url}`);
}

let sessionCache = null;
async function getSession({ force = false } = {}) {
  if (!force && sessionCache && Date.now() < sessionCache.expiryMs - 60000) return sessionCache;
  const { txt } = await req(`${EMBED_BASE}/track/${BOOTSTRAP_TRACK}`);
  const m = txt.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Session bootstrap gagal: __NEXT_DATA__ tidak ditemukan.");
  const data = JSON.parse(m[1]);
  const sess = data?.props?.pageProps?.state?.settings?.session;
  if (!sess?.accessToken) throw new Error("Session bootstrap gagal: token tidak ditemukan.");
  sessionCache = {
    accessToken: sess.accessToken,
    expiryMs: sess.accessTokenExpirationTimestampMs,
    isAnonymous: sess.isAnonymous,
  };
  return sessionCache;
}

let clientTokenCache = null;
async function getClientToken({ force = false } = {}) {
  if (!force && clientTokenCache && Date.now() < clientTokenCache.expiryMs - 60000) return clientTokenCache;
  const payload = {
    client_data: {
      client_version: "1.2.57.409.g175f186c",
      client_id: "f6a40776580943a7bc5173125a1e8832",
      js_sdk_data: {
        device_brand: "Chrome",
        device_model: "Windows",
        os: "Windows",
        os_version: "10",
        container_version: "0.0.0",
        device_id: "",
        device_type: "computer",
        platform_identifier: "web_player",
      },
    },
  };
  const { txt } = await req(TOKEN_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const d = JSON.parse(txt);
  if (!d.granted_token?.token) throw new Error("Client token gagal diambil.");
  clientTokenCache = {
    token: d.granted_token.token,
    expiryMs: Date.now() + (d.granted_token.refresh_after_seconds ?? 3600) * 1000,
  };
  return clientTokenCache;
}

const HASH_OK = new Set();
const SEARCH_HASHES = [
  "eff59fa0a3d026b88b56fddbcf4bdfa16a186b8175a5c1a358c072e053c2e5b0",
  "21b3fe49546912ba782db5c47e9ef5a7dbd20329520ba0c7d0fcfadee671d24e",
  "3c9d3f60dac5dea3876b6db3f534192b1c1d90032c4233c1bbaba526db41eb31",
];

async function pathfinder(operationName, variables, hashCandidates) {
  const session = await getSession();
  const client = await getClientToken();
  const ordered = hashCandidates.slice();
  hashCandidates.forEach((h) => {
    if (HASH_OK.has(h)) {
      ordered.splice(ordered.indexOf(h), 1);
      ordered.unshift(h);
    }
  });
  let lastErr = null;
  for (const hash of ordered) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const params = new URLSearchParams({
        operationName,
        variables: JSON.stringify(variables),
        extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }),
      });
      try {
        const { res, txt } = await req(`${PARTNER_API}?${params}`, {
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            "Client-Token": client.token,
            Accept: "application/json",
            "Content-Type": "application/json",
            Origin: BASE,
            Referer: `${BASE}/`,
            "Spotify-App-Platform": "WebPlayer",
          },
        });
        if (res.status === 401 || /token has expired/i.test(txt)) {
          await getSession({ force: true });
          session.accessToken = sessionCache.accessToken;
          continue;
        }
        if (res.status === 400 && /unknown|not found|not supported|hash/i.test(txt)) {
          lastErr = new Error(`Hash ${hash.slice(0, 8)}.. gagal`);
          break;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 140)}`);
        HASH_OK.add(hash);
        return JSON.parse(txt);
      } catch (e) {
        lastErr = e;
        if (/Hash /.test(e.message)) break;
        if (attempt === 1) throw e;
      }
    }
  }
  throw lastErr || new Error(`Semua kandidat hash gagal untuk operation ${operationName}.`);
}

function parseEmbed(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("__NEXT_DATA__ tidak ditemukan.");
  const data = JSON.parse(m[1]);
  const entity = data?.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error("Entity tidak ditemukan di embed page.");
  return entity;
}

async function embedEntity(type, id) {
  const { txt } = await req(`${EMBED_BASE}/${type}/${id}`);
  return parseEmbed(txt);
}

const mapTrack = (t) => ({
  id: (t.uri || "").split(":").pop() || null,
  spotifyUri: t.uri || null,
  url: t.uri ? `https://open.spotify.com/track/${t.uri.split(":").pop()}` : null,
  title: t.title || t.name || null,
  artists: (t.artists?.items || (Array.isArray(t.artists) ? t.artists : []))
    .map((a) => a.name || a.profile?.name)
    .filter(Boolean),
  album: t.album?.name || null,
  albumId: (t.album?.uri || "").split(":").pop() || null,
  albumCover:
    t.album?.coverArt?.sources?.[0]?.url || t.visualIdentity?.image?.sources?.[0]?.url || null,
  isExplicit: !!t.isExplicit,
  durationMs: typeof t.duration === "number" ? t.duration : t.duration?.totalMilliseconds ?? null,
  isPlayable: t.isPlayable !== false,
  playabilityReason: t.playabilityReason || null,
  audioPreviewUrl: t.audioPreview?.url || null,
});

function normId(input, kind) {
  return String(input || "")
    .replace(new RegExp(`^spotify:${kind}:`), "")
    .replace(new RegExp(`^.*/${kind}/`), "")
    .split("?")[0]
    .trim();
}

async function search(term, { limit = 10, offset = 0 } = {}) {
  if (!term?.trim()) throw new Error("Kata kunci wajib diisi.");
  const variables = {
    searchTerm: term,
    offset,
    limit,
    numberOfTopResults: 5,
    includeAudiobooks: false,
    includePreReleases: true,
    includeAlbumPreReleases: false,
    includeAuthors: false,
    includeEpisodeContentRatingsV2: false,
  };
  const data = await pathfinder("searchDesktop", variables, SEARCH_HASHES);
  const s = data?.data?.searchV2 || data?.data?.search;
  if (!s) throw new Error("Format respons search tidak dikenal.");
  const extract = (x) => x?.item?.data || x?.track || x?.data || x;
  const tracks = (s.tracksV2?.items || s.tracks?.items || []).map((x) => {
    const raw = x.item?.data || x.track || x.data || x;
    return mapTrack({ ...raw, album: raw.album || raw.albumOfTrack });
  });
  const albums = (s.albumsV2?.items || s.albums?.items || [])
    .map(extract)
    .filter((x) => x && x.uri)
    .map((x) => ({
      id: x.uri.split(":").pop(),
      name: x.name || x.title,
      artists: (x.artists?.items || []).map((a) => a.profile?.name || a.name).filter(Boolean),
      coverArt: x.coverArt?.sources?.[0]?.url || null,
      year: x.date?.year || null,
      uri: x.uri,
    }));
  const artists = (s.artistsV2?.items || s.artists?.items || [])
    .map(extract)
    .filter((x) => x && x.uri)
    .map((x) => ({
      id: x.uri.split(":").pop(),
      name: x.profile?.name || x.name,
      uri: x.uri,
      avatar: x.visuals?.avatarImage?.sources?.[0]?.url || null,
    }));
  return {
    term,
    totalTracks: (s.tracksV2 || s.tracks)?.totalCount ?? tracks.length,
    tracks,
    albums,
    artists,
  };
}

async function track(idOrUri) {
  const id = normId(idOrUri, "track");
  if (!id) throw new Error("id track wajib diisi.");
  const embed = await embedEntity("track", id);
  return mapTrack(embed);
}

async function album(idOrUri) {
  const id = normId(idOrUri, "album");
  if (!id) throw new Error("id album wajib diisi.");
  const e = await embedEntity("album", id);
  const coverUrl = e.visualIdentity?.image?.sources?.[0]?.url || null;
  return {
    id,
    name: e.name || e.title,
    artists: (e.artists || []).map((a) => a.name).filter(Boolean),
    releaseDate: e.releaseDate?.isoString || null,
    totalTracks: (e.trackList || []).length,
    tracks: (e.trackList || []).map((t) =>
      mapTrack({
        ...t,
        album: { name: e.name, uri: e.uri, coverArt: { sources: coverUrl ? [{ url: coverUrl }] : [] } },
      })
    ),
  };
}

async function artist(idOrUri) {
  const id = normId(idOrUri, "artist");
  if (!id) throw new Error("id artist wajib diisi.");
  const e = await embedEntity("artist", id);
  return {
    id,
    name: e.name || e.title,
    subtitle: e.subtitle || null,
    relatedEntityUri: e.relatedEntityUri || null,
    tracks: (e.trackList || []).map((t) => mapTrack(t)),
  };
}

// ── SPOTIDOWN: full MP3 (JSON) ──────────────────────────────
const SDIDR_BASE = "https://spotidown.net/en";
const SD_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const sdJar = new Map();
function sdAddCookies(headers) {
  const list = headers.getSetCookie?.() ?? [];
  for (const c of list) {
    const [p] = c.split(";");
    const i = p.indexOf("=");
    if (i > 0) sdJar.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
}
const sdCk = () => [...sdJar].map(([k, v]) => `${k}=${v}`).join("; ");

async function sdReq(url, { method = "GET", body, headers = {} } = {}) {
  let lastErr;
  for (let i = 0; i <= RETRIES; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "User-Agent": SD_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
          "Upgrade-Insecure-Requests": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Cache-Control": "no-cache",
          Cookie: sdCk(),
          ...headers,
        },
        body,
        signal: ac.signal,
        redirect: "follow",
      });
      sdAddCookies(res.headers);
      const txt = await res.text();
      if (RETRYABLE.has(res.status) && i < RETRIES) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(Math.min(1000 * 2 ** i, 8000));
        continue;
      }
      return { res, txt };
    } catch (e) {
      lastErr = e;
      if (e.name !== "AbortError" && !(e instanceof TypeError)) break;
      await sleep(Math.min(1000 * 2 ** i, 8000));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr || new Error(`Fetch gagal: ${url}`);
}

let sdNonce = null;
const SD_NONCE_RE = [
  /"nonce":"([a-f0-9]+)"/,
  /nonce['"]?\s*[:=]\s*['"]([a-f0-9]{8,})['"]/i,
  /name="_wpnonce"\s+value="([a-f0-9]+)"/i,
  /elementor_pro_forms_send_form[\s\S]{0,400}?nonce['"]?\s*[:=]\s*['"]([a-f0-9]{8,})['"]/i,
];
function sdFindNonce(txt) {
  for (const re of SD_NONCE_RE) {
    const m = txt.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}
async function sdGetNonce() {
  if (sdNonce) return sdNonce;
  const pages = [`${SDIDR_BASE}/`, `${SDIDR_BASE}/spotify-song-downloader/`];
  let lastDiag = "";
  for (const url of pages) {
    try {
      const { res, txt } = await sdReq(url);
      const found = sdFindNonce(txt);
      if (found) {
        sdNonce = found;
        return sdNonce;
      }
      lastDiag = `HTTP ${res.status}, ${txt.length} byte, cf=${res.headers.get("server") || "-"}`;
    } catch (e) {
      lastDiag = e.message;
    }
  }
  throw new Error(`Nonce form spotidown tidak ditemukan (${lastDiag}).`);
}

async function sdStartDownload(spotifyUrl) {
  const n = await sdGetNonce();
  const { txt } = await sdReq(`${SDIDR_BASE}/wp-admin/admin-ajax.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${SDIDR_BASE}/`,
      Origin: "https://spotidown.net",
    },
    body: new URLSearchParams({
      action: "elementor_pro_forms_send_form",
      form_id: "394636d",
      post_id: "2",
      queried_id: "2",
      elementor_ajax: "1",
      "form_fields[music_url]": spotifyUrl,
      referrer: `${SDIDR_BASE}/`,
      nonce: n,
    }).toString(),
  });
  let json;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error("spotidown: respons form bukan JSON.");
  }
  const redirect = json?.data?.data?.["1"]?.redirect_url;
  if (!redirect) throw new Error("spotidown: redirect_url kosong (form ditolak).");
  const resolved = redirect.startsWith("http")
    ? redirect.replace("http://", "https://")
    : `https://spotidown.net${redirect}`;
  const page = await sdReq(resolved);
  const start = page.txt.indexOf("smdDownloadData");
  let output = null;
  if (start !== -1) {
    const eq = page.txt.indexOf("=", start);
    const brace = page.txt.indexOf("{", eq);
    if (brace !== -1) {
      let depth = 0;
      let end = -1;
      for (let i = brace; i < page.txt.length; i++) {
        if (page.txt[i] === "{") depth++;
        else if (page.txt[i] === "}" && --depth === 0) {
          end = i;
          break;
        }
      }
      if (end > brace) output = JSON.parse(page.txt.slice(brace, end + 1)).output;
    }
  }
  if (!output) throw new Error("spotidown: smdDownloadData tidak ditemukan.");
  return output;
}

async function sdResolveMp3(item, spotifyUrl, { attempts = 25 } = {}) {
  const name = item.name || item.song_name;
  const artists = (item.artists || []).map((a) => a.name).filter(Boolean).join(", ");
  const link = item.external_urls?.spotify || item.link || spotifyUrl;
  const b64 = Buffer.from(
    encodeURIComponent(JSON.stringify({ song_name: name, artist: artists, link }))
  ).toString("base64");
  const start = await sdReq(
    `${SDIDR_BASE}/wp-admin/admin-ajax.php?action=check_download_status&data=${encodeURIComponent(b64)}`
  );
  let s;
  try {
    s = JSON.parse(start.txt);
  } catch {
    throw new Error("spotidown: check_download_status bukan JSON.");
  }
  if (!s?.success || !s?.data?.download_id) throw new Error("spotidown: check_download_status gagal.");
  const did = s.data.download_id;
  for (let i = 0; i < attempts; i++) {
    await sleep(1500);
    const { txt } = await sdReq(
      `${SDIDR_BASE}/wp-admin/admin-ajax.php?action=get_download_status&download_id=${encodeURIComponent(did)}`
    );
    let d;
    try {
      d = JSON.parse(txt);
    } catch {
      continue;
    }
    if (d?.data?.status === "ready" && d?.data?.download_url) {
      return { downloadUrl: d.data.download_url, title: d.data.title || name, thumbnail: d.data.thumbnail || null };
    }
    if (d?.data?.status === "failed" || d?.data?.status === "error") {
      throw new Error(`spotidown: download gagal (${d?.data?.message || "unknown"}).`);
    }
  }
  throw new Error("spotidown: timeout menunggu download_url.");
}

async function sdDownloadTrack(spotifyUrl, source) {
  const output = await sdStartDownload(spotifyUrl);
  let items = output.artist_tracks?.length ? output.artist_tracks : [];
  if (!items.length && Array.isArray(output.tracks?.items)) {
    items = output.tracks.items.map((i) => ({
      ...i,
      album: i.album || { images: output.images },
      external_urls: i.external_urls || { spotify: `https://open.spotify.com/track/${i.id}` },
    }));
  }
  if (!items.length) items = [output];
  const saved = [];
  for (const item of items) {
    const mp3 = await sdResolveMp3(item, spotifyUrl);
    saved.push({
      title: mp3.title,
      artist: (item.artists || []).map((a) => a.name).filter(Boolean).join(", ") || source?.artists?.join(", ") || null,
      album: item.album?.name || source?.album || null,
      duration: item.duration || null,
      spotifyId: item.id || source?.id || null,
      spotifyUrl,
      cover: item.album?.images?.[0]?.url || source?.albumCover || null,
      thumbnail: mp3.thumbnail || null,
      previewUrl: item.preview_url || source?.audioPreviewUrl || null,
      fullMp3Url: mp3.downloadUrl,
    });
  }
  return { type: output.type || "track", total: saved.length, tracks: saved };
}

function err(status, message) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: message }),
  };
}

module.exports = {
  name: "spotify",
  category: "downloader",
  description: "Spotify: ketik nama lagu untuk cari + unduh MP3, atau tempel link/ID",
  method: "GET",
  url: BASE,

  params: [
    {
      name: "q",
      label: "Nama lagu / link / ID Spotify",
      type: "text",
      required: true,
      example: "never gonna give you up rick astley",
    },
  ],

  async run({ q }, { axios, req }) {
    try {
      if (!q || !q.trim()) return err(400, "q diperlukan");
      const input = q.trim();

      const isTrack = /spotify:track:|open\.spotify\.com\/track\/|\/track\//.test(input);
      const isAlbum = /spotify:album:|open\.spotify\.com\/album\/|\/album\//.test(input);
      const isArtist = /spotify:artist:|open\.spotify\.com\/artist\/|\/artist\//.test(input);

      // type opsional lewat query (?type=search|track|album|artist|dl); default otomatis.
      const forced = String(req?.query?.type || "").toLowerCase();
      const type = forced || (isAlbum ? "album" : isArtist ? "artist" : "dl");

      let data;
      if (type === "search") data = await search(input, { limit: 10 });
      else if (type === "track") data = await track(input);
      else if (type === "album") data = await album(input);
      else if (type === "artist") data = await artist(input);
      else if (type === "dl") {
        if (isTrack) {
          data = await sdDownloadTrack(input);
        } else {
          const r = await search(input, { limit: 1 });
          const first = r.tracks?.[0];
          if (!first?.url) return err(404, "tidak ada hasil untuk kata kunci itu");
          data = await sdDownloadTrack(first.url, first);
        }
      } else return err(400, `type tidak dikenal: ${type}`);

      return { success: true, data };
    } catch (e) {
      return err(502, e.message || "gagal mengambil data Spotify");
    }
  },
};
