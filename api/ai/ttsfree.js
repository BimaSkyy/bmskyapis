'use strict';

const { rateLimit, fail } = require('../_lib/guard');

const UPSTREAM = 'https://api.omegatech.app/api/ai/clideo';
const UPSTREAM_TIMEOUT_MS = 55 * 1000;
const WORD = /^[A-Za-z_-]{1,20}$/;

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

  if (!rateLimit(req, res, 'ttsfree')) return;

  const q = req.query || {};
  const str = (v) => (typeof v === 'string' ? v : '');

  const text = str(q.text).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < 1 || text.length > 500) {
    return fail(res, 400, 'INVALID_PARAMETER', 'Parameter text wajib diisi, maksimal 500 karakter.');
  }

  const lang = str(q.lang) || 'Id';
  const mood = str(q.mood) || 'EXCITED';
  if (!WORD.test(lang) || !WORD.test(mood)) {
    return fail(res, 400, 'INVALID_PARAMETER', 'Parameter lang dan mood hanya boleh huruf, maksimal 20 karakter.');
  }

  const url = new URL(UPSTREAM);
  url.search = new URLSearchParams({ action: 'generate', text, lang, mood }).toString();

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return fail(res, 504, 'TIMEOUT', 'Pembuatan suara terlalu lama. Coba teks yang lebih pendek.');
    }
    return fail(res, 502, 'UPSTREAM_ERROR', 'Layanan TTS tidak bisa dihubungi. Coba lagi nanti.');
  }

  let body = null;
  try {
    body = await upstream.json();
  } catch (e) {
    body = null;
  }

  const previewUrl = body && body.success && body.data && body.data.previewUrl;
  if (!upstream.ok || typeof previewUrl !== 'string' || !previewUrl.startsWith('https://')) {
    const reason = body && (typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : '');
    return fail(res, 502, 'GENERATE_FAILED', reason || 'Gagal membuat suara dari teks tersebut.');
  }

  return res.status(200).json({
    success: true,
    data: { text, lang, mood, previewUrl },
  });
};
