'use strict';

const { rateLimit, fail } = require('../_lib/guard');

const API_URL = 'https://zellrayy.com/search/pinterest';
const UPSTREAM_TIMEOUT_MS = 30 * 1000;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Gunakan metode GET.');
  }

  if (!rateLimit(req, res, 'pinterest')) return;

  const q = req.query || {};
  const rawQuery = typeof q.q === 'string' ? q.q : (typeof q.text === 'string' ? q.text : '');
  const query = rawQuery.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').trim();
  if (!query) {
    return fail(res, 400, 'MISSING_QUERY', 'Masukkan kata kunci! Contoh: ?q=anime');
  }
  if (query.length > 100) {
    return fail(res, 400, 'INVALID_PARAMETER', 'Kata kunci maksimal 100 karakter.');
  }

  const url = new URL(API_URL);
  url.search = new URLSearchParams({ q: query, limit: '5', scope: 'pins' }).toString();

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: {
        accept: 'application/json, text/plain, */*',
        'user-agent': 'Mozilla/5.0 (compatible; BmskyAPI/1.0)',
        'referer': 'https://zellrayy.com/',
        'origin': 'https://zellrayy.com'
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return fail(res, 504, 'TIMEOUT', 'Pencarian terlalu lama. Coba kata kunci lain.');
    }
    return fail(res, 502, 'UPSTREAM_ERROR', 'Tidak bisa menghubungi layanan Pinterest.');
  }

  const text = await upstream.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (e) {
    return fail(res, 502, 'INVALID_RESPONSE',
      `Layanan mengembalikan format tidak valid (HTTP ${upstream.status})`);
  }

  // Respons error asli dari API
  if (body?.status === false) {
    return fail(res, 404, 'NO_RESULT', body.message || `Tidak ada hasil untuk: ${query}`);
  }

  // Ambil hasil dari berbagai kemungkinan lokasi
  let results = [];
  if (Array.isArray(body)) results = body;
  else if (Array.isArray(body?.result)) results = body.result;
  else if (Array.isArray(body?.data)) results = body.data;
  else if (Array.isArray(body?.results)) results = body.results;

  if (results.length === 0) {
    return fail(res, 404, 'NO_RESULT', `Tidak ada hasil untuk: ${query}`);
  }

  // Filter yang punya gambar
  const items = results.filter((it) => {
    const img = it.image || it.thumbnail || it.img || it.url_img;
    return img && typeof img === 'string' && img.length > 10;
  }).slice(0, 5);

  if (items.length === 0) {
    return fail(res, 404, 'NO_IMAGE_RESULT', 'Ada hasil tapi tidak ada gambar yang valid.');
  }

  return res.status(200).json({
    success: true,
    data: {
      query,
      count: items.length,
      results: items.map((it) => ({
        title: it.title || it.caption || it.name || query,
        url: it.url || it.link || it.source || 'https://pinterest.com',
        image: it.image || it.thumbnail || it.img || it.url_img,
        username: it.username || it.author || it.pinner || 'Pinterest'
      }))
    }
  });
};
