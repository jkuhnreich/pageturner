import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { randomUUID } from "crypto";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

let users = [];
let books = [
  { id:"s1", title:"הארי פוטר ואבן החכמים", author:"J.K. רולינג", mode:"lend", avail:true, ownerName:"דנה כהן", ownerType:"private", phone:"050-1234567", lat:32.08, lng:34.78, km:0.3, createdAt:Date.now(), ownerId:"demo1" },
  { id:"s2", title:"1984", author:"George Orwell", mode:"sell", price:22, avail:true, ownerName:"רון שמיר", ownerType:"private", phone:"053-7778889", lat:32.09, lng:34.79, km:1.8, createdAt:Date.now(), ownerId:"demo2" },
];
let demands = [];

async function claudeVision(buf, mime, prompt, maxTok = 600) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: maxTok,
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

app.get("/api/health", (req,res) => res.json({ ok:true, books:books.length, users:users.length }));

app.post("/api/analyze/front", upload.single("image"), async (req,res) => {
  if (!req.file) return res.status(400).json({ error:"לא הועלתה תמונה" });
  try {
    const raw = await claudeVision(req.file.buffer, req.file.mimetype, P_FRONT, 600);
    let vision = {};
    try { vision = parseJ(raw); } catch(e) {}
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

app.get("/api/books", (req,res) => {
  const { q, mode, lat, lng } = req.query;
  let result = [...books];
  if (q?.trim()) { const ql=q.toLowerCase(); result=result.filter(b=>b.title.toLowerCase().includes(ql)||(b.author||"").toLowerCase().includes(ql)); }
  if (mode && mode!=="all") result=result.filter(b=>b.mode===mode);
  if (lat && lng) {
    const uLat=parseFloat(lat), uLng=parseFloat(lng);
    result=result.map(b=>({ ...b, km:(b.lat&&b.lng)?dist(uLat,uLng,b.lat,b.lng):(b.km??99) }));
  }
  result.sort((a,b)=>(a.km??99)-(b.km??99));
  res.json(result);
});

app.post("/api/books", upload.single("frontImage"), (req,res) => {
  const b = req.body;
  if (!b.title?.trim()) return res.status(400).json({ error:"title חובה" });
  const book = {
    id: randomUUID(), title:b.title.trim(), author:b.author?.trim()||"",
    publisher:b.publisher?.trim()||"", year:b.year?.trim()||"",
    summary:b.summary?.trim()||"", condition:b.condition?.trim()||"",
    series:b.series?.trim()||"", volume:b.volume?.trim()||"",
    isbn:b.isbn?.trim()||"", genre:b.genre?.trim()||"",
    mode:b.mode||"sell", price:b.mode==="sell"?(Number(b.price)||null):null,
    lendDuration:b.lendDuration?.trim()||"", swapFor:b.swapFor?.trim()||"",
    avail:true, ownerName:b.ownerName?.trim()||"אני", ownerType:b.ownerType||"private",
    phone:b.phone?.trim()||"", ownerId:b.ownerId||null,
    lat:b.lat?parseFloat(b.lat):null, lng:b.lng?parseFloat(b.lng):null, km:0,
    frontImg: req.file?`data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`:(b.thumbnail||null),
    createdAt:Date.now(),
  };
  books.unshift(book);
  const hit = demands.find(d=>book.title.toLowerCase().includes((d.title||"").toLowerCase()));
  res.json({ ok:true, book, demandMatch:hit||null });
});

app.put("/api/books/:id", (req,res) => {
  const { userId } = req.body;
  const i = books.findIndex(b=>b.id===req.params.id);
  if (i<0) return res.status(404).json({ error:"לא נמצא" });
  if (userId && books[i].ownerId && books[i].ownerId !== userId) {
    return res.status(403).json({ error:"אין הרשאה לערוך ספר זה" });
  }
  books[i] = { ...books[i], ...req.body, id:req.params.id };
  res.json({ ok:true, book:books[i] });
});

app.delete("/api/books/:id", (req,res) => {
  const { userId } = req.query;
  const book = books.find(b=>b.id===req.params.id);
  if (!book) return res.status(404).json({ error:"לא נמצא" });
  if (userId && book.ownerId && book.ownerId !== userId) {
    return res.status(403).json({ error:"אין הרשאה למחוק ספר זה" });
  }
  books = books.filter(b=>b.id!==req.params.id);
  res.json({ ok:true });
});

app.post("/api/users/register", async (req,res) => {
  const { name, phone, email, type, storeName, address, storeType } = req.body;
  const miss = [];
  if (!name?.trim()) miss.push("שם");
  if (!phone?.trim()) miss.push("טלפון");
  if (!email?.trim()) miss.push("אימייל");
  if (miss.length) return res.status(400).json({ error:`שדות חסרים: ${miss.join(", ")}`, missing:miss });
  const ex = users.find(u=>u.email===email.trim().toLowerCase());
  if (ex) return res.json({ ok:true, user:ex, existing:true });
  let lat=null, lng=null;
  if (address?.trim()) {
    const geo = await geocode(address.trim());
    if (geo) { lat=geo.lat; lng=geo.lng; }
  }
  const user = {
    id:randomUUID(), name:name.trim(), phone:phone.trim(), email:email.trim().toLowerCase(),
    type:type||"private", storeName:storeName?.trim()||"", address:address?.trim()||"",
    storeType:storeType?.trim()||"", lat, lng, createdAt:Date.now(),
    bookCount:0, trustScore:0, plan:"free", xp:0, chatCount:0,
  };
  users.push(user);
  res.json({ ok:true, user, existing:false });
});

app.post("/api/users/login", (req,res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.status(400).json({ error:"אימייל חסר" });
  const user = users.find(u=>u.email===email.trim().toLowerCase());
  if (!user) return res.status(404).json({ error:"משתמש לא נמצא" });
  res.json({ ok:true, user });
});

app.get("/api/users/:id", (req,res) => {
  const u = users.find(u=>u.id===req.params.id);
  if (!u) return res.status(404).json({ error:"לא נמצא" });
  res.json(u);
});

app.post("/api/auth/google", async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error:"no token" });
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + token);
    const g = await r.json();
    if (g.error || !g.email) return res.status(401).json({ error:"invalid token" });
    let user = users.find(u => u.email === g.email.toLowerCase());
    if (!user) {
      user = { id: randomUUID(), name: g.name || g.email.split("@")[0], email: g.email.toLowerCase(), avatar: g.picture || null, phone: "", type: "private", plan: "free", xp: 0, bookCount: 0, chatCount: 0, createdAt: Date.now(), authMethod: "google" };
      users.push(user);
    }
    res.json({ ok: true, user });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/demands", (req,res)=>res.json(demands));

app.post("/api/demands", (req,res)=>{
  const { title, author, budget, by, byId } = req.body;
  if (!title?.trim()) return res.status(400).json({ error:"title חובה" });
  const d = { id:randomUUID(), title:title.trim(), author:author?.trim()||"", budget:Number(budget)||0, by:by||"אנונימי", byId:byId||null, createdAt:Date.now(), ago:"עכשיו", urgent:false };
  demands.unshift(d);
  const hit = books.find(b=>b.avail&&b.title.toLowerCase().includes(d.title.toLowerCase()));
  res.json({ ok:true, demand:d, bookMatch:hit||null });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n📚 ספרייה שכונתית v3 — port ${PORT}`);
  console.log(`   Anthropic:    ${process.env.ANTHROPIC_API_KEY?"✓":"✗ חסר!"}`);
  console.log(`   Google Books: ${process.env.GOOGLE_BOOKS_API_KEY?"✓":"⚠ (לא חובה)"}`);
  console.log(`   Geocoding:    ✓ Nominatim\n`);
});
