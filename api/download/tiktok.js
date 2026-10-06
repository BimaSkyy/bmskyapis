'use strict';

const { rateLimit, fail } = require('../_lib/guard');

const BASE_URL = 'https://www.tikwm.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
const UPSTREAM_TIMEOUT_MS = 20 * 1000;

class TikTokScraper {
  constructor() {
    this.maxPages = 3;
  }

  async search(keyword) {
    let allResults = [];
    let cursor = 0;

    for (let page = 0; page < this.maxPages; page++) {
      const res = await this._searchPage(keyword, cursor);
      if (!res.success) break;

      const items = res.data.videos || [];
      if (items.length === 0) break;
      allResults = allResults.concat(items);

      if (!res.data.hasMore) break;
      cursor = res.data.cursor || 0;
      await new Promise(r => setTimeout(r, 600));
    }

    // Hapus duplikat berdasarkan video_id
    const seen = {};
    return allResults.filter(item => {
      const id = item.video_id;
      if (!id || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  async _searchPage(keyword, cursor) {
    try {
      const body = new URLSearchParams({
        keywords: keyword,
        count: '12',
        cursor: String(cursor),
        web: '1',
        hd: '1'
      }).toString();

      const res = await fetch(`${BASE_URL}/api/photo/search`, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `${BASE_URL}/`,
          'Origin': BASE_URL
        },
        body,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
      });

      const data = await res.json();
      if (data.code !== 0) {
        return { success: false, error: data.msg || 'Pencarian gagal' };
      }
      return { success: true, data: data.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
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

  if (!rateLimit(req, res, 'tiktok')) return;

  const q = req.query || {};
  const rawQuery = typeof q.q === 'string' ? q.q : (typeof q.text === 'string' ? q.text : '');
  const query = rawQuery.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').trim();
  if (!query) {
    return fail(res, 400, 'MISSING_QUERY', 'Masukkan kata kunci! Contoh: ?q=kucing lucu');
  }
  if (query.length > 100) {
    return fail(res, 400, 'INVALID_PARAMETER', 'Kata kunci maksimal 100 karakter.');
  }

  const scraper = new TikTokScraper();
  const hasil = await scraper.search(query);

  if (!hasil || hasil.length === 0) {
    return fail(res, 404, 'NO_RESULT', `Tidak ditemukan hasil untuk: ${query}`);
  }

  return res.status(200).json({
    success: true,
    data: {
      query,
      count: hasil.length,
      results: hasil.slice(0, 5).map((h, i) => ({
        no: i + 1,
        title: h.title || (h.content_desc && Array.isArray(h.content_desc) ? h.content_desc[0]?.substring(0, 60) : null) || 'Tanpa judul',
        author: h.author?.nickname || h.author?.username || 'Anonim',
        play_count: h.play_count || 0,
        digg_count: h.digg_count || 0,
        link: h.play || null,
        images: h.images || [],
        video_id: h.video_id
      }))
    }
  });
};
