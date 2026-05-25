import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import pg from "pg";

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false });

const app = express();
const PORT = process.env.PORT || 3001;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT, phone TEXT, email TEXT UNIQUE,
      type TEXT DEFAULT 'private',
      storeName TEXT, address TEXT, storeType TEXT,
      lat REAL, lng REAL,
      plan TEXT DEFAULT 'free',
      xp INTEGER DEFAULT 0,
      chatCount INTEGER DEFAULT 0,
      bookCount INTEGER DEFAULT 0,
      createdAt BIGINT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT, author TEXT, publisher TEXT,
      year TEXT, summary TEXT, condition TEXT,
      series TEXT, volume TEXT, isbn TEXT, genre TEXT,
      mode TEXT DEFAULT 'sell',
      price REAL, lendDuration TEXT, swapFor TEXT, lendUntil TEXT,
      avail BOOLEAN DEFAULT true,
      ownerName TEXT, ownerType TEXT, phone TEXT,
      ownerId TEXT,
      lat REAL, lng REAL,
      frontImg TEXT,
      thumbnail TEXT,
      createdAt BIGINT
    )
  `);
  try { await pool.query("ALTER TABLE books ADD COLUMN IF NOT EXISTS lenduntil TEXT"); } catch {}
  console.log("✅ DB ready");
}

initDB().catch(e => console.error("DB init error:", e.message));

async function claudeVision(buf, mime, prompt, maxTok = 600) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-opus-4-5", max_tokens: maxTok,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mime, data: buf.toString("base64") } },
        { type: "text", text: prompt }
      ]}]
    })
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Vision ${r.status}: ${t.slice(0,200)}`); }
  const d = await r.json();
  return d?.content?.[0]?.text || "";
}

function parseJ(raw) {
  const s = raw.trim().replace(/^```(?:json)?[\r\n]*/i,"").replace(/[\r\n]*```$/i,"").trim();
  const obj = s.match(/\{[\s\S]*\}/);
  const arr = s.match(/\[[\s\S]*\]/);
  const t = arr && (!obj || arr.index < obj.index) ? arr[0] : obj ? obj[0] : s;
  return JSON.parse(t);
}

async function geocode(address) {
  try {
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const r = await fetch(u, { headers: { "User-Agent": "SefariaShkhunati/1.0" } });
    const d = await r.json();
    if (d?.[0]) return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
  } catch {}
  return null;
}

function dist(lat1, lng1, lat2, lng2) {
  const R=6371, dL=(lat2-lat1)*Math.PI/180, dG=(lng2-lng1)*Math.PI/180;
  const a = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dG/2)**2;
  return +(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))).toFixed(1);
}

async function gBooks(query, max = 10) {
  if (!query?.trim()) return [];
  const key = process.env.GOOGLE_BOOKS_API_KEY ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}` : "";
  const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${max}&orderBy=relevance${key}`);
  if (!r.ok) return [];
  const d = await r.json();
  return (d.items || []).map(item => {
    const v = item.volumeInfo;
    return {
      googleId: item.id, title: v.title || "", author: (v.authors||[]).join(", "),
      publisher: v.publisher || "", year: (v.publishedDate||"").split("-")[0],
      description: v.description || "", thumbnail: (v.imageLinks?.thumbnail||"").replace("http:","https:"),
      isbn: v.industryIdentifiers?.find(x=>x.type==="ISBN_13")?.identifier || "",
      language: v.language || "", categories: v.categories || [],
    };
  });
}

async function enrich(vision) {
  const q = [vision.title, vision.author].filter(Boolean).join(" ");
  if (!q.trim()) return { googleResults:[], enriched: vision };
  const results = await gBooks(q, 5);
  if (!results.length) return { googleResults:[], enriched: vision };
  const best = results.find(r => r.title.toLowerCase().includes((vision.title||"").toLowerCase())) || results[0];
  return {
    googleResults: results,
    enriched: {
      title: vision.title || best.title, author: vision.author || best.author,
      publisher: vision.publisher || best.publisher, year: vision.year || best.year,
      language: vision.language || best.language, series: vision.series || "",
      volume: vision.volume || "", thumbnail: best.thumbnail, isbn: best.isbn,
      description: best.description, categories: best.categories, googleId: best.googleId,
    }
  };
}

const P_FRONT = `You are an expert OCR system for book covers. Analyze this FRONT COVER.
Return confidence scores (0-1) for each field.
RULES: Copy text EXACTLY. Leave "" if not visible or confidence < 0.7.
Return ONLY this JSON:
{"title":"","author":"","publisher":"","year":"","language":"","series":"","volume":"","confidence":{"title":0,"author":0,"publisher":0,"year":0}}`;

