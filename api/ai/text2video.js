'use strict';

const { rateLimit, fail } = require('../_lib/guard');

const UPSTREAM = 'https://api.omegatech.app/api/ai/Txt2video';
const RATIOS = new Set(['auto', '16:9', '9:16', '1:1']);
const UPSTREAM_TIMEOUT_MS = 55 * 1000;

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

  // Anti-spam: cek sebelum melakukan apa pun yang berat.
  if (!rateLimit(req, res, 'text2video')) return;

  const q = req.query || {};
  const str = (v) => (typeof v === 'string' ? v : '');

  const prompt = str(q.prompt).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (prompt.length < 3 || prompt.length > 500) {
    return fail(res, 400, 'INVALID_PARAMETER', 'Parameter prompt wajib diisi, 3 sampai 500 karakter.');
  }

  const ratio = str(q.ratio) || 'auto';
  if (!RATIOS.has(ratio)) {
    return fail(res, 400, 'INVALID_PARAMETER', 'Parameter ratio harus salah satu dari: auto, 16:9, 9:16, 1:1.');
  }

  const sound = str(q.sound) || 'true';
  if (sound !== 'true' && sound !== 'false') {
    return fail(res, 400, 'INVALID_PARAMETER', 'Parameter sound harus true atau false.');
  }

  const url = new URL(UPSTREAM);
  url.search = new URLSearchParams({ action: 'generate', prompt, ratio, sound }).toString();

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return fail(res, 504, 'TIMEOUT', 'Pembuatan video terlalu lama. Coba lagi dengan prompt yang lebih singkat.');
    }
    return fail(res, 502, 'UPSTREAM_ERROR', 'Layanan pembuat video tidak bisa dihubungi. Coba lagi nanti.');
  }

  let body = null;
  try {
    body = await upstream.json();
  } catch (e) {
    body = null;
  }

  const videoUrl = body && body.success && body.data && body.data.videoUrl;
  if (!upstream.ok || typeof videoUrl !== 'string' || !videoUrl.startsWith('https://')) {
    return fail(res, 502, 'UPSTREAM_ERROR', 'Gagal membuat video dari prompt tersebut. Coba prompt lain atau ulangi nanti.');
  }

  return res.status(200).json({
    success: true,
    data: { prompt, ratio, sound: sound === 'true', videoUrl },
  });
};
