'use strict';

// Batas per IP. Ubah angka di sini kalau mau lebih longgar / ketat.
// Catatan: Map ini hidup di memori instance serverless, jadi sifatnya best-effort.
// Untuk batas yang benar-benar ketat lintas instance, pakai Upstash Redis / Vercel KV.
const RULES = [
  { windowMs: 60 * 1000, max: 3 },        // 3 request per menit
  { windowMs: 60 * 60 * 1000, max: 20 },  // 20 request per jam
];
const BLOCK_AFTER_STRIKES = 5;            // 5x ditolak berturut-turut -> diblokir
const BLOCK_MS = 10 * 60 * 1000;          // lama blokir: 10 menit
const MAX_KEYS = 5000;

const store = new Map();

function clientIp(req) {
  const h = req.headers || {};
  return (
    h['x-real-ip'] ||
    String(h['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    'unknown'
  );
}

function sweep(now) {
  const longest = RULES[RULES.length - 1].windowMs;
  for (const [key, e] of store) {
    const last = e.hits.length ? e.hits[e.hits.length - 1] : 0;
    if (e.blockedUntil <= now && now - last > longest) store.delete(key);
  }
}

function fail(res, status, code, message, extra) {
  res.status(status).json({ success: false, error: Object.assign({ code, message }, extra) });
}

function deny(res, waitMs, message) {
  const retryAfter = Math.max(1, Math.ceil(waitMs / 1000));
  res.setHeader('Retry-After', String(retryAfter));
  res.setHeader('X-RateLimit-Remaining', '0');
  fail(res, 429, 'RATE_LIMITED', message, { retryAfter });
  return false;
}

// Return true kalau request boleh lanjut. Kalau false, response 429 sudah terkirim.
function rateLimit(req, res, name) {
  const now = Date.now();
  const key = name + ':' + clientIp(req);

  let e = store.get(key);
  if (!e) {
    if (store.size >= MAX_KEYS) sweep(now);
    e = { hits: [], strikes: 0, blockedUntil: 0 };
    store.set(key, e);
  }

  const longest = RULES[RULES.length - 1].windowMs;
  e.hits = e.hits.filter((t) => now - t < longest);

  if (e.blockedUntil > now) {
    return deny(res, e.blockedUntil - now, 'Terlalu banyak permintaan. Akses diblokir sementara.');
  }

  let wait = 0;
  for (const r of RULES) {
    const inWindow = e.hits.filter((t) => now - t < r.windowMs);
    if (inWindow.length >= r.max) {
      wait = Math.max(wait, inWindow[0] + r.windowMs - now);
    }
  }

  if (wait > 0) {
    e.strikes += 1;
    if (e.strikes >= BLOCK_AFTER_STRIKES) {
      e.blockedUntil = now + BLOCK_MS;
      e.strikes = 0;
      return deny(res, BLOCK_MS, 'Terlalu banyak permintaan. Akses diblokir 10 menit.');
    }
    return deny(res, wait, 'Terlalu banyak permintaan. Coba lagi sebentar lagi.');
  }

  e.strikes = 0;
  e.hits.push(now);

  let remaining = Infinity;
  for (const r of RULES) {
    const used = e.hits.filter((t) => now - t < r.windowMs).length;
    remaining = Math.min(remaining, r.max - used);
  }
  res.setHeader('X-RateLimit-Limit', String(RULES[0].max));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)));
  return true;
}

module.exports = { rateLimit, fail };
