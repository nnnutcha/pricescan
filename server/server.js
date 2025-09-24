// server.js
import express from "express";
import pg from "pg";

const app = express();
app.use(express.json());

// --- PostgreSQL (ใช้ Pool) ---
const { Pool } = pg;
const pool = new Pool({
  host: "localhost",
  user: "postgres",
  password: "1234",
  database: "pricescanDB",
  port: 5432,          // สำคัญ: พอร์ต DB
  max: 10,             // max connections
  idleTimeoutMillis: 30000
});

// ทดสอบเชื่อม DB ตอนสตาร์ท
(async () => {
  try {
    const { rows } = await pool.query("SELECT 1 AS ok");
    console.log("Connected to PostgreSQL. Smoke test:", rows[0]);
  } catch (err) {
    console.error("DB connect error at startup:", err);
    // ถ้า DB ยังไม่ขึ้น ให้ process อยู่ต่อได้เพื่อยิง /health เช็คได้
  }
})();

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Login (POST + JSON body)
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

    // (ตัวอย่างเพื่อทดสอบ) เทียบรหัสแบบ plain-text ก่อน
    if (user.password !== password) {
      return res.status(401).json({ message: "Invalid password." });
    }

    return res.json({ message: "Login successful", user: { username: user.username } });
  } catch (err) {
    next(err);
  }
});

// Error handler (กันเซิร์ฟเวอร์ล้ม -> กัน socket hang up)
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return;
  res.status(500).json({ message: "Internal Server Error", error: err.message });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
