// plugins/ai/deepai.js
module.exports = {
  name: "deepai",
  category: "ai",
  description: "Ask anything to DeepAI",
  method: "GET",
  url: "https://apiii-xrina.vercel.app/ai/deepai",
  params: [
    { name: "text", label: "Question", required: true, example: "why does a cpu not melt" },
  ],
};
