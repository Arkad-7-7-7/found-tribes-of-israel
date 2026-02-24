const jwt = require("jsonwebtoken");

exports.handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
    };

    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    if (event.httpMethod !== "POST") {
        return { statusCode: 405, headers, body: "Method Not Allowed" };
    }

    try {
        const { password } = JSON.parse(event.body);
        const ADMIN_PASSWORD = "Freedom";
        
        if (password === ADMIN_PASSWORD) {
            const token = jwt.sign(
                { role: "admin" },
                process.env.JWT_SECRET || "your-secret-key",
                { expiresIn: "24h" }
            );
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true, token })
            };
        }
        
        return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: "Невірний пароль" })
        };
        
    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: "Помилка сервера" })
        };
    }
};
