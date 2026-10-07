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

function err(status, message) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({ success: false, error: message }),
  };
}

const TYPES = ["search", "track", "album", "artist"];

module.exports = {
  name: "spotify",
  category: "downloader",
  description: "Spotify: cari lagu, metadata track/album/artist",
  method: "GET",
  url: BASE,

  params: [
    { name: "type", label: "Aksi", type: "select", options: TYPES, default: "search" },
    {
      name: "q",
      label: "Kata kunci / ID / URL",
      type: "text",
      required: true,
      example: "stay happy tj",
    },
    { name: "limit", label: "Limit (search)", type: "number", required: false, default: "10" },
  ],

  async run({ type = "search", q, limit = "10" }, { axios }) {
    try {
      if (!q || !q.trim()) return err(400, "q diperlukan");
      const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);

      let data;
      if (type === "search") data = await search(q.trim(), { limit: lim });
      else if (type === "track") data = await track(q.trim());
      else if (type === "album") data = await album(q.trim());
      else if (type === "artist") data = await artist(q.trim());
      else return err(400, `type tidak dikenal: ${type} (pilih: ${TYPES.join(", ")})`);

      return { success: true, data };
    } catch (e) {
      return err(502, e.message || "gagal mengambil data Spotify");
    }
  },
};
