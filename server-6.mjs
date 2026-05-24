// server.mjs  –  ספרייה שכונתית  –  גרסה 3
// הרץ מ-~/bookfinder:  node server.mjs

import express   from "express";
import cors      from "cors";
import multer    from "multer";
import dotenv    from "dotenv";
import { randomUUID } from "crypto";

dotenv.config();

const app    = express();
const PORT   = process.env.PORT || 3001;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

if (!process.env.ANTHROPIC_API_KEY)   console.warn("❌ ANTHROPIC_API_KEY חסר");
if (!process.env.GOOGLE_BOOKS_API_KEY) console.warn("⚠️  GOOGLE_BOOKS_API_KEY חסר (לא חובה)");

// ── in-memory store ──────────────────────────────────────
let users = [];
let books = [
  { id:"s1", title:"הארי פוטר ואבן החכמים", author:"J.K. רולינג", publisher:"בלומסברי", year:"1997", summary:"ילד יתום מגלה שהוא קוסם.", mode:"lend", price:null, avail:true, ownerName:"דנה כהן", ownerType:"private", phone:"050-1234567", lat:32.08, lng:34.78, km:0.3, createdAt:Date.now() },
  { id:"s2", title:"1984", author:"George Orwell", publisher:"Secker", year:"1949", summary:"In a totalitarian future.", mode:"sell", price:22, avail:true, ownerName:"רון שמיר", ownerType:"private", phone:"053-7778889", lat:32.09, lng:34.79, km:1.8, createdAt:Date.now() },
  { id:"s3", title:"Sapiens", author:"יובל נח הררי", publisher:"כנרת", year:"2011", summary:"סיפור האנושות.", mode:"swap", price:null, avail:true, ownerName:"ספר ועוד", ownerType:"store", phone:"03-4567890", lat:32.07, lng:34.77, km:0.5, createdAt:Date.now() },
];
let demands = [];

// ── claude vision ────────────────────────────────────────
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
  if (!r.ok) { const t = await r.text(); throw new Error(`Claude ${r.status}: ${t.slice(0,200)}`); }
  const d = await r.json();
  return d?.content?.[0]?.text || "";
}

// ── parse JSON from claude (handles markdown fences) ────
function parseJ(raw) {
  const s = raw.trim()
    .replace(/^```(?:json)?[\r\n]*/i,"")
    .replace(/[\r\n]*```$/i,"")
    .trim();
  const obj = s.match(/\{[\s\S]*\}/);
  const arr = s.match(/\[[\s\S]*\]/);
  const t = arr && (!obj || arr.index < obj.index) ? arr[0] : obj ? obj[0] : s;
  return JSON.parse(t);
}

// ── geocode address (Nominatim, no key needed) ───────────
async function geocode(address) {
  try {
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const r = await fetch(u, { headers: { "User-Agent": "SefariaShkhunati/1.0" } });
    const d = await r.json();
    if (d?.[0]) return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
  } catch {}
  return null;
}

// ── haversine distance (km) ──────────────────────────────
function dist(lat1, lng1, lat2, lng2) {
  const R=6371, dL=(lat2-lat1)*Math.PI/180, dG=(lng2-lng1)*Math.PI/180;
  const a = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dG/2)**2;
  return +(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))).toFixed(1);
}

// ── google books search ──────────────────────────────────
async function gBooks(query, max = 10) {
  if (!query?.trim()) return [];
  const key = process.env.GOOGLE_BOOKS_API_KEY ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}` : "";
  const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${max}&orderBy=relevance${key}`);
  if (!r.ok) return [];
  const d = await r.json();
  return (d.items || []).map(item => {
    const v = item.volumeInfo;
    return {
      googleId:   item.id,
      title:      v.title || "",
      author:     (v.authors||[]).join(", "),
      publisher:  v.publisher || "",
      year:       (v.publishedDate||"").split("-")[0],
      description:v.description || "",
      thumbnail:  (v.imageLinks?.thumbnail||"").replace("http:","https:"),
      isbn:       v.industryIdentifiers?.find(x=>x.type==="ISBN_13")?.identifier || "",
      language:   v.language || "",
      categories: v.categories || [],
    };
  });
}

