import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import cron from "node-cron";
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
      city TEXT,
      frontImg TEXT,
      thumbnail TEXT,
      createdAt BIGINT
    )
  `);
  try { await pool.query("ALTER TABLE books ADD COLUMN IF NOT EXISTS lenduntil TEXT"); } catch {}
  try { await pool.query("ALTER TABLE books ADD COLUMN IF NOT EXISTS city TEXT"); } catch {}
  try { await pool.query("ALTER TABLE books ADD COLUMN IF NOT EXISTS dealstatus TEXT"); } catch {}
  try { await pool.query("ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ownerAsked BOOLEAN DEFAULT false"); } catch {}
  try { await pool.query("ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ownerConfirmed BOOLEAN DEFAULT false"); } catch {}
  try { await pool.query(`CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    bookId TEXT,
    bookTitle TEXT,
    fromUserId TEXT,
    toUserId TEXT,
    type TEXT,
    status TEXT DEFAULT 'pending',
    askedStatus BOOLEAN DEFAULT false,
    createdAt BIGINT
  )`); } catch(e) { console.error("contacts table error:", e.message); }
  try { await pool.query(`CREATE TABLE IF NOT EXISTS analytics (
    id TEXT PRIMARY KEY,
    event TEXT,
    userId TEXT,
    data JSONB,
    city TEXT,
    createdAt BIGINT
  )`); } catch(e) { console.error("analytics table error:", e.message); }
  console.log("✅ DB ready");
}

initDB().catch(e => console.error("DB init error:", e.message));

// ── Analytics ────────────────────────────────────────────
async function track(event, userId, data, city) {
  try {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO analytics (id,event,userId,data,city,createdAt) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, event, userId||null, JSON.stringify(data||{}), city||null, Date.now()]
    );
  } catch {}
}

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

function mapGenre(categories) {
  if (!categories || !categories.length) return "";
  const c = categories.join(" ").toLowerCase();
  if (c.includes("fiction") || c.includes("novel") || c.includes("literature")) return "ספרות ורומנים";
  if (c.includes("thriller") || c.includes("mystery") || c.includes("crime") || c.includes("detective")) return "מתח";
  if (c.includes("fantasy") || c.includes("science fiction") || c.includes("sci-fi")) return "מדע בדיוני ופנטזיה";
  if (c.includes("romance") || c.includes("love")) return "אהבה ורומנטיקה";
  if (c.includes("history")) return "היסטוריה";
  if (c.includes("biography") || c.includes("autobiography") || c.includes("memoir")) return "ביוגרפיה";
  if (c.includes("science") || c.includes("philosophy")) return "מדע ופילוסופיה";
  if (c.includes("self-help") || c.includes("personal development") || c.includes("psychology")) return "פיתוח אישי";
  if (c.includes("business") || c.includes("economics") || c.includes("finance")) return "עסקים וכלכלה";
  if (c.includes("children") || c.includes("juvenile") || c.includes("young adult")) return "ילדים ונוער";
  if (c.includes("cooking") || c.includes("food")) return "בישול ואפייה";
  if (c.includes("poetry")) return "שירה";
  if (c.includes("religion") || c.includes("jewish") || c.includes("spiritual")) return "יהדות ורוחניות";
  return "אחר";
}

async function reverseGeocode(lat, lng) {
  try {
    const u = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`;
    const r = await fetch(u, { headers: { "User-Agent": "SefariaShkhunati/1.0" } });
    const d = await r.json();
    return d?.address?.city || d?.address?.town || d?.address?.village || d?.address?.suburb || null;
  } catch {}
  return null;
}

function dist(lat1, lng1, lat2, lng2) {
  const R=6371, dL=(lat2-lat1)*Math.PI/180, dG=(lng2-lng1)*Math.PI/180;
  const a = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dG/2)**2;
  return +(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))).toFixed(1);
}

