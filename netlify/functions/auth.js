const jwt = require("jsonwebtoken");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  try {
    const { password } = JSON.parse(event.body);
    if (password === "Freedom777*") {
      const token = jwt.sign(
        { role: "admin" },
        process.env.JWT_SECRET || "secret",
        { expiresIn: "24h" }
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, token }) };
    }
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Невірний пароль" }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Помилка" }) };
  }
};