// ── enrich vision result with google books ───────────────
async function enrich(vision) {
  const q = [vision.title, vision.author].filter(Boolean).join(" ");
  if (!q.trim()) return { googleResults:[], enriched: vision };
  const results = await gBooks(q, 5);
  if (!results.length) return { googleResults:[], enriched: vision };
  const best = results.find(r => r.title.toLowerCase().includes((vision.title||"").toLowerCase())) || results[0];
  return {
    googleResults: results,
    enriched: {
      title:       vision.title       || best.title,
      author:      vision.author      || best.author,
      publisher:   vision.publisher   || best.publisher,
      year:        vision.year        || best.year,
      language:    vision.language    || best.language,
      series:      vision.series      || "",
      volume:      vision.volume      || "",
      thumbnail:   best.thumbnail,
      isbn:        best.isbn,
      description: best.description,
      categories:  best.categories,
      googleId:    best.googleId,
      titleSource:     vision.title     ? "vision" : "google",
      authorSource:    vision.author    ? "vision" : "google",
      publisherSource: vision.publisher ? "vision" : "google",
    }
  };
}

// ── prompts ──────────────────────────────────────────────
const P_FRONT = `You are an expert OCR system for book covers. Analyze this FRONT COVER.

WHAT TO FIND:
- title: largest/most prominent text — the book name. May span multiple lines.
- author: smaller text, often "by ..." at top or bottom
- publisher: tiny logo/name at very bottom edge (Penguin, Keter, Modan, Am Oved, Zmora, HarperCollins, Yedioth…)
- year: only if printed on front (rare) — leave "" if not seen
- language: detect from text script (Hebrew/English/Arabic/Russian/etc.)
- series: series name if visible (e.g. "Harry Potter")
- volume: volume/part number if visible

RULES:
- Copy text EXACTLY — do NOT translate
- Leave "" if not visible
- Return ONLY this JSON, no markdown, no explanation:
{"title":"","author":"","publisher":"","year":"","language":"","series":"","volume":""}`;

const P_BACK = `You are an expert OCR system for book back covers. Analyze this BACK COVER.

WHAT TO FIND:
- summary: The blurb/synopsis — the main marketing paragraph(s) describing what the book is about. COPY VERBATIM.
- isbn: number starting with 978 or 979 near the barcode
- price: printed price like ₪89 or $14.99 — "" if not visible
- genre: Fiction/Non-fiction/Thriller/Mystery/Romance/Biography/History/Science/Fantasy/Children/etc.

RULES:
- For summary: copy the ACTUAL blurb text — do NOT write "this book is about..."
- Leave "" if not visible
- Return ONLY this JSON, no markdown, no explanation:
{"summary":"","isbn":"","price":"","genre":""}`;

const P_SHELF = `You are an expert at reading book spines on a bookshelf.

SPINE READING GUIDE:
- Spines are narrow vertical strips — text is ROTATED 90° (read top→bottom AND bottom→top)
- Each spine: TITLE (largest) + sometimes AUTHOR + sometimes PUBLISHER
- Hebrew reads right-to-left
- Include EVERY book you can read, even partially
- Ignore non-book objects

Return ONLY a JSON array — no markdown, no explanation. Empty shelves: []
[{"title":"","author":"","publisher":"","year":""}]`;

// ════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════
app.get("/api/health", (req,res) => res.json({ ok:true, anthropic:!!process.env.ANTHROPIC_API_KEY, googleBooks:!!process.env.GOOGLE_BOOKS_API_KEY, books:books.length, users:users.length }));

