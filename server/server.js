import dotenv from 'dotenv';
import express from "express";
import pg from "pg";

dotenv.config();

const app = express();
app.use(express.json());

const API_KEY = process.env.API_KEY;
const PORT = process.env.PORT || 3000;

const { Pool } = pg;
const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT     
});

(async () => {
  try {
    const { rows } = await pool.query("SELECT 1 AS ok");
    console.log("Connected to PostgreSQL. Smoke test:", rows[0]);
  } catch (err) {
    console.error("DB connect error at startup:", err);
  }
})();

app.post("/api/login", async (req, res, next) => {
  console.log("POST /api/login body:", req.body);
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }

    const q = `SELECT username, password FROM users WHERE username = $1 LIMIT 1`;
    const { rows } = await pool.query(q, [username]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }
    const user = rows[0];

    if (user.password !== password) {
      return res.status(401).json({ message: "Invalid password." });
    }

    return res.json({ message: "Login successful", user: { username: user.username } });
  } catch (err) {
    next(err);
  }
});

const BASE_URL = "https://www.searchapi.io/api/v1/search";

app.get("/api/search", async (req, res, next) => {
  try {
    const { query } = req.body;

    if (!API_KEY) {
      return res.status(500).json({ message: "Missing API_KEY env" });
    }

    const urlAmazon = `${BASE_URL}?engine=amazon_search&q=${encodeURIComponent(query)}&api_key=${API_KEY}`;
    const urlWalmart = `${BASE_URL}?engine=walmart_search&q=${encodeURIComponent(query)}&api_key=${API_KEY}`;

    const [amazonRes, walmartRes] = await Promise.all([
      fetch(urlAmazon).then(r => {
        if (!r.ok) throw new Error(`Amazon HTTP ${r.status}`);
        return r.json();
      }),
      fetch(urlWalmart).then(r => {
        if (!r.ok) throw new Error(`Walmart HTTP ${r.status}`);
        return r.json();
      }),
    ]);

    res.json({
      product: query,
      amazon: amazonRes,
      walmart: walmartRes,
    });

    // ดึง ASIN ทั้งหมดจาก organic_results (เป็น array)
    const amazonAsins = (amazonRes?.organic_results || [])
      .map((item) => item.asin)
      .filter(Boolean);

    // (ตัวอย่าง) ลดข้อมูลให้เหลือฟิลด์สำคัญ
    const amazonItems = (amazonRes?.organic_results || []).map((it) => ({
      asin: it.asin,
      title: it.title,
      price: it.price,
      rating: it.rating,
      reviews: it.reviews,
      link: it.link,
    }));

    const walmartItems = (walmartRes?.organic_results || []).map((it) => ({
      id: it.us_item_id || it.item_id,
      title: it.title,
      price: it.price,
      rating: it.rating,
      reviews: it.reviews,
      link: it.link,
      seller: it.seller,
    }));

    // ส่งกลับ
    res.json({
      product: query,
      amazon: {
        count: amazonItems.length,
        asins: amazonAsins,
        items: amazonItems,
        raw: amazonRes, // เอาออกถ้าไม่อยากส่งก้อนใหญ่
      },
      walmart: {
        count: walmartItems.length,
        items: walmartItems,
        raw: walmartRes, // เอาออกถ้าไม่อยากส่งก้อนใหญ่
      },
    });

    // log ASINs หลังส่ง response ได้ (ไม่แนะนำให้ทำงานหนักหลังส่ง)
    console.log("Amazon ASINs:", amazonAsins);
  } catch (err) {
    console.error("search error:", err);
    res.status(500).send(`ERROR: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
