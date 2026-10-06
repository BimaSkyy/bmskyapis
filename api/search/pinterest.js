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
    body = null;
  }

  if (!upstream.ok || !body || !body.status || !Array.isArray(body.result) || body.result.length === 0) {
    const msg = body?.message || 'Tidak ada hasil untuk: ' + query;
    return fail(res, 404, 'NO_RESULT', msg);
  }

  const items = body.result.filter((it) => it.image).slice(0, 5);
  if (items.length === 0) {
    return fail(res, 404, 'NO_IMAGE_RESULT', 'Hasil tidak ditemukan atau tidak punya gambar.');
  }

  return res.status(200).json({
    success: true,
    data: {
      query,
      count: items.length,
      results: items.map((it) => ({
        title: it.title || query,
        url: it.url || 'https://pinterest.com',
        image: it.image,
        username: it.username || 'Pinterest'
      }))
    }
  });
};