// ── analyze front ─────────────────────────────────────────
app.post("/api/analyze/front", upload.single("image"), async (req,res) => {
  console.log("📸 /analyze/front");
  if (!req.file) return res.status(400).json({ error:"לא הועלתה תמונה" });
  try {
    const raw = await claudeVision(req.file.buffer, req.file.mimetype, P_FRONT, 500);
    console.log("  raw:", raw.slice(0,150));
    let vision = {};
    try { vision = parseJ(raw); } catch(e) { console.warn("  parseJ failed:", e.message); }
    Object.keys(vision).forEach(k => { if (typeof vision[k]==="string") vision[k]=vision[k].trim(); });
    const { googleResults, enriched } = await enrich(vision);
    console.log("  ✅", enriched.title, "/", enriched.author);
    res.json({ ok:true, data:enriched, googleResults });
  } catch(e) { console.error("  ❌", e.message); res.status(500).json({ error:e.message }); }
});

// ── analyze back ─────────────────────────────────────────
app.post("/api/analyze/back", upload.single("image"), async (req,res) => {
  console.log("📸 /analyze/back");
  if (!req.file) return res.status(400).json({ error:"לא הועלתה תמונה" });
  try {
    const raw = await claudeVision(req.file.buffer, req.file.mimetype, P_BACK, 900);
    console.log("  raw:", raw.slice(0,150));
    let data = {};
    try { data = parseJ(raw); } catch { data = { summary: raw.trim() }; }
    Object.keys(data).forEach(k => { if (typeof data[k]==="string") data[k]=data[k].trim(); });
    console.log("  ✅ summary:", (data.summary||"").length, "chars");
    res.json({ ok:true, data: { summary:data.summary||"", isbn:data.isbn||"", price:data.price||"", genre:data.genre||"" } });
  } catch(e) { console.error("  ❌", e.message); res.status(500).json({ error:e.message }); }
});

// ── analyze shelf ─────────────────────────────────────────
app.post("/api/analyze/shelf", upload.single("image"), async (req,res) => {
  console.log("📚 /analyze/shelf");
  if (!req.file) return res.status(400).json({ error:"לא הועלתה תמונה" });
  try {
    const raw = await claudeVision(req.file.buffer, req.file.mimetype, P_SHELF, 2500);
    console.log("  raw:", raw.slice(0,200));
    let arr = [];
    try { const p = parseJ(raw); arr = Array.isArray(p) ? p : []; } catch { arr=[]; }
    const results = arr.filter(x=>x.title?.trim()).map(x=>({ title:(x.title||"").trim(), author:(x.author||"").trim(), publisher:(x.publisher||"").trim(), year:(x.year||"").trim() }));
    console.log("  ✅ books:", results.length);
    res.json({ ok:true, data:results, count:results.length });
  } catch(e) { console.error("  ❌", e.message); res.status(500).json({ error:e.message }); }
});

// ── google books search (ranked) ──────────────────────────
app.get("/api/books/search", async (req,res) => {
  const { q, limit="10" } = req.query;
  if (!q?.trim()) return res.status(400).json({ error:"חסר q" });
  try {
    let results = await gBooks(q, Math.min(Number(limit),20));
    const ql = q.toLowerCase();
    results = results.sort((a,b) => {
      const at=a.title.toLowerCase().includes(ql)?0:1, bt=b.title.toLowerCase().includes(ql)?0:1;
      if (at!==bt) return at-bt;
      const aa=a.author.toLowerCase().includes(ql)?0:1, ba=b.author.toLowerCase().includes(ql)?0:1;
      return aa-ba;
    });
    res.json({ ok:true, results, count:results.length });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── books CRUD ────────────────────────────────────────────
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
    id: randomUUID(), title:b.title.trim(), author:b.author?.trim()||"", publisher:b.publisher?.trim()||"",
    year:b.year?.trim()||"", summary:b.summary?.trim()||"", condition:b.condition?.trim()||"",
    series:b.series?.trim()||"", volume:b.volume?.trim()||"", isbn:b.isbn?.trim()||"", genre:b.genre?.trim()||"",
    mode:b.mode||"sell", price:b.mode==="sell"?(Number(b.price)||null):null,
    lendDuration:b.lendDuration?.trim()||"", swapFor:b.swapFor?.trim()||"",
    avail:true, ownerName:b.ownerName?.trim()||"אני", ownerType:b.ownerType||"private",
    phone:b.phone?.trim()||"", ownerId:b.ownerId||null,
    lat:b.lat?parseFloat(b.lat):null, lng:b.lng?parseFloat(b.lng):null, km:0,
    frontImg: req.file?`data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`:(b.thumbnail||null),
    createdAt:Date.now(), mine:true,
  };
  books.unshift(book);
  console.log("✅ book added:", book.title);
  const hit = demands.find(d=>book.title.toLowerCase().includes((d.title||"").toLowerCase()));
  res.json({ ok:true, book, demandMatch:hit||null });
});

