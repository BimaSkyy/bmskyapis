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
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return fail(res, 504, 'TIMEOUT', 'Pencarian terlalu lama. Coba kata kunci lain.');
    }
    return fail(res, 502, 'UPSTREAM_ERROR', 'Tidak bisa menghubungi layanan Pinterest.');
  }

  let body = null;
  try {
    body = await upstream.json();
  } catch (e) {
    return fail(res, 502, 'INVALID_RESPONSE', 'Respons dari layanan tidak berformat JSON.');
  }

  // Debug: tampilkan apa yang diterima
  console.log('[Pinterest Debug] status:', upstream.status, 'body:', JSON.stringify(body));

  // Lebih fleksibel: terima berbagai format respons
  let results = [];
  if (Array.isArray(body)) {
    results = body;
  } else if (Array.isArray(body?.result)) {
    results = body.result;
  } else if (Array.isArray(body?.data)) {
    results = body.data;
  } else if (body?.status === false) {
    // API kembalikan status:false = pesan error
    return fail(res, 404, 'NO_RESULT', body.message || 'Tidak ada hasil untuk: ' + query);
  }

  if (results.length === 0) {
    return fail(res, 404, 'NO_RESULT', 'Tidak ada hasil untuk: ' + query);
  }

  // Filter yang punya gambar
  const items = results.filter((it) => it.image || it.thumbnail || it.img).slice(0, 5);
  if (items.length === 0) {
    return fail(res, 404, 'NO_IMAGE_RESULT', 'Ada hasil tapi tidak ada gambar yang valid.');
  }

  return res.status(200).json({
    success: true,
    data: {
      query,
      count: items.length,
      results: items.map((it) => ({
        title: it.title || it.caption || query,
        url: it.url || it.link || 'https://pinterest.com',
        image: it.image || it.thumbnail || it.img,
        username: it.username || it.author || 'Pinterest'
      }))
    }
  });
};
