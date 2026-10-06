'use strict';

const { rateLimit, fail } = require('../_lib/guard');

const UPSTREAM = 'https://apiii-xrina.vercel.app/ai-image/flux';
const UPSTREAM_TIMEOUT_MS = 180 * 1000;

// Terjemahan ID → EN, fallback jika gagal
async function idToEn(text) {
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=id|en`);
    const json = await res.json();
    const translated = json?.responseData?.translatedText;
    if (translated && translated.trim() && translated !== text) return translated;
  } catch (e) {
    console.error('[TRANSLATE ERROR]', e.message);
  }
  return text;
}

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

  if (!rateLimit(req, res, 'flux')) return;

  const q = req.query || {};
  const rawPrompt = typeof q.prompt === 'string' ? q.prompt : (typeof q.text === 'string' ? q.text : '');
  const prompt = rawPrompt.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').trim();
  if (prompt.length < 1 || prompt.length > 500) {
    return fail(res, 400, 'INVALID_PARAMETER', 'Parameter prompt wajib diisi, maksimal 500 karakter.');
  }

  const enPrompt = await idToEn(prompt);

  const url = new URL(UPSTREAM);
  url.search = new URLSearchParams({ prompt: enPrompt }).toString();

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: { accept: 'application/json, image/*' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return fail(res, 504, 'TIMEOUT', 'Gambar sedang dibuat, prosesnya agak lama. Coba lagi nanti.');
    }
    return fail(res, 502, 'UPSTREAM_ERROR', 'Tidak bisa menghubungi layanan Flux. Coba lagi nanti.');
  }

  // Jika balasannya JSON error
  const contentType = upstream.headers.get('content-type') || '';
  if (!upstream.ok && contentType.includes('json')) {
    let msg = `Kode ${upstream.status}`;
    try {
      const errJson = await upstream.json();
      msg = errJson?.message || errJson?.error?.message || msg;
    } catch {}
    return fail(res, 502, 'GENERATE_FAILED', `Flux: ${msg}`);
  }

  // Jika langsung gambar → konversi ke data URL
  if (contentType.startsWith('image/')) {
    const imageBuffer = Buffer.from(await upstream.arrayBuffer());
    if (imageBuffer.length < 100) {
      return fail(res, 502, 'GENERATE_FAILED', 'Gambar yang dihasilkan tidak valid.');
    }
    const b64 = imageBuffer.toString('base64');
    const imageUrl = `data:${contentType};base64,${b64}`;
    return res.status(200).json({
      success: true,
      data: { prompt, translatedPrompt: enPrompt, imageUrl }
    });
  }

  // Coba baca sebagai JSON (jika API kembalikan URL)
  let body = null;
  try {
    body = await upstream.json();
  } catch {
    return fail(res, 502, 'GENERATE_FAILED', 'Respons tidak dikenali.');
  }

  const imageUrl = body?.data?.imageUrl || body?.imageUrl || body?.url || body?.data?.url;
  if (!imageUrl) {
    return fail(res, 502, 'GENERATE_FAILED', 'Tidak ada URL gambar dalam respons.');
  }

  return res.status(200).json({
    success: true,
    data: { prompt, translatedPrompt: enPrompt, imageUrl }
  });
};