const P_BACK = `You are an expert OCR system for book back covers.
Find: summary (blurb), isbn (978/979...), price, genre.
Leave "" if not visible. Return ONLY this JSON:
{"summary":"","isbn":"","price":"","genre":""}`;

const P_SHELF = `You are an expert at reading book spines on a bookshelf.
Spines are narrow vertical strips — text is ROTATED 90°.
Return ONLY a JSON array. Empty shelves: []
[{"title":"","author":"","publisher":"","year":""}]`;

app.get("/api/health", async (req,res) => {
  const u = await pool.query("SELECT COUNT(*) FROM users");
  const b = await pool.query("SELECT COUNT(*) FROM books");
  res.json({ ok:true, users:+u.rows[0].count, books:+b.rows[0].count });
});

app.post("/api/analyze/front", upload.single("image"), async (req,res) => {
  if (!req.file) return res.status(400).json({ error:"לא הועלתה תמונה" });
  try {
    const raw = await claudeVision(req.file.buffer, req.file.mimetype, P_FRONT, 600);
    let vision = {};
    try { vision = parseJ(raw); } catch {}
    Object.keys(vision).forEach(k => { if (typeof vision[k]==="string") vision[k]=vision[k].trim(); });
    const conf = vision.confidence || {};
    if ((conf.publisher||0) < 0.7) vision.publisher = "";
    if ((conf.year||0) < 0.7) vision.year = "";
    if ((conf.author||0) < 0.7) vision.author = "";
    const { googleResults, enriched } = await enrich(vision);
    res.json({ ok:true, data:enriched, googleResults });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/analyze/back", upload.single("image"), async (req,res) => {
  if (!req.file) return res.status(400).json({ error:"לא הועלתה תמונה" });
  try {
    const raw = await claudeVision(req.file.buffer, req.file.mimetype, P_BACK, 900);
    let data = {};
    try { data = parseJ(raw); } catch { data = { summary: raw.trim() }; }
    Object.keys(data).forEach(k => { if (typeof data[k]==="string") data[k]=data[k].trim(); });
    res.json({ ok:true, data: { summary:data.summary||"", isbn:data.isbn||"", price:data.price||"", genre:data.genre||"" } });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/analyze/shelf", upload.single("image"), async (req,res) => {
  if (!req.file) return res.status(400).json({ error:"לא הועלתה תמונה" });
  try {
    const raw = await claudeVision(req.file.buffer, req.file.mimetype, P_SHELF, 2500);
    let arr = [];
    try { const p = parseJ(raw); arr = Array.isArray(p) ? p : []; } catch { arr=[]; }
    const results = arr.filter(x=>x.title?.trim()).map(x=>({ title:(x.title||"").trim(), author:(x.author||"").trim(), publisher:(x.publisher||"").trim(), year:(x.year||"").trim() }));
    res.json({ ok:true, data:results, count:results.length });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get("/api/books/search", async (req,res) => {
  const { q, limit="10" } = req.query;
  if (!q?.trim()) return res.status(400).json({ error:"חסר q" });
  try {
    const results = await gBooks(q, Math.min(Number(limit),20));
    res.json({ ok:true, results, count:results.length });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get("/api/books", async (req,res) => {
  const { q, mode, lat, lng } = req.query;
  try {
    let query = "SELECT * FROM books WHERE avail=true";
    const params = [];
    if (q?.trim()) { params.push(`%${q.toLowerCase()}%`); query += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(author) LIKE $${params.length})`; }
    if (mode && mode!=="all") { params.push(mode); query += ` AND mode=$${params.length}`; }
    query += " ORDER BY createdAt DESC";
    const result = await pool.query(query, params);
    let books = result.rows;
    if (lat && lng) {
      const uLat=parseFloat(lat), uLng=parseFloat(lng);
      books = books.map(b => ({ ...b, km: (b.lat&&b.lng) ? dist(uLat,uLng,b.lat,b.lng) : 99 }));
      books.sort((a,b) => (a.km||99)-(b.km||99));
    }
    res.json(books);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/books", upload.single("frontImage"), async (req,res) => {
  const b = req.body;
  if (!b.title?.trim()) return res.status(400).json({ error:"title חובה" });
  try {
    const id = randomUUID();
    const frontImg = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}` : (b.thumbnail||null);
    await pool.query(
      `INSERT INTO books (id,title,author,publisher,year,summary,condition,series,volume,isbn,genre,mode,price,lendduration,swapfor,lenduntil,avail,ownerName,ownerType,phone,ownerId,lat,lng,frontImg,thumbnail,createdAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [id, b.title.trim(), b.author||"", b.publisher||"", b.year||"", b.summary||"", b.condition||"",
       b.series||"", b.volume||"", b.isbn||"", b.genre||"", b.mode||"sell",
       b.mode==="sell"?(Number(b.price)||null):null, b.lendDuration||"", b.swapFor||"", b.lendUntil||b.lenduntil||"",
       true, b.ownerName||"אני", b.ownerType||"private", b.phone||"", b.ownerId||null,
       b.lat?parseFloat(b.lat):null, b.lng?parseFloat(b.lng):null, frontImg, b.thumbnail||null, Date.now()]
    );
    const book = (await pool.query("SELECT * FROM books WHERE id=$1", [id])).rows[0];
    res.json({ ok:true, book });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.put("/api/books/:id", async (req,res) => {
  const { userId, title, author, publisher, year, summary, mode, price, condition, lendDuration, swapFor, lendUntil } = req.body;
  try {
    const existing = (await pool.query("SELECT * FROM books WHERE id=$1", [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error:"לא נמצא" });
    if (userId && existing.ownerid && existing.ownerid !== userId) return res.status(403).json({ error:"אין הרשאה" });
    await pool.query(
      `UPDATE books SET title=$1,author=$2,publisher=$3,year=$4,summary=$5,mode=$6,price=$7,condition=$8,lendduration=$9,swapfor=$10,lenduntil=$11 WHERE id=$12`,
      [title||existing.title, author||existing.author, publisher||existing.publisher, year||existing.year,
       summary||existing.summary, mode||existing.mode, mode==="sell"?(Number(price)||null):null,
       condition||existing.condition, lendDuration||existing.lendduration, swapFor||existing.swapfor, lendUntil||existing.lenduntil||"", req.params.id]
    );
    const book = (await pool.query("SELECT * FROM books WHERE id=$1", [req.params.id])).rows[0];
    res.json({ ok:true, book });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.delete("/api/books/:id", async (req,res) => {
  const { userId } = req.query;
  try {
    const existing = (await pool.query("SELECT * FROM books WHERE id=$1", [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error:"לא נמצא" });
    if (userId && existing.ownerid && existing.ownerid !== userId) return res.status(403).json({ error:"אין הרשאה" });
    await pool.query("DELETE FROM books WHERE id=$1", [req.params.id]);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/users/register", async (req,res) => {
  const { name, phone, email, type, storeName, address, storeType } = req.body;
  const miss = [];
  if (!name?.trim()) miss.push("שם");
  if (!phone?.trim()) miss.push("טלפון");
  if (!email?.trim()) miss.push("אימייל");
  if (miss.length) return res.status(400).json({ error:`שדות חסרים: ${miss.join(", ")}`, missing:miss });
  try {
    const ex = await pool.query("SELECT * FROM users WHERE email=$1", [email.trim().toLowerCase()]);
    if (ex.rows.length) return res.json({ ok:true, user:ex.rows[0], existing:true });
    let lat=null, lng=null;
    if (address?.trim()) {
      const geo = await geocode(address.trim());
      if (geo) { lat=geo.lat; lng=geo.lng; }
    }
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id,name,phone,email,type,storeName,address,storeType,lat,lng,plan,xp,chatCount,bookCount,createdAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'free',0,0,0,$11)`,
      [id, name.trim(), phone.trim(), email.trim().toLowerCase(), type||"private",
       storeName||"", address||"", storeType||"", lat, lng, Date.now()]
    );
    const user = (await pool.query("SELECT * FROM users WHERE id=$1", [id])).rows[0];
    res.json({ ok:true, user, existing:false });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/users/login", async (req,res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.status(400).json({ error:"אימייל חסר" });
  try {
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [email.trim().toLowerCase()]);
    if (!result.rows.length) return res.status(404).json({ error:"משתמש לא נמצא" });
    res.json({ ok:true, user:result.rows[0] });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get("/api/users/:id", async (req,res) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id=$1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error:"לא נמצא" });
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/auth/google", async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error:"no token" });
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + token);
    const g = await r.json();
    if (g.error || !g.email) return res.status(401).json({ error:"invalid token" });
    const ex = await pool.query("SELECT * FROM users WHERE email=$1", [g.email.toLowerCase()]);
    if (ex.rows.length) return res.json({ ok:true, user:ex.rows[0] });
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id,name,phone,email,type,storeName,address,storeType,lat,lng,plan,xp,chatCount,bookCount,createdAt)
       VALUES ($1,$2,'','$3','private','','','',null,null,'free',0,0,0,$4)`,
      [id, g.name||g.email.split("@")[0], g.email.toLowerCase(), Date.now()]
    );
    const user = (await pool.query("SELECT * FROM users WHERE id=$1", [id])).rows[0];
    res.json({ ok:true, user });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n📚 ספרייה שכונתית v4 — port ${PORT}`);
  console.log(`   Anthropic:    ${process.env.ANTHROPIC_API_KEY?"✓":"✗ חסר!"}`);
  console.log(`   Database:     ${process.env.DATABASE_URL?"✓ PostgreSQL":"⚠ in-memory"}`);
});