async function openLibrary(isbn) {
  try {
    const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, {
      headers: { "User-Agent": "Pageturner/1.0 (pageturner.co.il)" }
    });
    if (!r.ok) return null;
    const d = await r.json();
    const book = d[`ISBN:${isbn}`];
    if (!book) return null;
    return {
      title: book.title || "",
      author: (book.authors||[]).map(a=>a.name).join(", "),
      publisher: (book.publishers||[]).map(p=>p.name).join(", "),
      year: book.publish_date ? book.publish_date.match(/\d{4}/)?.[0] || "" : "",
      isbn,
      thumbnail: book.cover?.medium || book.cover?.small || "",
      description: book.excerpts?.[0]?.text || "",
    };
  } catch { return null; }
}

async function gBooks(query, max = 10, lang = "") {
  if (!query?.trim()) return [];
  const key = process.env.GOOGLE_BOOKS_API_KEY ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}` : "";
  const langFilter = lang ? `&langRestrict=${lang}` : "";
  const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${max}&orderBy=relevance${key}${langFilter}`);
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
  let results = [];
  const q = [vision.title, vision.author].filter(Boolean).join(" ");

  // 1. Open Library לפי ISBN — הכי מדויק
  if (vision.isbn) {
    const ol = await openLibrary(vision.isbn);
    if (ol) {
      return {
        googleResults: [],
        enriched: {
          title: vision.title || ol.title,
          author: vision.author || ol.author,
          publisher: ol.publisher || vision.publisher,
          year: ol.year || vision.year,
          language: vision.language || "",
          series: vision.series || "",
          volume: vision.volume || "",
          thumbnail: ol.thumbnail || "",
          isbn: ol.isbn,
          description: ol.description,
          categories: [],
          googleId: "",
        }
      };
    }
  }

  // 2. Google Books לפי ISBN
  if (vision.isbn) {
    results = await gBooks(`isbn:${vision.isbn}`, 3);
  }
  // 3. Google Books בעברית
  if (!results.length && q.trim()) {
    results = await gBooks(q, 5, "he");
  }
  // 4. Google Books בכל שפה
  if (!results.length && q.trim()) {
    results = await gBooks(q, 8);
  }
  if (!results.length) return { googleResults:[], enriched: vision };
  // בחר את התוצאה הטובה ביותר — עדיפות לעברית, אחר כך לפי התאמת כותרת
  const titleLow = (vision.title||"").toLowerCase();
  const hebrewMatches = results.filter(r => r.language === "he" || r.language === "iw");
  const pool = hebrewMatches.length ? hebrewMatches : results;
  const best = pool.find(r => r.title.toLowerCase().includes(titleLow)) ||
               pool.find(r => titleLow.includes(r.title.toLowerCase())) ||
               pool[0];
  return {
    googleResults: results,
    enriched: {
      title: vision.title || best.title, author: vision.author || best.author,
      publisher: best.publisher || vision.publisher, year: best.year || vision.year,
      language: vision.language || best.language, series: vision.series || "",
      volume: vision.volume || "", thumbnail: best.thumbnail, isbn: best.isbn,
      description: best.description, categories: best.categories, googleId: best.googleId, genre: mapGenre(best.categories),
    }
  };
}

const P_FRONT = `You are an expert OCR and bibliographic system for book covers. Analyze this FRONT COVER image carefully.
RULES:
- Copy ALL text EXACTLY as it appears, including subtitles
- For publisher: look for small text at bottom of cover, spine edge, or logo
- For year: look for copyright year or edition year anywhere on cover
- For series/volume: look for series name or number
- Leave "" if not clearly visible
- confidence: 0-1 score for each field
Return ONLY this JSON, no other text:
{"title":"","author":"","publisher":"","year":"","language":"","series":"","volume":"","confidence":{"title":0,"author":0,"publisher":0,"year":0}}`;

