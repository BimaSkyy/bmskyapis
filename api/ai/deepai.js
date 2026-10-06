'use strict';

const { rateLimit, fail } = require('../_lib/guard');

const UPSTREAM = 'https://apiii-xrina.vercel.app/ai/deepai';
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

  if (!rateLimit(req, res, 'deepai')) return;

  const q = req.query || {};
  const raw = typeof q.text === 'string' ? q.text : '';
  const text = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').trim();
  if (text.length < 1 || text.length > 1000) {
    return fail(res, 400, 'INVALID_PARAMETER', 'Parameter text wajib diisi, maksimal 1000 karakter.');
  }

  const url = new URL(UPSTREAM);
  url.search = new URLSearchParams({ text }).toString();

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return fail(res, 504, 'TIMEOUT', 'DeepAI terlalu lama menjawab. Coba pertanyaan yang lebih singkat.');
    }
    return fail(res, 502, 'UPSTREAM_ERROR', 'DeepAI tidak bisa dihubungi. Coba lagi nanti.');
  }

  let body = null;
  try {
    body = await upstream.json();
  } catch (e) {
    body = null;
  }

  const answer = body && ((body.data && body.data.response) || body.response);
  if (!upstream.ok || typeof answer !== 'string' || !answer.trim()) {
    return fail(res, 502, 'GENERATE_FAILED', 'DeepAI tidak memberi respons. Coba lagi nanti.');
  }

  return res.status(200).json({
    success: true,
    data: { text, response: answer },
  });
};
