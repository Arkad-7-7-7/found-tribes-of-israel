const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    const store = getStore("articles");
    const list = await store.list();
    const articles = [];
    for (const key of list.blobs) {
      const data = await store.get(key.key, { type: "json" });
      if (data) articles.push(data);
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articles })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articles: [] })
    };
  }
};
