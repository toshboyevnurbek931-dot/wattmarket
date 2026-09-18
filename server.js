import express from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import multer from "multer";
import sqlite3 from "sqlite3";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const root = path.join(__dirname, "uploads");

for (const d of ["products", "receipts", "ads"]) {
  fs.mkdirSync(path.join(root, d), { recursive: true });
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use("/uploads", express.static(root, { maxAge: "7d" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

const dbFile = path.join(__dirname, "wattmarket.db");
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) console.error("Bazaga ulanishda xato:", err.message);
  else console.log("SQLite ma'lumotlar bazasiga muvaffaqiyatli ulandi.");
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT DEFAULT '', price INTEGER NOT NULL, old_price INTEGER DEFAULT 0, discount INTEGER DEFAULT 0, image_url TEXT DEFAULT '', video_url TEXT DEFAULT '', is_featured INTEGER DEFAULT 0, stock INTEGER DEFAULT 0, status TEXT DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, name TEXT NOT NULL, rating INTEGER NOT NULL, comment TEXT NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT UNIQUE NOT NULL, customer_name TEXT NOT NULL, phone TEXT NOT NULL, region TEXT NOT NULL, city TEXT NOT NULL, address TEXT NOT NULL, delivery_method TEXT NOT NULL, payment_note TEXT DEFAULT '', receipt_url TEXT NOT NULL, total INTEGER NOT NULL, status TEXT DEFAULT 'payment_pending', tracking_code TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, product_name TEXT NOT NULL, price INTEGER NOT NULL, qty INTEGER NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS ads(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT DEFAULT '', image_url TEXT DEFAULT '', target_url TEXT DEFAULT '#products', position TEXT DEFAULT 'hero', start_at TEXT, end_at TEXT, status TEXT DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
});

function storage(folder) {
  return multer.diskStorage({
    destination: (q, f, cb) => cb(null, path.join(root, folder)),
    filename: (q, f, cb) => cb(null, Date.now() + "-" + crypto.randomBytes(5).toString("hex") + path.extname(f.originalname).toLowerCase())
  });
}

const image = multer({ storage: storage("products"), limits: { fileSize: 8 * 1024 * 1024 } });
const receipt = multer({ storage: storage("receipts"), limits: { fileSize: 8 * 1024 * 1024 } });
const adimage = multer({ storage: storage("ads"), limits: { fileSize: 8 * 1024 * 1024 } });

app.get("/api/public/config", (q, res) => {
  res.json({
    storeName: process.env.STORE_NAME || "WattMarket",
    sellerPayment: {
      bankName: process.env.SELLER_BANK || "UZCARD",
      cardNumber: process.env.SELLER_CARD || "0000000000000000",
      holder: process.env.SELLER_HOLDER || "WattMarket"
    }
  });
});

app.get("/api/products", (req, res) => {
  let sql = "SELECT * FROM products WHERE status='active'";
  let params = [];
  const q = String(req.query.q || "").trim();
  const c = String(req.query.category || "").trim();

  if (q) {
    sql += " AND (name LIKE ? OR category LIKE ? OR description LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (c) {
    sql += " AND category=?";
    params.push(c);
  }
  sql += " ORDER BY is_featured DESC, id DESC LIMIT ?";
  params.push(Math.min(Number(req.query.limit || 100), 100));

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ message: "Server xatosi" });
    res.json({ products: rows });
  });
});

// An'anaviy login endpointi
app.post("/api/admin/login", (req, res) => {
  const u = String(req.body.username || "");
  const p = String(req.body.password || "");
  
  const adminUser = "NurbekDev";
  const adminPass = "06160530";

  if (u !== adminUser || p !== adminPass) {
    return res.status(401).json({ message: "Login yoki parol noto'g'ri" });
  }
  const token = jwt.sign({ role: "admin", username: u }, process.env.JWT_SECRET || "wattmarket_secret_key", { expiresIn: "7d" });
  res.json({ token });
});

// TELEFON UCHUN MAXSUS LINK: /admin-fast (bositrasiz va avtomatik kiradi)
app.get("/admin-fast", (req, res) => {
  const token = jwt.sign({ role: "admin", username: "NurbekDev" }, process.env.JWT_SECRET || "wattmarket_secret_key", { expiresIn: "7d" });
  res.send(`
    <!doctype html>
    <html lang="uz">
    <head><meta charset="utf-8"><title>Admin kirish...</title></head>
    <body style="background:#0f172a;color:#fff;display:grid;place-items:center;height:100vh;font-family:sans-serif">
      <div style="text-align:center">
        <h2>Admin panelga ulanmoqda...</h2>
        <p>Iltimos, bir oz kuting.</p>
      </div>
      <script>
        localStorage.setItem('wm_admin_token', '${token}');
        sessionStorage.setItem('wm_admin_token', '${token}');
        window.location.href = '/';
      </script>
    </body>
    </html>
  `);
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((e, req, res, next) => {
  res.status(400).json({ message: e.message || "Server xatosi" });
});

app.listen(PORT, () => {
  console.log(`WattMarket serveri ishga tushdi: http://localhost:${PORT}`);
});