const P_BACK = `You are an expert OCR and bibliographic system for book back covers.
RULES:
- isbn: look for barcode area, find 13-digit number starting with 978 or 979
- publisher: look for publisher name/logo anywhere
- year: look for copyright symbol © followed by year
- summary: the main descriptive text/blurb about the book
- price: any price in any currency
- genre: category of the book
Leave "" if not clearly visible. Return ONLY this JSON:
{"summary":"","isbn":"","publisher":"","year":"","price":"","genre":""}`;

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
    console.log("VISION:", JSON.stringify(vision));
    const { googleResults, enriched } = await enrich(vision);
    console.log("GOOGLE_RESULTS:", JSON.stringify(googleResults.map(r=>({t:r.title,p:r.publisher,y:r.year}))));
    console.log("ENRICHED:", JSON.stringify(enriched));
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
    // אם יש ISBN — חפש ב-Google Books לנתונים מדויקים
    let googleData = {};
    if (data.isbn && data.isbn.match(/^97[89]/)) {
      const results = await gBooks(`isbn:${data.isbn}`, 1);
      if (results.length) {
        googleData = { publisher: results[0].publisher, year: results[0].year, title: results[0].title, author: results[0].author, thumbnail: results[0].thumbnail };
      }
    }
    res.json({ ok:true, data: { summary:data.summary||"", isbn:data.isbn||"", price:data.price||"", genre:data.genre||"", publisher:googleData.publisher||data.publisher||"", year:googleData.year||data.year||"", googleTitle:googleData.title||"", googleAuthor:googleData.author||"", thumbnail:googleData.thumbnail||"" } });
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
  const { q, mode, lat, lng, ownerId, all, genre } = req.query;
  try {
    let query = ownerId && all ? "SELECT * FROM books WHERE ownerid=$1" : "SELECT * FROM books WHERE avail=true";
    if (ownerId && all) {
      const result = await pool.query(query, [ownerId]);
      return res.json(result.rows);
    }
    const params = [];
    if (q?.trim()) { params.push(`%${q.toLowerCase()}%`); query += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(author) LIKE $${params.length})`; }
    if (mode && mode!=="all") { params.push(mode); query += ` AND mode=$${params.length}`; }
    if (genre && genre!=="all") { params.push(genre); query += ` AND genre=$${params.length}`; }
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
    console.log("UPLOAD lat/lng:", b.lat, b.lng);
      const city = (b.lat && b.lng) ? await reverseGeocode(parseFloat(b.lat), parseFloat(b.lng)) : null;
      console.log("CITY:", city);
    await pool.query(
      `INSERT INTO books (id,title,author,publisher,year,summary,condition,series,volume,isbn,genre,mode,price,lendduration,swapfor,lenduntil,avail,ownerName,ownerType,phone,ownerId,lat,lng,city,frontImg,thumbnail,createdAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [id, b.title.trim(), b.author||"", b.publisher||"", b.year||"", b.summary||"", b.condition||"",
       b.series||"", b.volume||"", b.isbn||"", b.genre||"", b.mode||"sell",
       b.mode==="sell"?(Number(b.price)||null):null, b.lendDuration||"", b.swapFor||"", b.lendUntil||b.lenduntil||"",
       true, b.ownerName||"אני", b.ownerType||"private", b.phone||"", b.ownerId||null,
       b.lat?parseFloat(b.lat):null, b.lng?parseFloat(b.lng):null, city, frontImg, b.thumbnail||null, Date.now()]
    );
    const book = (await pool.query("SELECT * FROM books WHERE id=$1", [id])).rows[0];
    track("book_publish", b.ownerId, { bookId: id, title: b.title, mode: b.mode, city });
    res.json({ ok:true, book });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.put("/api/books/:id", async (req,res) => {
  const { userId, title, author, publisher, year, summary, mode, price, condition, lendDuration, swapFor, lendUntil, avail, lat, lng, dealStatus } = req.body;
  try {
    const existing = (await pool.query("SELECT * FROM books WHERE id=$1", [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error:"לא נמצא" });
    if (userId && existing.ownerid && existing.ownerid !== userId) return res.status(403).json({ error:"אין הרשאה" });
    await pool.query(
      `UPDATE books SET title=$1,author=$2,publisher=$3,year=$4,summary=$5,mode=$6,price=$7,condition=$8,lendduration=$9,swapfor=$10,lenduntil=$11,avail=$12,lat=$13,lng=$14,city=$15,dealstatus=$16 WHERE id=$17`,
      [title||existing.title, author||existing.author, publisher||existing.publisher, year||existing.year,
       summary||existing.summary, mode||existing.mode, mode==="sell"?(Number(price)||null):null,
       condition||existing.condition, lendDuration||existing.lendduration, swapFor||existing.swapfor, lendUntil||existing.lenduntil||"", avail!==undefined?avail:existing.avail, lat?parseFloat(lat):existing.lat, lng?parseFloat(lng):existing.lng, lat&&lng?(await reverseGeocode(parseFloat(lat),parseFloat(lng)))||existing.city:existing.city, dealStatus||existing.dealstatus||null, req.params.id]
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
    track("login", result.rows[0].id, { email: email.trim().toLowerCase() });
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

// ── OTP ──────────────────────────────────────────────────
const otps = {};

// ── Contacts ──────────────────────────────────────────────
app.post("/api/contacts", async (req, res) => {
  const { bookId, bookTitle, fromUserId, toUserId, type } = req.body;
  if (!bookId || !fromUserId) return res.status(400).json({ error:"חסרים פרטים" });
  try {
    const existing = await pool.query("SELECT * FROM contacts WHERE bookId=$1 AND fromUserId=$2 ORDER BY createdat DESC LIMIT 1", [bookId, fromUserId]);
    if (existing.rows.length) {
      const c = existing.rows[0];
      // אם הישן הוא pending — החזר אותו
      if (c.status === "pending" && !c.askedstatus) return res.json({ ok:true, contact: c });
      // אחרת (no, done, skip) — צור חדש
    }
    const id = randomUUID();
    await pool.query(
      "INSERT INTO contacts (id,bookId,bookTitle,fromUserId,toUserId,type,status,askedStatus,createdAt) VALUES ($1,$2,$3,$4,$5,$6,'pending',false,$7)",
      [id, bookId, bookTitle||"", fromUserId, toUserId||"", type||"whatsapp", Date.now()]
    );
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get("/api/contacts/owner-pending/:userId", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, b.title as booktitle, u.name as interestedname 
       FROM contacts c 
       LEFT JOIN books b ON c.bookid=b.id 
       LEFT JOIN users u ON c.fromuserid=u.id
       WHERE c.touserid=$1 AND c.status='done' AND c.ownerasked=false 
       ORDER BY c.createdat DESC LIMIT 1`,
      [req.params.userId]
    );
    res.json(result.rows[0] || null);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get("/api/contacts/pending/:userId", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT c.*, b.title as booktitle FROM contacts c LEFT JOIN books b ON c.bookid=b.id WHERE c.fromuserid=$1 AND c.status='pending' AND c.askedstatus=false ORDER BY c.createdat DESC LIMIT 1",
      [req.params.userId]
    );
    res.json(result.rows[0] || null);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.put("/api/contacts/:id", async (req, res) => {
  try {
    const { status, dealStatus, bookId, markAsked, confirmedByOwner } = req.body;
    await pool.query("UPDATE contacts SET status=$1, askedStatus=$2 WHERE id=$3", [status, markAsked===true, req.params.id]);

    if (status === "done") {
      // המתעניין אישר — נשלח שאלה למפרסם
      // המתעניין אישר — סמן שצריך לשאול את המפרסם
    }

    if (confirmedByOwner !== undefined) {
      // המפרסם ענה (כן או לא) — סמן ownerAsked=true כדי שלא ישאלו שוב
      await pool.query("UPDATE contacts SET ownerAsked=true WHERE id=$1", [req.params.id]);
    }
    if (confirmedByOwner && bookId) {
      // המפרסם אישר — בדוק אם גם המתעניין אישר
      const contact = (await pool.query("SELECT * FROM contacts WHERE id=$1", [req.params.id])).rows[0];
      if (contact && contact.status === "done") {
        // שניהם אישרו — הורד מזמינות
        await pool.query("UPDATE books SET avail=false, dealstatus=$1 WHERE id=$2", [dealStatus||"agreed", bookId]);
      }
    }

    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── Admin ────────────────────────────────────────────────
app.post("/api/analytics", async (req, res) => {
  const { event, data, userId } = req.body;
  if (!event) return res.status(400).json({ error:"event חסר" });
  try {
    await track(event, userId||null, data||{});
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/stats", async (req, res) => {
  const { key } = req.query;
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error:"unauthorized" });
  try {
    const now = Date.now();
    const day = 86400000;
    const week = day * 7;
    const month = day * 30;

    const [users, books, contacts, todayUsers, weekUsers, monthUsers,
           todayBooks, weekBooks, monthBooks, todayContacts, cities, hourly] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM users"),
      pool.query("SELECT COUNT(*) FROM books WHERE avail=true"),
      pool.query("SELECT COUNT(*) FROM contacts WHERE status='done'"),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event='register' AND createdat>$1", [now-day]),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event='register' AND createdat>$1", [now-week]),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event='register' AND createdat>$1", [now-month]),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event='book_publish' AND createdat>$1", [now-day]),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event='book_publish' AND createdat>$1", [now-week]),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event='book_publish' AND createdat>$1", [now-month]),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event IN ('login','register') AND createdat>$1", [now-day]),
      pool.query("SELECT city, COUNT(*) as cnt FROM books WHERE city IS NOT NULL AND city!='' GROUP BY city ORDER BY cnt DESC LIMIT 10"),
      pool.query("SELECT EXTRACT(HOUR FROM to_timestamp(createdat/1000)) as hour, COUNT(*) as cnt FROM analytics WHERE createdat>$1 GROUP BY hour ORDER BY hour", [now-week]),
    ]);

    res.json({
      totals: { users: +users.rows[0].count, books: +books.rows[0].count, deals: +contacts.rows[0].count },
      today: { users: +todayUsers.rows[0].count, books: +todayBooks.rows[0].count, logins: +todayContacts.rows[0].count },
      week: { users: +weekUsers.rows[0].count, books: +weekBooks.rows[0].count },
      month: { users: +monthUsers.rows[0].count, books: +monthBooks.rows[0].count },
      cities: cities.rows,
      hourly: hourly.rows,
    });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/auth/send-otp", async (req, res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.status(400).json({ error:"אימייל חסר" });
  
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  otps[email.toLowerCase()] = { code, expires: Date.now() + 10 * 60 * 1000 };
  
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Pageturner <noreply@pageturner.co.il>",
        to: [email.trim()],
        subject: "קוד הכניסה שלך ל-Pageturner",
        html: `<div dir="rtl" style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px">
          <h2 style="color:#0e0c08">📚 Pageturner</h2>
          <p>קוד הכניסה שלך:</p>
          <div style="font-size:36px;font-weight:900;letter-spacing:8px;color:#b5390e;padding:16px;background:#fef8ec;border-radius:12px;text-align:center">${code}</div>
          <p style="color:#888;font-size:12px">הקוד תקף ל-10 דקות</p>
        </div>`
      })
    });
    if (!r.ok) { const t = await r.json(); throw new Error(t.message||"שגיאה בשליחה"); }
    res.json({ ok: true });
  } catch(e) {
    console.error("OTP error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/verify-otp", async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error:"חסרים פרטים" });
  
  const stored = otps[email.toLowerCase()];
  if (!stored) return res.status(400).json({ error:"לא נשלח קוד לכתובת זו" });
  if (Date.now() > stored.expires) return res.status(400).json({ error:"הקוד פג תוקף" });
  if (stored.code !== code) return res.status(400).json({ error:"קוד שגוי" });
  
  delete otps[email.toLowerCase()];
  
  const existing = await pool.query("SELECT * FROM users WHERE email=$1", [email.toLowerCase()]);
  if (existing.rows.length) return res.json({ ok: true, user: existing.rows[0], isNew: false });
  
  res.json({ ok: true, user: null, isNew: true });
});


import cron from 'node-cron';

// ── פונקציית שליחת דוח ──────────────────────────────────
async function sendReport(type) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const now = Date.now();
  const day = 86400000;
  const week = day * 7;
  const month = day * 30;
  const period = type === "daily" ? day : type === "weekly" ? week : month;

  try {
    const [users, books, deals, newUsers, newBooks, newDeals,
           logins, guestLogins, views, searches, contacts, cities, hours] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM users"),
      pool.query("SELECT COUNT(*) FROM books WHERE avail=true"),
      pool.query("SELECT COUNT(*) FROM contacts WHERE status='done'"),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event='register' AND createdat>$1", [now-period]),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event='book_publish' AND createdat>$1", [now-period]),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event IN ('book_deal') AND createdat>$1", [now-period]),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event='login' AND createdat>$1", [now-period]),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event='guest_login' AND createdat>$1", [now-period]),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event='book_view' AND createdat>$1", [now-period]),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event='search' AND createdat>$1", [now-period]),
      pool.query("SELECT COUNT(*) FROM analytics WHERE event='book_contact' AND createdat>$1", [now-period]),
      pool.query("SELECT city, COUNT(*) as cnt FROM books WHERE city IS NOT NULL AND city!='' GROUP BY city ORDER BY cnt DESC LIMIT 5"),
      pool.query("SELECT EXTRACT(HOUR FROM to_timestamp(createdat/1000)) as hour, COUNT(*) as cnt FROM analytics WHERE createdat>$1 GROUP BY hour ORDER BY cnt DESC LIMIT 5", [now-period]),
    ]);

    const periodHe = type === "daily" ? "יומי" : type === "weekly" ? "שבועי" : "חודשי";
    const peakHours = hours.rows.map(h => `${h.hour}:00 (${h.cnt} אירועים)`).join(", ");
    const topCities = cities.rows.map(c => `${c.city}: ${c.cnt}`).join(", ");

    const html = `
<div dir="rtl" style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fef8ec">
  <h1 style="color:#0e0c08;font-size:24px;border-bottom:2px solid #b5390e;padding-bottom:12px">
    📚 Pageturner — דוח ${periodHe}
  </h1>
  <p style="color:#888;font-size:13px">${new Date().toLocaleDateString("he-IL", {weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>

  <h2 style="color:#b5390e;font-size:16px">📊 סיכום כולל</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr style="background:#f0ebe0">
      <td style="padding:10px;border:1px solid #ddd">👥 סה"כ משתמשים</td>
      <td style="padding:10px;border:1px solid #ddd;font-weight:bold;text-align:center">${users.rows[0].count}</td>
    </tr>
    <tr>
      <td style="padding:10px;border:1px solid #ddd">📚 ספרים פעילים</td>
      <td style="padding:10px;border:1px solid #ddd;font-weight:bold;text-align:center">${books.rows[0].count}</td>
    </tr>
    <tr style="background:#f0ebe0">
      <td style="padding:10px;border:1px solid #ddd">🤝 עסקאות שבוצעו</td>
      <td style="padding:10px;border:1px solid #ddd;font-weight:bold;text-align:center">${deals.rows[0].count}</td>
    </tr>
  </table>

  <h2 style="color:#b5390e;font-size:16px;margin-top:20px">📈 פעילות ב${periodHe === "יומי" ? "24 שעות האחרונות" : periodHe === "שבועי" ? "שבוע האחרון" : "חודש האחרון"}</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr style="background:#f0ebe0"><td style="padding:10px;border:1px solid #ddd">✅ הרשמות חדשות</td><td style="padding:10px;border:1px solid #ddd;font-weight:bold;text-align:center">${newUsers.rows[0].count}</td></tr>
    <tr><td style="padding:10px;border:1px solid #ddd">🔑 כניסות משתמשים</td><td style="padding:10px;border:1px solid #ddd;font-weight:bold;text-align:center">${logins.rows[0].count}</td></tr>
    <tr style="background:#f0ebe0"><td style="padding:10px;border:1px solid #ddd">👀 כניסות כאורח</td><td style="padding:10px;border:1px solid #ddd;font-weight:bold;text-align:center">${guestLogins.rows[0].count}</td></tr>
    <tr><td style="padding:10px;border:1px solid #ddd">📖 ספרים חדשים</td><td style="padding:10px;border:1px solid #ddd;font-weight:bold;text-align:center">${newBooks.rows[0].count}</td></tr>
    <tr style="background:#f0ebe0"><td style="padding:10px;border:1px solid #ddd">👁️ צפיות בספרים</td><td style="padding:10px;border:1px solid #ddd;font-weight:bold;text-align:center">${views.rows[0].count}</td></tr>
    <tr><td style="padding:10px;border:1px solid #ddd">🔍 חיפושים</td><td style="padding:10px;border:1px solid #ddd;font-weight:bold;text-align:center">${searches.rows[0].count}</td></tr>
    <tr style="background:#f0ebe0"><td style="padding:10px;border:1px solid #ddd">📱 יצירות קשר</td><td style="padding:10px;border:1px solid #ddd;font-weight:bold;text-align:center">${contacts.rows[0].count}</td></tr>
    <tr><td style="padding:10px;border:1px solid #ddd">🤝 עסקאות חדשות</td><td style="padding:10px;border:1px solid #ddd;font-weight:bold;text-align:center">${newDeals.rows[0].count}</td></tr>
  </table>

  ${topCities ? `<h2 style="color:#b5390e;font-size:16px;margin-top:20px">📍 ערים פעילות</h2><p style="color:#444">${topCities}</p>` : ""}
  ${peakHours ? `<h2 style="color:#b5390e;font-size:16px;margin-top:20px">⏰ שעות שיא</h2><p style="color:#444">${peakHours}</p>` : ""}

  <p style="color:#aaa;font-size:11px;margin-top:30px;border-top:1px solid #ddd;padding-top:12px">
    Pageturner — ספרייה שכונתית | דוח אוטומטי
  </p>
</div>`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Pageturner Reports <noreply@pageturner.co.il>",
        to: [adminEmail],
        subject: `📊 Pageturner — דוח ${periodHe} | ${new Date().toLocaleDateString("he-IL")}`,
        html
      })
    });
    console.log(`✅ דוח ${periodHe} נשלח`);
  } catch(e) { console.error("Report error:", e.message); }
}

// ── Cron Jobs ────────────────────────────────────────────
// יומי — כל יום ב-8:00 בבוקר
cron.schedule("0 8 * * *", () => sendReport("daily"), { timezone: "Asia/Jerusalem" });
// שבועי — כל יום ראשון ב-9:00
cron.schedule("0 9 * * 0", () => sendReport("weekly"), { timezone: "Asia/Jerusalem" });
// חודשי — ראשון בחודש ב-10:00
cron.schedule("0 10 1 * *", () => sendReport("monthly"), { timezone: "Asia/Jerusalem" });

console.log("✅ Cron jobs registered");

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n📚 ספרייה שכונתית v4 — port ${PORT}`);
  console.log(`   Anthropic:    ${process.env.ANTHROPIC_API_KEY?"✓":"✗ חסר!"}`);
  console.log(`   Database:     ${process.env.DATABASE_URL?"✓ PostgreSQL":"⚠ in-memory"}`);
});