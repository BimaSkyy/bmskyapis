module.exports = {
  name: "tiktok",
  category: "downloader",
  description: "Ambil link download video TikTok tanpa watermark",
  method: "GET",
  url: "https://api.ikyyxd.my.id/download/all-in-one",

  params: [
    { name: "url", label: "Link TikTok", type: "text", required: true, example: "https://vt.tiktok.com/xxxxxxx/" },
  ],

  async run({ url }, { axios }) {
    if (!url?.trim()) {
      return {
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "url diperlukan" }),
      };
    }

    if (!url.includes("tiktok.com")) {
      return {
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "Link tidak valid, harus link TikTok" }),
      };
    }

    const res = await axios.get("https://api.ikyyxd.my.id/download/all-in-one", {
      params: { url },
      timeout: 60000,
      validateStatus: () => true,
    });

    if (!res.data?.status || !res.data?.result) {
      return {
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: res.data?.message || "gagal ambil data video",
        }),
      };
    }

    const result = res.data.result;
    const medias = result.medias || [];

    if (medias.length === 0) {
      return {
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "tidak ada media ditemukan" }),
      };
    }

    // Pilih video: hd_no_watermark → no_watermark → video pertama
    const videoMedia =
      medias.find(m => m.type === "video" && m.quality === "hd_no_watermark") ||
      medias.find(m => m.type === "video" && m.quality === "no_watermark") ||
      medias.find(m => m.type === "video");

    if (!videoMedia) {
      return {
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "video tidak ditemukan" }),
      };
    }

    return {
      success: true,
      data: {
        title: result.title || "TikTok Video",
        author: result.author,
        unique_id: result.unique_id,
        statistics: {
          digg_count: result.statistics?.digg_count || 0,
          comment_count: result.statistics?.comment_count || 0,
          share_count: result.statistics?.share_count || 0,
          play_count: result.statistics?.play_count || 0,
        },
        quality: videoMedia.quality,
        video_url: videoMedia.url,
        all_medias: medias,
      },
    };
  },
};