app.put("/api/books/:id", (req,res) => {
  const i = books.findIndex(b=>b.id===req.params.id);
  if (i<0) return res.status(404).json({ error:"לא נמצא" });
  books[i] = { ...books[i], ...req.body, id:req.params.id };
  res.json({ ok:true, book:books[i] });
});

app.delete("/api/books/:id", (req,res) => {
  const before = books.length;
  books = books.filter(b=>b.id!==req.params.id);
  if (books.length===before) return res.status(404).json({ error:"לא נמצא" });
  res.json({ ok:true });
});

// ── users ─────────────────────────────────────────────────
app.post("/api/users/register", async (req,res) => {
  const { name, phone, email, type, storeName, address, storeType } = req.body;
  const miss = [];
  if (!name?.trim())  miss.push("שם");
  if (!phone?.trim()) miss.push("טלפון");
  if (!email?.trim()) miss.push("אימייל");
  if (type==="store" && !address?.trim()) miss.push("כתובת חנות");
  if (miss.length) return res.status(400).json({ error:`שדות חסרים: ${miss.join(", ")}`, missing:miss });

  const ex = users.find(u=>u.email===email.trim().toLowerCase());
  if (ex) return res.json({ ok:true, user:ex, existing:true });

  let lat=null, lng=null;
  if (address?.trim()) {
    const geo = await geocode(address.trim());
    if (geo) { lat=geo.lat; lng=geo.lng; console.log("📍 geocoded:", address,"→",lat,lng); }
    else console.warn("⚠️  geocode failed:", address);
  }

  const user = {
    id:randomUUID(), name:name.trim(), phone:phone.trim(), email:email.trim().toLowerCase(),
    type:type||"private", storeName:storeName?.trim()||"", address:address?.trim()||"",
    storeType:storeType?.trim()||"", lat, lng, createdAt:Date.now(), bookCount:0, trustScore:0,
  };
  users.push(user);
  console.log("✅ user:", user.name, user.type, lat?`(${lat},${lng})`:"(no geo)");
  res.json({ ok:true, user, existing:false });
});

app.get("/api/users/:id", (req,res) => {
  const u = users.find(u=>u.id===req.params.id);
  if (!u) return res.status(404).json({ error:"לא נמצא" });
  res.json(u);
});

// ── demands ────────────────────────────────────────────────
app.get("/api/demands", (req,res)=>res.json(demands));

app.post("/api/demands", (req,res)=>{
  const { title, author, budget, by, byId } = req.body;
  if (!title?.trim()) return res.status(400).json({ error:"title חובה" });
  const d = { id:randomUUID(), title:title.trim(), author:author?.trim()||"", budget:Number(budget)||0, by:by||"אנונימי", byId:byId||null, createdAt:Date.now(), ago:"עכשיו", urgent:false };
  demands.unshift(d);
  const hit = books.find(b=>b.avail&&b.title.toLowerCase().includes(d.title.toLowerCase()));
  res.json({ ok:true, demand:d, bookMatch:hit||null });
});

// ── start ─────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n📚 ספרייה שכונתית v3 — port ${PORT}`);
  console.log(`   Anthropic:    ${process.env.ANTHROPIC_API_KEY?"✓":"✗ חסר!"}`);
  console.log(`   Google Books: ${process.env.GOOGLE_BOOKS_API_KEY?"✓":"⚠ (לא חובה)"}`);
  console.log(`   Geocoding:    ✓ Nominatim\n`);
});
