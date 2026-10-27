import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { randomUUID, randomBytes, randomInt, createHash, timingSafeEqual, createPublicKey, verify as cryptoVerify, createHmac } from "crypto";
import { gzipSync } from "zlib";
import cron from "node-cron";
import pg from "pg";
import { Jimp } from "jimp";

dotenv.config();

const { Pool } = pg;
const DB_URL = process.env.DATABASE_URL || "";
const isLocalDb = /localhost|127\.0\.0\.1/.test(DB_URL);
const pool = new Pool({ connectionString: DB_URL, ssl: DB_URL && !isLocalDb ? { rejectUnauthorized: false } : false });

const app = express();
const PORT = process.env.PORT || 3001;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, fieldSize: 5 * 1024 * 1024 } });

const DAY = 86400000;
const SESSION_DAYS = 180;
const VISION_DAILY_LIMIT = Number(process.env.VISION_DAILY_LIMIT || 40);
const VISION_MODEL = process.env.VISION_MODEL || "claude-sonnet-5-5";
const VISION_FALLBACK_MODEL = "claude-opus-4-5";
const PUBLIC_SITE = process.env.PUBLIC_SITE || "https://pageturner.co.il";

app.set("trust proxy", 1);

// ── CORS: רק האתר שלנו ─────────────────────────────────────
const ALLOWED_ORIGINS = [/^https:\/\/(www\.)?pageturner\.co\.il$/, /^https:\/\/pageturner[a-z0-9-]*\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.some(r => r.test(origin))),
}));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(express.json({ limit: "2mb" }));

// ── עזרים ─────────────────────────────────────────────────
const sha256 = s => createHash("sha256").update(String(s)).digest("hex");
const emailKey = e => sha256("funnel:" + e).slice(0, 12);
const normEmail = e => String(e || "").trim().toLowerCase();
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const clip = (s, n) => String(s ?? "").slice(0, n);

function safeEqual(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

// הגבלת קצב פשוטה בזיכרון (חלון קבוע)
const buckets = new Map();
function hit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) { buckets.set(key, { n: 1, reset: now + windowMs }); return true; }
  b.n++;
  return b.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 10 * 60 * 1000).unref();
const limit = (name, max, windowMs) => (req, res, next) =>
  hit(`${name}:${req.ip}`, max, windowMs) ? next() : res.status(429).json({ error: "יותר מדי ניסיונות, נסו שוב בעוד כמה דקות" });

// ── מסד נתונים ────────────────────────────────────────────
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
    )`);
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
    )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY, bookId TEXT, bookTitle TEXT, fromUserId TEXT, toUserId TEXT,
    type TEXT, status TEXT DEFAULT 'pending', askedStatus BOOLEAN DEFAULT false, createdAt BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS analytics (id TEXT PRIMARY KEY, event TEXT, userId TEXT, data JSONB, city TEXT, createdAt BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS book_history (id TEXT PRIMARY KEY, bookid TEXT, fromuserid TEXT, touserid TEXT, type TEXT, createdat BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS wishlist (id TEXT PRIMARY KEY, userid TEXT, query TEXT, createdat BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (tokenhash TEXT PRIMARY KEY, userid TEXT NOT NULL, createdat BIGINT, lastseen BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS daily_stats (day DATE PRIMARY KEY, data JSONB, createdat BIGINT)`);
  await pool.query("CREATE INDEX IF NOT EXISTS analytics_created_idx ON analytics (createdat)");
  await pool.query(`CREATE TABLE IF NOT EXISTS blocked_attempts (id TEXT PRIMARY KEY, userid TEXT, title TEXT, author TEXT, category TEXT, reason TEXT, at TEXT, createdat BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS reports (bookid TEXT NOT NULL, userid TEXT NOT NULL, reason TEXT, createdat BIGINT, PRIMARY KEY (bookid, userid))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS favorites (userid TEXT NOT NULL, bookid TEXT NOT NULL, createdat BIGINT, PRIMARY KEY (userid, bookid))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS covers (id TEXT PRIMARY KEY, key TEXT UNIQUE, img TEXT, source TEXT, uses INTEGER DEFAULT 0, createdat BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS otps (email TEXT PRIMARY KEY, codehash TEXT, expires BIGINT, attempts INTEGER DEFAULT 0, sends INTEGER DEFAULT 0, windowstart BIGINT, tickethash TEXT, ticketexpires BIGINT)`);
  const alters = [
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS lenduntil TEXT",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS city TEXT",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT false",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS imgcheck TEXT",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS dealstatus TEXT",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS prevownerid TEXT",
    "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ownerAsked BOOLEAN DEFAULT false",
    "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ownerConfirmed BOOLEAN DEFAULT false",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT false",
    "ALTER TABLE otps ADD COLUMN IF NOT EXISTS ticketvia TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS featuredBooks TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_consent BOOLEAN DEFAULT false",
    "ALTER TABLE wishlist ADD COLUMN IF NOT EXISTS notified BOOLEAN DEFAULT false",
    "CREATE INDEX IF NOT EXISTS books_avail_created ON books (avail, createdat DESC)",
    "CREATE INDEX IF NOT EXISTS books_owner ON books (ownerid)",
    "CREATE INDEX IF NOT EXISTS sessions_user ON sessions (userid)",
    "CREATE INDEX IF NOT EXISTS analytics_event_created ON analytics (event, createdat)",
  ];
  for (const q of alters) { try { await pool.query(q); } catch (e) { console.error("migration:", e.message); } }
  console.log("✅ DB ready");
}

// ── Analytics ────────────────────────────────────────────
async function track(event, userId, data, city) {
  try {
    await pool.query(
      "INSERT INTO analytics (id,event,userId,data,city,createdAt) VALUES ($1,$2,$3,$4,$5,$6)",
      [randomUUID(), event, userId || null, JSON.stringify(data || {}), city || null, Date.now()]
    );
  } catch {}
}

// ── תמונות ───────────────────────────────────────────────
// מקטין תמונה ומחזיר data URI של JPEG. תמונה קטנה מספיק נשמרת כמו שהיא.
async function shrinkImage(buf, maxW, maxH, quality = 80) {
  const image = await Jimp.read(buf);
  if (image.bitmap.width > maxW || image.bitmap.height > maxH) image.scaleToFit({ w: maxW, h: maxH });
  return image.getBase64("image/jpeg", { quality });
}
function dataUriToBuffer(uri) {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(uri || "");
  return m ? { mime: m[1], buf: Buffer.from(m[2], "base64") } : null;
}

// ── יישור כריכה: מתיחת ארבע פינות למלבן (כמו סורק מסמכים) ────
function solveLinear(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-10) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}
// הומוגרפיה שממפה נקודות from → to (ארבע נקודות כל אחד)
function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solveLinear(A, b);
  return h ? [...h, 1] : null;
}
// מסדר ארבע נקודות: למעלה-שמאל, למעלה-ימין, למטה-ימין, למטה-שמאל
function orderCorners(pts) {
  const cx = pts.reduce((a, p) => a + p[0], 0) / 4, cy = pts.reduce((a, p) => a + p[1], 0) / 4;
  const sorted = [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let start = 0;
  sorted.forEach((p, i) => { if (p[0] + p[1] < sorted[start][0] + sorted[start][1]) start = i; });
  return [0, 1, 2, 3].map(i => sorted[(start + i) % 4]);
}
function quadOk(q, W, H) {
  const area = Math.abs(q.reduce((a, p, i) => { const n = q[(i + 1) % 4]; return a + p[0] * n[1] - n[0] * p[1]; }, 0)) / 2;
  if (area < W * H * 0.08) return false;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) <= 0) return false; // לא קמור
  }
  const d = (p, r) => Math.hypot(p[0] - r[0], p[1] - r[1]);
  const w = Math.max(d(q[0], q[1]), d(q[3], q[2])), h = Math.max(d(q[0], q[3]), d(q[1], q[2]));
  const ratio = w / h;
  return ratio > 0.4 && ratio < 1.25;
}
// מקבל תמונה ופינות באחוזים, ומחזיר כריכה ישרה (data URI) או null
async function warpCover(buf, corners) {
  try {
    if (!corners) return null;
    const raw = Array.isArray(corners) ? corners : [corners.tl, corners.tr, corners.br, corners.bl];
    if (raw.length !== 4 || raw.some(p => !Array.isArray(p) || p.length < 2 || !p.every(Number.isFinite))) return null;
    const image = await Jimp.read(buf);
    const W = image.bitmap.width, H = image.bitmap.height;
    const q = orderCorners(raw.map(([x, y]) => [Math.min(100, Math.max(0, x)) / 100 * (W - 1), Math.min(100, Math.max(0, y)) / 100 * (H - 1)]));
    if (!quadOk(q, W, H)) return null;
    const d = (p, r) => Math.hypot(p[0] - r[0], p[1] - r[1]);
    let w = Math.max(d(q[0], q[1]), d(q[3], q[2])), h = Math.max(d(q[0], q[3]), d(q[1], q[2]));
    const s = Math.min(600 / w, 900 / h, 1);
    const ow = Math.max(40, Math.round(w * s)), oh = Math.max(60, Math.round(h * s));
    const m = homography([[0, 0], [ow - 1, 0], [ow - 1, oh - 1], [0, oh - 1]], q);
    if (!m) return null;
    const src = image.bitmap.data, out = Buffer.alloc(ow * oh * 4);
    for (let v = 0; v < oh; v++) for (let u = 0; u < ow; u++) {
      const z = m[6] * u + m[7] * v + m[8];
      const x = (m[0] * u + m[1] * v + m[2]) / z, y = (m[3] * u + m[4] * v + m[5]) / z;
      const x0 = Math.max(0, Math.min(W - 2, Math.floor(x))), y0 = Math.max(0, Math.min(H - 2, Math.floor(y)));
      const fx = Math.min(1, Math.max(0, x - x0)), fy = Math.min(1, Math.max(0, y - y0));
      const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4, o = (v * ow + u) * 4;
      for (let c = 0; c < 3; c++) {
        out[o + c] = (src[i00 + c] * (1 - fx) + src[i10 + c] * fx) * (1 - fy) + (src[i01 + c] * (1 - fx) + src[i11 + c] * fx) * fy;
      }
      out[o + 3] = 255;
    }
    const res = new Jimp({ width: ow, height: oh });
    res.bitmap.data = out;
    return await res.getBase64("image/jpeg", { quality: 82 });
  } catch (e) {
    console.log("Warp error:", e.message);
    return null;
  }
}

async function cropBookImage(buf, crop) {
  try {
    if (!crop) return null;
    const image = await Jimp.read(buf);
    const W = image.bitmap.width, H = image.bitmap.height;
    const x = Math.max(0, Math.round((crop.x || 0) / 100 * W));
    const y = Math.max(0, Math.round((crop.y || 0) / 100 * H));
    const w = Math.min(W - x, Math.round((crop.width || 100) / 100 * W));
    const h = Math.min(H - y, Math.round((crop.height || 100) / 100 * H));
    if (w < 20 || h < 20) return null;
    image.crop({ x, y, w, h });
    image.scaleToFit({ w: 600, h: 900 });
    return await image.getBase64("image/jpeg", { quality: 80 });
  } catch (e) {
    console.log("Crop error:", e.message);
    return null;
  }
}

// ── ספריית כריכות קהילתית ─────────────────────────────────
// כל כריכה ישרה שמשתמש מעלה נשמרת לפי ISBN ולפי שם+מחבר, ומשמשת את מי שיעלה את אותו ספר
function normText(t) {
  return String(t || "").toLowerCase().replace(/[\u0591-\u05C7]/g, "").replace(/["'״׳`.,:;!?()\[\]{}\-–—_/\\]/g, " ").replace(/\s+/g, " ").trim();
}
function normIsbn(i) {
  let d = String(i || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (d.length === 10) {
    const core = "978" + d.slice(0, 9);
    let sum = 0;
    for (let k = 0; k < 12; k++) sum += Number(core[k]) * (k % 2 ? 3 : 1);
    d = core + ((10 - (sum % 10)) % 10);
  }
  return /^97[89]\d{10}$/.test(d) ? d : "";
}
function coverKeys({ isbn, title, author }) {
  const keys = [];
  const i = normIsbn(isbn);
  if (i) keys.push("isbn:" + i);
  const t = normText(title), a = normText(author);
  if (t.length >= 2) keys.push("t:" + t + "|" + a);
  return keys;
}
const coverId = key => sha256(key).slice(0, 24);
async function findCover(meta) {
  for (const key of coverKeys(meta)) {
    const r = await pool.query("SELECT id FROM covers WHERE key=$1", [key]);
    if (r.rows[0]) return r.rows[0].id;
  }
  return null;
}
async function saveCover(meta, img, source) {
  if (!img?.startsWith("data:image/")) return;
  for (const key of coverKeys(meta)) {
    await pool.query("INSERT INTO covers (id,key,img,source,createdat) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [coverId(key), key, img, source, Date.now()]);
  }
}
const coverUrl = (req, id) => id ? `${origin(req)}/api/img/cover/${id}` : null;
// כריכה מ-Open Library לפי ISBN (רק אם באמת קיימת)
async function openLibraryCover(isbn) {
  const i = normIsbn(isbn);
  if (!i) return null;
  try {
    const url = `https://covers.openlibrary.org/b/isbn/${i}-L.jpg?default=false`;
    const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": "Pageturner/1.0 (pageturner.co.il)" } });
    return r.ok ? url.replace("?default=false", "") : null;
  } catch { return null; }
}

// ── Claude Vision ─────────────────────────────────────────
async function callClaude(model, buf, mime, prompt, maxTok) {
  return fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: maxTok,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mime, data: buf.toString("base64") } },
        { type: "text", text: prompt },
      ] }],
    }),
  });
}
async function callClaudeText(model, buf, mime, prompt, maxTok) {
  const r = await callClaude(model, buf, mime, prompt, maxTok);
  if (!r.ok) { const t = await r.text(); throw new Error(`Vision ${r.status}: ${t.slice(0, 200)}`); }
  const d = await r.json();
  return (d?.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
}
async function claudeVision(buf, mime, prompt, maxTok = 600) {
  let r = await callClaude(VISION_MODEL, buf, mime, prompt, maxTok);
  if ((r.status === 400 || r.status === 404) && VISION_MODEL !== VISION_FALLBACK_MODEL) {
    const t = await r.text();
    if (/model/i.test(t)) {
      console.error(`Vision model ${VISION_MODEL} rejected, falling back:`, t.slice(0, 160));
      r = await callClaude(VISION_FALLBACK_MODEL, buf, mime, prompt, maxTok);
    } else throw new Error(`Vision ${r.status}: ${t.slice(0, 200)}`);
  }
  if (!r.ok) { const t = await r.text(); throw new Error(`Vision ${r.status}: ${t.slice(0, 200)}`); }
  const d = await r.json();
  return (d?.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
}
// ── בדיקת תמונות לפני פרסום ─────────────────────────────────
// כל תמונה שמשתמש מעלה נבדקת: שאין בה תוכן פוגעני (עירום, אלימות קשה וכו'),
// ושבתמונות של ספרים באמת רואים ספר. מודל מהיר וזול, עם נפילה למודל הראשי.
const MOD_MODEL = process.env.MOD_MODEL || "claude-haiku-5-5";
const P_MODERATE = `You are the safety check for a neighborhood used-book sharing site used by families, including children.
For EACH image (in order) decide:
- "unsafe": true if it contains nudity or sexual content, sexualized poses, graphic violence or gore, hate symbols, drugs, or anything else inappropriate for a general audience. A book whose cover art is ordinary for a bookstore (e.g. a romance novel cover, a war history book) is NOT unsafe.
- "book": true if the image plausibly shows a book: a front or back cover, a spine, a book held in hand or lying on a surface, a stack of books, an open book, or a digital cover image. Blurry, dark or tilted photos of a book still count. false for unrelated photos (selfies, pets, landscapes, screenshots, memes, documents, receipts, random objects).
Return ONLY raw JSON, no code fences: {"images":[{"unsafe":false,"book":true}]}`;
const P_MODERATE_AVATAR = `You are the safety check for a profile picture on a neighborhood book-sharing site used by families, including children.
"unsafe": true if the image contains nudity or sexual content, sexualized poses, graphic violence or gore, hate symbols, drugs, or anything else inappropriate for a general audience. Ordinary photos of people, pets, places or drawings are fine.
Return ONLY raw JSON, no code fences: {"images":[{"unsafe":false}]}`;
async function shrinkForCheck(buf) {
  try {
    const im = await Jimp.read(buf);
    im.scaleToFit({ w: 768, h: 768 });
    return await im.getBuffer("image/jpeg", { quality: 80 });
  } catch { return null; }
}
async function callClaudeMulti(model, bufs, prompt) {
  return fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 200, messages: [{ role: "user", content: [
      ...bufs.map(b => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.toString("base64") } })),
      { type: "text", text: prompt },
    ] }] }),
  });
}
// מחזיר { status: "ok" | "unsafe" | "notbook" | "unchecked" }
async function moderateImages(buffers, { avatar = false } = {}) {
  const bufs = (await Promise.all(buffers.filter(Boolean).map(shrinkForCheck))).filter(Boolean);
  if (!bufs.length) return { status: "ok" };
  if (!process.env.ANTHROPIC_API_KEY) return { status: "unchecked", why: "no key" };
  const prompt = avatar ? P_MODERATE_AVATAR : P_MODERATE;
  try {
    let r = await callClaudeMulti(MOD_MODEL, bufs, prompt);
    if (!r.ok && (r.status === 400 || r.status === 404) && MOD_MODEL !== VISION_MODEL) r = await callClaudeMulti(VISION_MODEL, bufs, prompt);
    if (!r.ok) throw new Error(`moderation ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const d = await r.json();
    const raw = (d?.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    const j = parseJ(raw);
    const imgs = Array.isArray(j?.images) ? j.images : null;
    if (!imgs || imgs.length < bufs.length) throw new Error("moderation: bad answer " + raw.slice(0, 120));
    if (imgs.some(x => x.unsafe === true || x.unsafe === "true")) return { status: "unsafe" };
    if (!avatar && imgs.some(x => x.book === false || x.book === "false")) return { status: "notbook" };
    return { status: "ok" };
  } catch (e) { console.error("moderate:", e.message); return { status: "unchecked", why: e.message }; }
}
const MOD_ERRORS = {
  unsafe: "התמונה לא מתאימה לפרסום באתר. אפשר להעלות רק תמונות של ספרים",
  notbook: "התמונה לא נראית כמו ספר. צלמו את כריכת הספר או את העותק שלכם ונסו שוב",
};
// תשובת הסריקה עצמה אומרת אם זה ספר ואם התמונה בסדר — עוצרים כבר בשלב הצילום
const isFalse = v => v === false || v === "false";
const isTrue = v => v === true || v === "true";
function imageGate(v) { if (isTrue(v?.unsafe)) return "unsafe"; if (isFalse(v?.is_book)) return "notbook"; return null; }
// ── מדיניות תוכן: ספרים שאסור לפרסם ─────────────────────────
// שכבה ראשונה: רשימה קבועה (עובדת גם בלי חיבור ל-AI). שכבה שנייה: בדיקה חכמה של כותרת, מחבר ותקציר.
const normTxt = t => String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0591-\u05C7]/g, "").replace(/[^a-z0-9\u05d0-\u05ea]+/g, " ").trim();
function blocklistHit(title, author) {
  const t = normTxt(title), a = normTxt(author);
  if (/mein ?kampf|מיין ?ק[א]?מפף|מיין ?קאמף/.test(t)) return "hate";
  if (/(hitler|היטלר)/.test(a) && !/(biograph|ביוגרפ)/.test(t)) return "hate";
  if (/protocols? of (the )?(learned )?elders of zion|פרוטוקולים של זקני ציון|הפרוטוקולים של חכמי ציון/.test(t)) return "hate";
  if (/turner diaries/.test(t)) return "hate";
  return null;
}
const P_BOOK_POLICY = `You review book listings for a neighborhood book-sharing site in Israel used by families, including children.
Decide whether this book must be BLOCKED. Block ONLY these:
1. "hate": works whose purpose is to spread hatred of a group — e.g. Mein Kampf, The Protocols of the Elders of Zion, neo-Nazi, white-supremacist, antisemitic or racist propaganda tracts.
2. "terror": works that incite to or glorify terrorism or mass violence.
3. "porn": pornography — sexually explicit works whose main purpose is sexual arousal (mainstream romance or literary novels with sex scenes are fine).
4. "crime": manuals for making weapons or explosives, or for committing serious crimes.
Do NOT block: history, biographies, scholarly, critical or educational works about these subjects (books about the Holocaust, WWII, Nazism, terrorism; Hitler biographies; survivor memoirs), novels with dark themes, religious texts, and political books from any side. If you are not sure, do not block.
Return ONLY raw JSON, no code fences: {"block":false,"category":"none","reason":""} — reason: a few words in Hebrew.`;
async function checkBookPolicy({ title, author, summary }) {
  const hit = blocklistHit(title, author);
  if (hit) return { block: true, category: hit, reason: "ספר שמפיץ שנאה", source: "list" };
  if (!String(title || "").trim() || !process.env.ANTHROPIC_API_KEY) return { block: false };
  const text = `Title: ${clip(title, 300)}\nAuthor: ${clip(author, 200)}\nDescription: ${clip(summary, 800)}`;
  const ask = model => fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 120, system: P_BOOK_POLICY, messages: [{ role: "user", content: text }] }),
  });
  try {
    let r = await ask(MOD_MODEL);
    if (!r.ok && (r.status === 400 || r.status === 404) && MOD_MODEL !== VISION_MODEL) r = await ask(VISION_MODEL);
    if (!r.ok) throw new Error(`policy ${r.status}`);
    const d = await r.json();
    const j = parseJ((d?.content || []).filter(c => c.type === "text").map(c => c.text).join(""));
    if (isTrue(j?.block) && ["hate", "terror", "porn", "crime"].includes(j.category)) return { block: true, category: j.category, reason: clip(cleanText(j.reason || ""), 120), source: "ai" };
    return { block: false };
  } catch (e) { console.error("book policy:", e.message); return { block: false, unchecked: true }; }
}
const POLICY_LABELS = { hate: "הסתה ושנאה", terror: "הסתה לטרור ואלימות", porn: "תוכן פורנוגרפי", crime: "מדריך לפשיעה או לנשק" };
const POLICY_ERROR = "לא ניתן לפרסם את הספר הזה באתר, כי הוא לא עומד בכללי הקהילה";
const suspendToken = id => createHmac("sha256", process.env.ADMIN_KEY || "pt-hide").update("suspend:" + id).digest("base64url").slice(0, 32);
// רישום ניסיון לפרסם ספר חסום + מייל למנהל
async function recordBlocked(req, info, at) {
  const u = req.user;
  await pool.query("INSERT INTO blocked_attempts (id,userid,title,author,category,reason,at,createdat) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [randomUUID(), u.id, clip(info.title, 300), clip(info.author, 200), info.category, clip(info.reason, 200), at, Date.now()]);
  track("book_blocked", u.id, { title: clip(info.title, 80), category: info.category, at });
  const n = Number((await pool.query("SELECT COUNT(*) FROM blocked_attempts WHERE userid=$1", [u.id])).rows[0].count);
  if (!process.env.ADMIN_EMAIL) return;
  const link = `${apiUrl(req)}/api/admin/suspend/${u.id}?t=${suspendToken(u.id)}`;
  await sendEmail(process.env.ADMIN_EMAIL, `⛔ ניסיון לפרסם ספר חסום: ${clip(info.title, 60)}${n > 1 ? ` (פעם ${n})` : ""}`, `<div dir="rtl" style="font-family:sans-serif">
    <p>משתמש ניסה לפרסם ספר שנחסם לפי כללי הקהילה. הספר <b>לא</b> פורסם.</p>
    <p><b>הספר:</b> ${escapeHtml(info.title)}${info.author ? ` · ${escapeHtml(info.author)}` : ""}<br>
    <b>סיבה:</b> ${POLICY_LABELS[info.category] || info.category}${info.reason ? ` (${escapeHtml(info.reason)})` : ""}</p>
    <p><b>המשתמש:</b> ${escapeHtml(u.name || "")} · ${escapeHtml(u.email || "")} · ${escapeHtml(u.phone || "")}<br>
    <b>ניסיונות חסומים עד היום:</b> ${n}</p>
    <p><a href="${link}">להשעות את המשתמש ולהסתיר את כל הספרים שלו</a></p></div>`);
}
const COVER_HOSTS = /^https:\/\/(covers\.openlibrary\.org|books\.google\.com|books\.googleusercontent\.com|[a-z0-9-]+\.googleusercontent\.com)\//i;
const hideToken = id => createHmac("sha256", process.env.ADMIN_KEY || "pt-hide").update("hide:" + id).digest("base64url").slice(0, 32);
function siteUrl() { return process.env.SITE_URL || "https://pageturner.co.il"; }
function apiUrl(req) { return process.env.PUBLIC_API_URL || origin(req); }

// מכין תמונה לניתוח: מקטין ל-1568px לכל היותר (מהיר וזול יותר)
async function prepForVision(file) {
  try {
    const image = await Jimp.read(file.buffer);
    if (image.bitmap.width > 1568 || image.bitmap.height > 1568) {
      image.scaleToFit({ w: 1568, h: 1568 });
      return { buf: await image.getBuffer("image/jpeg", { quality: 85 }), mime: "image/jpeg" };
    }
  } catch {}
  return { buf: file.buffer, mime: file.mimetype };
}

// קריאה סלחנית של תשובת JSON מהמודל: עמידה למרכאות עבריות (צה"ל), לגדרות קוד ולתשובה שנקטעה
const HEB = "\\u0590-\\u05FF";
function stripFences(raw) {
  return String(raw || "").trim().replace(/^```[a-z]*\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}
// מרכאות בין אותיות עבריות הן גרשיים, לא סוף מחרוזת
function fixHebrewQuotes(t) {
  return t.replace(new RegExp(`([${HEB}])\\\\?"(?=[${HEB}])`, "g"), "$1״")
          .replace(new RegExp(`([${HEB}])\\\\?'(?=[${HEB}\\s])`, "g"), "$1׳");
}
function tryParse(t) { try { return JSON.parse(t); } catch { return undefined; } }
function parseJ(raw) {
  const s = stripFences(raw);
  const objStart = s.indexOf("{"), arrStart = s.indexOf("[");
  const isArr = arrStart !== -1 && (objStart === -1 || arrStart < objStart);
  const start = isArr ? arrStart : objStart;
  if (start === -1) throw new Error("no json");
  const end = s.lastIndexOf(isArr ? "]" : "}");
  const body = end > start ? s.slice(start, end + 1) : s.slice(start);
  for (const cand of [body, fixHebrewQuotes(body)]) {
    const v = tryParse(cand);
    if (v !== undefined) return v;
  }
  // תשובה שנקטעה באמצע: סוגרים מחרוזת/אובייקט פתוחים
  const cut = fixHebrewQuotes(s.slice(start));
  for (const tail of ['"}', '}', '"}]', '}]', ']']) {
    const v = tryParse(cut + tail);
    if (v !== undefined) return v;
  }
  if (isArr) throw new Error("bad json array");
  // מוצא אחרון: שליפת שדות בודדים לפי שם
  const out = {};
  const re = /"([a-zA-Z_]+)"\s*:\s*("((?:[^"\\]|\\.)*?)"(?=\s*[,}\n]|\s*$)|-?\d+(?:\.\d+)?|\{[^{}]*\})/g;
  let m;
  while ((m = re.exec(cut))) {
    if (m[3] !== undefined) out[m[1]] = m[3].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    else { const v = tryParse(m[2]); if (v !== undefined) out[m[1]] = v; }
  }
  // שדה טקסט אחרון שנקטע בלי מרכאות סוגרות
  const last = /"([a-zA-Z_]+)"\s*:\s*"([^"]*)$/.exec(cut);
  if (last && !(last[1] in out)) out[last[1]] = last[2];
  if (!Object.keys(out).length) throw new Error("unparseable");
  return out;
}
// ניקוי ערך טקסט שחזר מהמודל
function cleanText(v) {
  if (typeof v !== "string") return v;
  return fixHebrewQuotes(v.replace(/\\"/g, '"').replace(/\\n/g, "\n")).replace(/\\(?=[^\\])/g, "").trim();
}

// ── גיאוקוד ───────────────────────────────────────────────
const NOMINATIM_UA = "Pageturner/1.0 (pageturner.co.il)";
async function geocode(address) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, { headers: { "User-Agent": NOMINATIM_UA } });
    const d = await r.json();
    if (d?.[0]) return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
  } catch {}
  return null;
}
async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&accept-language=he`, { headers: { "User-Agent": NOMINATIM_UA } });
    const d = await r.json();
    return d?.address?.city || d?.address?.town || d?.address?.village || d?.address?.suburb || null;
  } catch {}
  return null;
}
function dist(lat1, lng1, lat2, lng2) {
  const R = 6371, dL = (lat2 - lat1) * Math.PI / 180, dG = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dL / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// מרחק מעוגל כדי שאי אפשר יהיה לאתר כתובת מדויקת
function fuzzKm(km) {
  if (km < 1) return 0.5;
  if (km < 10) return Math.round(km * 2) / 2;
  return Math.round(km);
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

// ── ספרים חיצוניים ────────────────────────────────────────
async function openLibrary(isbn) {
  try {
    const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`, { headers: { "User-Agent": NOMINATIM_UA } });
    if (!r.ok) return null;
    const d = await r.json();
    const book = d[`ISBN:${isbn}`];
    if (!book) return null;
    return {
      title: book.title || "",
      author: (book.authors || []).map(a => a.name).join(", "),
      publisher: (book.publishers || []).map(p => p.name).join(", "),
      year: book.publish_date ? book.publish_date.match(/\d{4}/)?.[0] || "" : "",
      isbn,
      thumbnail: (book.cover?.medium || book.cover?.small || "").replace("http:", "https:"),
      description: book.excerpts?.[0]?.text || "",
    };
  } catch { return null; }
}

async function gBooks(query, max = 10, lang = "") {
  if (!query?.trim()) return [];
  const key = process.env.GOOGLE_BOOKS_API_KEY ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}` : "";
  const langFilter = lang ? `&langRestrict=${lang}` : "";
  try {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${max}&orderBy=relevance${key}${langFilter}`);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.items || []).map(item => {
      const v = item.volumeInfo;
      return {
        googleId: item.id, title: v.title || "", author: (v.authors || []).join(", "),
        publisher: v.publisher || "", year: (v.publishedDate || "").split("-")[0],
        description: v.description || "", thumbnail: (v.imageLinks?.thumbnail || "").replace("http:", "https:"),
        isbn: v.industryIdentifiers?.find(x => x.type === "ISBN_13")?.identifier || "",
        language: v.language || "", categories: v.categories || [],
      };
    });
  } catch { return []; }
}

async function enrich(vision) {
  let results = [];
  const q = [vision.title, vision.author].filter(Boolean).join(" ");

  if (vision.isbn) {
    const ol = await openLibrary(vision.isbn);
    if (ol) {
      return {
        googleResults: [],
        enriched: {
          title: vision.title || ol.title, author: vision.author || ol.author,
          publisher: ol.publisher || vision.publisher, year: ol.year || vision.year,
          language: vision.language || "", series: vision.series || "", volume: vision.volume || "",
          thumbnail: ol.thumbnail || "", isbn: ol.isbn, description: ol.description, categories: [], googleId: "",
        },
      };
    }
  }
  let isbnSearch = false;
  if (vision.isbn) {
    results = await gBooks(`isbn:${vision.isbn}`, 3);
    if (results.length) isbnSearch = true;
  }
  if (!results.length && q.trim()) results = await gBooks(q, 5, "he");
  if (!results.length && q.trim()) results = await gBooks(q, 8);
  if (!results.length) return { googleResults: [], enriched: vision };

  const titleLow = (vision.title || "").toLowerCase().trim();
  const authorLow = (vision.author || "").toLowerCase().trim();
  const hebrewMatches = results.filter(r => r.language === "he" || r.language === "iw");
  const candidates = hebrewMatches.length ? hebrewMatches : results;
  const titleMatch = candidates.find(r => titleLow && (r.title.toLowerCase().includes(titleLow) || titleLow.includes(r.title.toLowerCase())));
  const best = titleMatch || candidates[0];
  const authorMatches = Boolean(authorLow && best.author && (best.author.toLowerCase().includes(authorLow) || authorLow.includes(best.author.toLowerCase())));
  const confidentMatch = isbnSearch || Boolean(titleMatch) || authorMatches;
  return {
    googleResults: results,
    enriched: {
      title: vision.title || best.title, author: vision.author || best.author,
      publisher: best.publisher || vision.publisher, year: best.year || vision.year,
      language: vision.language || best.language, series: vision.series || "",
      volume: vision.volume || "", thumbnail: confidentMatch ? best.thumbnail : "", isbn: best.isbn,
      description: best.description, categories: best.categories, googleId: best.googleId, genre: mapGenre(best.categories),
    },
  };
}

const P_FRONT = `You are an expert OCR and bibliographic system for book covers, specializing in Hebrew books sold in Israel. Analyze this FRONT COVER image carefully.
FIRST, check the image:
- "is_book": true only if the image shows a book (front or back cover, spine, a book held in hand or lying on a surface, an open book). Set false for any other object or product — bottles, cans, sprays, food or cosmetics packaging, boxes, electronics, documents, receipts, screenshots, people, animals, places — even if it has printed text on it. If false, leave all other fields empty.
- "unsafe": true if the image contains nudity or sexual content, graphic violence or gore, or other content inappropriate for a family audience.
HEBREW: most covers are in Hebrew (right-to-left). Titles often use decorative, handwritten-style or very bold display fonts — read them anyway, letter by letter if needed. Use your knowledge of real published books and authors (including translated books, e.g. Pema Chödrön = פמה צ'ודרון) to correct likely misreads, but only output a title/author that matches what is printed. Write Hebrew names in Hebrew as printed.
RULES:
- Copy ALL text EXACTLY as it appears, including subtitles
- For publisher: look for small text at bottom of cover, spine edge, or logo
- For year: look for copyright year or edition year anywhere on cover
- For series/volume: look for series name or number
- Leave "" if not clearly visible
- confidence: 0-1 score for each field
- isbn: if a barcode/ISBN number is visible, copy the 13 digits, else ""
- corners: the four corners of the FRONT COVER itself (not the spine, not the background), as PERCENTAGES of the image width (x) and height (y), 0-100. tl = top-left corner of the cover as seen in the image, tr = top-right, br = bottom-right, bl = bottom-left. If the cover is tilted or photographed at an angle, give the real tilted corner positions. If a corner is cut off by the image edge, estimate it at the edge.
- crop: the tightest axis-aligned box containing only the cover, as PERCENTAGES (x,y = top-left).
FORMAT: inside values, write Hebrew abbreviations with ״ and ׳ (e.g. צה״ל, צ׳ודרון) — never a plain " character.
Return ONLY raw JSON, no code fences, no other text:
{"is_book":true,"unsafe":false,"title":"","author":"","publisher":"","year":"","language":"","series":"","volume":"","isbn":"","confidence":{"title":0,"author":0,"publisher":0,"year":0},"corners":{"tl":[0,0],"tr":[100,0],"br":[100,100],"bl":[0,100]},"crop":{"x":0,"y":0,"width":100,"height":100}}`;

const P_BACK = `You are an expert OCR and bibliographic system for book back covers.
FIRST, check the image:
- "is_book": true only if the image shows a book (front or back cover, spine, a book held in hand or lying on a surface, an open book). Set false for any other object or product — bottles, cans, sprays, food or cosmetics packaging, boxes, electronics, documents, receipts, screenshots, people, animals, places — even if it has printed text on it. If false, leave all other fields empty.
- "unsafe": true if the image contains nudity or sexual content, graphic violence or gore, or other content inappropriate for a family audience.
RULES:
- isbn: look for barcode area, find 13-digit number starting with 978 or 979
- publisher: look for publisher name/logo anywhere
- year: look for copyright symbol © followed by year
- summary: the main descriptive text/blurb about the book
- price: any price in any currency
- genre: category of the book
Leave "" if not clearly visible.
FORMAT: inside values, write Hebrew abbreviations with the Hebrew gershayim ״ and geresh ׳ (e.g. צה״ל, ד״ר, צ׳ודרון) — never a plain " character. Keep the summary under 900 characters. Return ONLY raw JSON, no code fences, no other text:
{"is_book":true,"unsafe":false,"summary":"","isbn":"","publisher":"","year":"","price":"","genre":""}`;

const P_SHELF = `You are an expert at reading book spines on a bookshelf.
Spines are narrow vertical strips — text is ROTATED 90°.
Return ONLY a JSON array. Empty shelves: []
[{"title":"","author":"","publisher":"","year":""}]`;

// ── אימות משתמשים ─────────────────────────────────────────
async function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await pool.query("INSERT INTO sessions (tokenhash,userid,createdat,lastseen) VALUES ($1,$2,$3,$3)", [sha256(token), userId, now]);
  return token;
}

async function loadAuth(req, res, next) {
  const h = req.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return next();
  try {
    const r = await pool.query(
      "SELECT u.*, s.lastseen, s.createdat AS sessioncreated FROM sessions s JOIN users u ON u.id=s.userid WHERE s.tokenhash=$1",
      [sha256(token)]
    );
    const row = r.rows[0];
    if (row && Date.now() - Number(row.sessioncreated) < SESSION_DAYS * DAY) {
      req.user = row;
      req.tokenHash = sha256(token);
      if (Date.now() - Number(row.lastseen || 0) > DAY) pool.query("UPDATE sessions SET lastseen=$1 WHERE tokenhash=$2", [Date.now(), req.tokenHash]).catch(() => {});
    } else {
      req.authFailed = true;
    }
  } catch (e) { console.error("auth:", e.message); }
  next();
}
app.use(loadAuth);

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "יש להתחבר מחדש", code: "auth" });
  // משתמש מושעה יכול לצפות ולמחוק את החשבון, אבל לא לפרסם או לפנות לאחרים
  const deletingSelf = req.method === "DELETE" && /^\/api\/users\/[^/]+$/.test(req.path);
  if (req.user.suspended && !deletingSelf && (req.method !== "GET" || /\/phone$/.test(req.path)))
    return res.status(403).json({ error: "החשבון הושעה. לפרטים אפשר לכתוב לנו: pageturner.team@gmail.com", code: "suspended" });
  next();
}

// ── מה נחשף החוצה ─────────────────────────────────────────
function origin(req) { return `${req.protocol}://${req.get("host")}`; }
function avatarUrl(req, u) {
  if (!u.avatar) return null;
  if (/^https?:/.test(u.avatar)) return u.avatar;
  return `${origin(req)}/api/img/avatar/${u.id}?v=${String(u.avatar).length}`;
}
// פרטים שכל אחד יכול לראות
function publicUser(req, u) {
  return {
    id: u.id, name: u.name, storeName: u.storename || "", type: u.type, bio: u.bio || "",
    avatar: avatarUrl(req, u), createdAt: u.createdat,
  };
}
// פרטים שרק המשתמש עצמו רואה
function privateUser(req, u) {
  return {
    ...publicUser(req, u),
    email: u.email, phone: u.phone || "", address: u.address || "",
    emailConsent: !!u.email_consent, featuredBooks: u.featuredbooks || "[]",
  };
}

// עמודות לרשימות ספרים — בלי טלפון, בלי מיקום מדויק ובלי נתוני תמונה כבדים
const BOOK_COLS = `b.id,b.title,b.author,b.publisher,b.year,b.summary,b.condition,b.series,b.volume,b.isbn,b.genre,b.mode,b.price,
  b.lendduration,b.swapfor,b.lenduntil,b.avail,b.ownername,b.ownertype,b.ownerid,b.city,b.dealstatus,b.createdat,b.lat,b.lng,
  CASE WHEN b.thumbnail LIKE 'http%' AND NOT COALESCE(b.hidden,false) THEN b.thumbnail END AS thumburl,
  (COALESCE(length(b.thumbnail),0) + COALESCE(length(b.frontimg),0)) AS imgver,
  (NOT COALESCE(b.hidden,false) AND (COALESCE(b.thumbnail,'') LIKE 'data:%' OR COALESCE(b.frontimg,'') <> '')) AS hasimg,
  (NOT COALESCE(b.hidden,false) AND COALESCE(b.thumbnail,'') <> '' AND COALESCE(b.frontimg,'') LIKE 'data:%') AS hasphoto,
  COALESCE(b.hidden,false) AS hidden,
  u.id AS uid, CASE WHEN u.avatar IS NOT NULL AND u.avatar <> '' THEN length(u.avatar) END AS avatarver,
  CASE WHEN u.avatar LIKE 'http%' THEN u.avatar END AS avatarurl`;

function publicBook(req, b, coords) {
  const img = b.hasimg ? `${origin(req)}/api/img/book/${b.id}?v=${b.imgver}` : null;
  const thumb = b.thumburl || img;
  const out = {
    id: b.id, title: b.title, author: b.author, publisher: b.publisher, year: b.year, summary: b.summary,
    condition: b.condition, series: b.series, volume: b.volume, isbn: b.isbn, genre: b.genre, mode: b.mode,
    price: b.price, lendduration: b.lendduration, swapfor: b.swapfor, lenduntil: b.lenduntil, avail: b.avail,
    ownername: b.ownername, ownertype: b.ownertype, ownerid: b.ownerid, city: b.city, dealstatus: b.dealstatus,
    createdat: b.createdat, ...(b.hidden ? { hidden: true } : {}),
    thumbnail: thumb, frontimg: img || thumb,
    photo: b.hasphoto ? `${origin(req)}/api/img/book/${b.id}?which=photo&v=${b.imgver}` : null,
    owneravatar: b.avatarurl || (b.avatarver ? `${origin(req)}/api/img/avatar/${b.uid}?v=${b.avatarver}` : null),
  };
  if (coords && b.lat != null && b.lng != null) {
    const own = req.user && req.user.id === b.ownerid;
    out.km = own ? 0 : fuzzKm(dist(coords.lat, coords.lng, b.lat, b.lng));
  }
  return out;
}
async function getBookRow(id) {
  return (await pool.query(`SELECT ${BOOK_COLS} FROM books b LEFT JOIN users u ON b.ownerid=u.id WHERE b.id=$1`, [id])).rows[0];
}

// ── בריאות ───────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch { res.status(503).json({ ok: false }); }
});

// ── תמונות (עם מטמון) ─────────────────────────────────────
function sendImage(res, uri) {
  const parsed = dataUriToBuffer(uri);
  if (!parsed) return false;
  res.set("Content-Type", parsed.mime);
  res.set("Cache-Control", "public, max-age=604800, immutable");
  res.set("Cross-Origin-Resource-Policy", "cross-origin");
  res.send(parsed.buf);
  return true;
}
app.get("/api/img/cover/:id", async (req, res) => {
  try {
    const r = await pool.query("SELECT img FROM covers WHERE id=$1", [req.params.id]);
    if (r.rows[0] && sendImage(res, r.rows[0].img)) return;
    res.status(404).end();
  } catch { res.status(500).end(); }
});
app.get("/api/img/book/:id", async (req, res) => {
  try {
    const r = await pool.query("SELECT thumbnail, frontimg, hidden FROM books WHERE id=$1", [req.params.id]);
    const b = r.rows[0];
    if (!b || b.hidden) return res.status(404).end();
    if (req.query.which === "photo" && b.frontimg?.startsWith("data:") && sendImage(res, b.frontimg)) return;
    if (b.thumbnail?.startsWith("data:") && sendImage(res, b.thumbnail)) return;
    if (b.frontimg?.startsWith("data:") && sendImage(res, b.frontimg)) return;
    const url = [b.thumbnail, b.frontimg].find(x => /^https:\/\//.test(x || ""));
    if (url) return res.redirect(302, url);
    res.status(404).end();
  } catch { res.status(500).end(); }
});
app.get("/api/img/avatar/:id", async (req, res) => {
  try {
    const r = await pool.query("SELECT avatar FROM users WHERE id=$1", [req.params.id]);
    const a = r.rows[0]?.avatar;
    if (a && sendImage(res, a)) return;
    if (/^https:\/\//.test(a || "")) return res.redirect(302, a);
    res.status(404).end();
  } catch { res.status(500).end(); }
});

// ── ניתוח תמונות (מחובר בלבד + מכסה יומית) ─────────────────
async function visionQuota(req, res, next) {
  try {
    const r = await pool.query("SELECT COUNT(*) FROM analytics WHERE event='vision' AND userid=$1 AND createdat>$2", [req.user.id, Date.now() - DAY]);
    if (+r.rows[0].count >= VISION_DAILY_LIMIT) return res.status(429).json({ error: "הגעת למכסת הסריקות היומית. אפשר להזין את פרטי הספר ידנית" });
    track("vision", req.user.id, { path: req.path });
    next();
  } catch (e) { next(e); }
}
const visionGuard = [limit("vision", 80, 10 * 60 * 1000), requireAuth, upload.single("image"), visionQuota];

app.post("/api/analyze/front", visionGuard, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "לא הועלתה תמונה" });
  try {
    const { buf, mime } = await prepForVision(req.file);
    const readFront = async model => {
      const raw = model ? await callClaudeText(model, buf, mime, P_FRONT, 1500) : await claudeVision(buf, mime, P_FRONT, 1500);
      try { return parseJ(raw); } catch { console.error("front: unparseable answer:", String(raw).slice(0, 300)); return {}; }
    };
    let vision = await readFront();
    const gate = imageGate(vision);
    if (gate) { track("image_rejected", req.user.id, { reason: gate, at: "scan_front" }); return res.status(422).json({ error: MOD_ERRORS[gate], code: "image_" + gate }); }
    if (!String(vision.title || "").trim() && VISION_MODEL !== VISION_FALLBACK_MODEL) {
      console.log("front: no title from", VISION_MODEL, "— retrying with", VISION_FALLBACK_MODEL);
      const v2 = await readFront(VISION_FALLBACK_MODEL).catch(e => { console.error("front retry:", e.message); return {}; });
      if (String(v2.title || "").trim()) vision = v2;
    }
    console.log(`front: title="${vision.title || ""}" author="${vision.author || ""}" corners=${vision.corners ? "yes" : "no"} img=${buf.length}b`);
    Object.keys(vision).forEach(k => { if (typeof vision[k] === "string") vision[k] = cleanText(vision[k]); });
    const conf = vision.confidence || {};
    if ((conf.publisher || 0) < 0.7) vision.publisher = "";
    if ((conf.year || 0) < 0.7) vision.year = "";
    if ((conf.author || 0) < 0.7) vision.author = "";
    const { googleResults, enriched } = await enrich(vision);
    const policy = await checkBookPolicy({ title: enriched.title || vision.title, author: enriched.author || vision.author, summary: enriched.summary });
    if (policy.block) {
      recordBlocked(req, { title: enriched.title || vision.title, author: enriched.author || vision.author, category: policy.category, reason: policy.reason }, "scan").catch(e => console.error("blocked:", e.message));
      return res.status(422).json({ error: POLICY_ERROR, code: "book_blocked" });
    }
    const straight = await warpCover(buf, vision.corners);
    if (!straight && vision.corners) console.log("front: corners rejected", JSON.stringify(vision.corners));
    const croppedImage = straight || await cropBookImage(buf, vision.crop);
    const meta = { isbn: enriched.isbn || vision.isbn, title: enriched.title, author: enriched.author };
    const communityCover = coverUrl(req, await findCover(meta));
    res.json({ ok: true, data: { ...enriched, isbn: normIsbn(meta.isbn) || enriched.isbn || "" }, googleResults, croppedImage, straightened: !!straight, communityCover });
  } catch (e) {
    console.error("analyze/front:", e.message);
    res.status(502).json({ error: "לא הצלחנו לנתח את התמונה, אפשר למלא את הפרטים ידנית" });
  }
});

app.post("/api/analyze/back", visionGuard, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "לא הועלתה תמונה" });
  try {
    const { buf, mime } = await prepForVision(req.file);
    const raw = await claudeVision(buf, mime, P_BACK, 1500);
    let data = {};
    try { data = parseJ(raw); } catch {
      console.error("back: unparseable answer:", String(raw).slice(0, 300));
      // לא מכניסים טקסט טכני לשדה התקציר
      const plain = stripFences(raw);
      data = /^[{\[]/.test(plain) ? {} : { summary: plain };
    }
    const gate = imageGate(data);
    if (gate) { track("image_rejected", req.user.id, { reason: gate, at: "scan_back" }); return res.status(422).json({ error: MOD_ERRORS[gate], code: "image_" + gate }); }
    Object.keys(data).forEach(k => { if (typeof data[k] === "string") data[k] = cleanText(data[k]); });
    let googleData = {};
    if (data.isbn && /^97[89]/.test(data.isbn)) {
      const results = await gBooks(`isbn:${data.isbn}`, 1);
      if (results.length) googleData = { publisher: results[0].publisher, year: results[0].year, title: results[0].title, author: results[0].author, thumbnail: results[0].thumbnail };
    }
    const communityCover = coverUrl(req, await findCover({ isbn: data.isbn, title: googleData.title, author: googleData.author }));
    res.json({ ok: true, communityCover, data: {
      summary: data.summary || "", isbn: normIsbn(data.isbn) || data.isbn || "", price: data.price || "", genre: data.genre || "",
      publisher: googleData.publisher || data.publisher || "", year: googleData.year || data.year || "",
      googleTitle: googleData.title || "", googleAuthor: googleData.author || "", thumbnail: googleData.thumbnail || "",
    } });
  } catch (e) {
    console.error("analyze/back:", e.message);
    res.status(502).json({ error: "לא הצלחנו לנתח את התמונה, אפשר למלא את הפרטים ידנית" });
  }
});

app.post("/api/analyze/shelf", visionGuard, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "לא הועלתה תמונה" });
  try {
    const { buf, mime } = await prepForVision(req.file);
    const raw = await claudeVision(buf, mime, P_SHELF, 2500);
    let arr = [];
    try { const p = parseJ(raw); arr = Array.isArray(p) ? p : []; } catch { arr = []; }
    const results = arr.filter(x => x.title?.trim()).map(x => ({ title: (x.title || "").trim(), author: (x.author || "").trim(), publisher: (x.publisher || "").trim(), year: (x.year || "").trim() }));
    res.json({ ok: true, data: results, count: results.length });
  } catch (e) {
    console.error("analyze/shelf:", e.message);
    res.status(502).json({ error: "לא הצלחנו לנתח את התמונה" });
  }
});

// ── חיפוש חיצוני ──────────────────────────────────────────
app.get("/api/books/search", limit("gsearch", 60, 60 * 1000), async (req, res) => {
  const { q, limit: lim = "10" } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: "חסר q" });
  const results = await gBooks(q, Math.min(Number(lim) || 10, 20));
  res.json({ ok: true, results, count: results.length });
});

app.get("/api/books/search-google", limit("gsearch", 60, 60 * 1000), async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "missing q" });
  const key = process.env.GOOGLE_BOOKS_API_KEY ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}` : "";
  const [olRes, gbRes] = await Promise.all([
    fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=5&fields=key,title,author_name,cover_i,first_publish_year`, { headers: { "User-Agent": NOMINATIM_UA } }).then(r => r.json()).catch(() => ({ docs: [] })),
    fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5${key}`).then(r => r.json()).catch(() => ({ items: [] })),
  ]);
  const olResults = (olRes.docs || []).map(item => ({
    googleId: item.key, title: item.title || "", author: (item.author_name || []).slice(0, 2).join(", "),
    thumbnail: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-M.jpg` : "",
    year: item.first_publish_year ? String(item.first_publish_year) : "",
  }));
  const gbResults = (gbRes.items || []).map(item => ({
    googleId: item.id, title: item.volumeInfo?.title || "", author: (item.volumeInfo?.authors || []).join(", "),
    thumbnail: item.volumeInfo?.imageLinks?.thumbnail?.replace("http://", "https://") || "",
    year: item.volumeInfo?.publishedDate?.substring(0, 4) || "",
  }));
  const seen = new Set(olResults.map(x => x.title.toLowerCase()));
  res.json([...olResults, ...gbResults.filter(x => !seen.has(x.title.toLowerCase()))].slice(0, 8));
});

// סריקת ברקוד: פרטי ספר וכריכה לפי ISBN
app.get("/api/books/isbn/:isbn", limit("isbn", 60, 10 * 60 * 1000), requireAuth, async (req, res) => {
  const isbn = normIsbn(req.params.isbn);
  if (!isbn) return res.status(400).json({ error: "הברקוד לא נראה כמו ISBN של ספר" });
  try {
    let info = await openLibrary(isbn);
    const g = (await gBooks(`isbn:${isbn}`, 1))[0];
    if (g) info = { ...(info || {}), title: g.title || info?.title, author: g.author || info?.author, publisher: g.publisher || info?.publisher, year: g.year || info?.year, description: g.description || info?.description, thumbnail: g.thumbnail || info?.thumbnail, genre: mapGenre(g.categories) };
    const community = await findCover({ isbn, title: info?.title, author: info?.author });
    const olCover = community ? null : await openLibraryCover(isbn);
    res.json({ ok: true, found: !!(info?.title), data: {
      isbn, title: info?.title || "", author: info?.author || "", publisher: info?.publisher || "", year: info?.year || "",
      summary: info?.description || "", genre: info?.genre || "",
      thumbnail: coverUrl(req, community) || olCover || info?.thumbnail || "",
    } });
  } catch (e) { console.error("isbn:", e.message); res.status(500).json({ error: "שגיאה בחיפוש הספר" }); }
});

app.get("/api/covers/lookup", limit("isbn", 60, 10 * 60 * 1000), async (req, res) => {
  const id = await findCover({ isbn: req.query.isbn, title: req.query.title, author: req.query.author }).catch(() => null);
  res.json({ ok: true, cover: coverUrl(req, id) });
});

// ── ספרים ────────────────────────────────────────────────
function parseCoords(q) {
  const lat = parseFloat(q.lat), lng = parseFloat(q.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

app.get("/api/books", async (req, res) => {
  const { q, mode, ownerId, all, genre } = req.query;
  const coords = parseCoords(req.query);
  try {
    if (ownerId && all) {
      const r = await pool.query(`SELECT ${BOOK_COLS} FROM books b LEFT JOIN users u ON b.ownerid=u.id WHERE b.ownerid=$1 ORDER BY b.createdat DESC`, [ownerId]);
      return res.json(r.rows.map(b => publicBook(req, b, coords)));
    }
    let query = `SELECT ${BOOK_COLS} FROM books b LEFT JOIN users u ON b.ownerid=u.id WHERE b.avail=true`;
    const params = [];
    if (q?.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`);
      query += ` AND (LOWER(b.title) LIKE $${params.length} OR LOWER(b.author) LIKE $${params.length} OR LOWER(b.ownername) LIKE $${params.length})`;
    }
    if (mode && mode !== "all") { params.push(mode); query += ` AND b.mode=$${params.length}`; }
    if (genre && genre !== "all") { params.push(genre); query += ` AND b.genre=$${params.length}`; }
    query += " ORDER BY b.createdat DESC LIMIT 500";
    const r = await pool.query(query, params);
    let books = r.rows.map(b => publicBook(req, b, coords));
    if (coords) books.sort((a, b) => (a.km ?? 999) - (b.km ?? 999));
    res.json(books);
  } catch (e) { console.error("books:", e.message); res.status(500).json({ error: "שגיאה בטעינת ספרים" }); }
});

app.get("/api/books/:id", async (req, res) => {
  try {
    const b = await getBookRow(req.params.id);
    if (!b) return res.status(404).json({ error: "לא נמצא" });
    res.json(publicBook(req, b, parseCoords(req.query)));
  } catch { res.status(500).json({ error: "שגיאה" }); }
});

// מקבל data URI או קישור https לתמונה, ומחזיר גרסה קטנה ובטוחה לשמירה
async function cleanThumbnail(t) {
  if (!t) return null;
  const own = /\/api\/img\/cover\/([a-f0-9]{24})(?:$|\?)/.exec(t);
  if (own) {
    const r = await pool.query("UPDATE covers SET uses=uses+1 WHERE id=$1 RETURNING img", [own[1]]);
    return r.rows[0]?.img || null;
  }
  if (/^https:\/\/[^\s"'<>]+$/.test(t)) return COVER_HOSTS.test(t) ? clip(t, 1000) : null;
  const parsed = dataUriToBuffer(t);
  if (!parsed) return null;
  try { return await shrinkImage(parsed.buf, 600, 900, 80); } catch { return null; }
}

app.post("/api/books", limit("publish", 120, 60 * 60 * 1000), requireAuth, upload.single("frontImage"), async (req, res) => {
  const b = req.body;
  const u = req.user;
  if (!b.title?.trim()) return res.status(400).json({ error: "שם הספר הוא שדה חובה" });
  if (!u.phone) return res.status(400).json({ error: "כדי לפרסם ספר צריך להוסיף מספר טלפון בפרופיל", code: "phone" });
  try {
    const id = randomUUID();
    let frontImg = null;
    if (req.file) {
      try { frontImg = await shrinkImage(req.file.buffer, 1000, 1400, 82); }
      catch { return res.status(400).json({ error: "קובץ התמונה לא נתמך, נסו תמונה אחרת" }); }
    }
    const policy = await checkBookPolicy({ title: b.title, author: b.author, summary: b.summary });
    if (policy.block) {
      recordBlocked(req, { title: b.title, author: b.author, category: policy.category, reason: policy.reason }, "publish").catch(e => console.error("blocked:", e.message));
      return res.status(400).json({ error: POLICY_ERROR, code: "book_blocked" });
    }
    const thumbnail = await cleanThumbnail(b.thumbnail);
    // בדיקת התמונות שהמשתמש העלה (תמונה מהספרייה המשותפת או מקטלוג כבר נבדקה)
    const toCheck = [frontImg, thumbnail?.startsWith("data:") && !/\/api\/img\/cover\//.test(b.thumbnail || "") ? thumbnail : null]
      .filter(Boolean).map(d => dataUriToBuffer(d)?.buf).filter(Boolean);
    const mod = await moderateImages(toCheck);
    if (mod.status === "unsafe" || mod.status === "notbook") {
      track("image_rejected", u.id, { reason: mod.status, title: clip(b.title, 80) });
      return res.status(400).json({ error: MOD_ERRORS[mod.status], code: "image_" + mod.status });
    }
    const coords = parseCoords(b);
    const city = coords ? await reverseGeocode(coords.lat, coords.lng) : null;
    const mode = ["sell", "lend", "swap", "give"].includes(b.mode) ? b.mode : "sell";
    await pool.query(
      `INSERT INTO books (id,title,author,publisher,year,summary,condition,series,volume,isbn,genre,mode,price,lendduration,swapfor,lenduntil,avail,ownerName,ownerType,phone,ownerId,lat,lng,city,frontImg,thumbnail,createdAt,imgcheck)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
      [id, clip(b.title.trim(), 300), clip(b.author, 200), clip(b.publisher, 200), clip(b.year, 10), clip(b.summary, 4000), clip(b.condition, 100),
       clip(b.series, 200), clip(b.volume, 20), clip(b.isbn, 20), clip(b.genre, 60), mode,
       mode === "sell" ? (Number(b.price) || null) : null, clip(b.lendDuration, 60), clip(b.swapFor, 300), clip(b.lendUntil || b.lenduntil, 20),
       true, u.storename || u.name || "", u.type || "private", u.phone || "", u.id,
       coords?.lat ?? null, coords?.lng ?? null, city, frontImg, thumbnail, Date.now(), toCheck.length ? mod.status : null]
    );
    if (mod.status === "unchecked") notifyUnchecked(req, id, b.title, u).catch(e => console.error("unchecked notify:", e.message));
    if (b.coverQuality === "straight" && thumbnail?.startsWith("data:") && mod.status === "ok") {
      saveCover({ isbn: b.isbn, title: b.title, author: b.author }, thumbnail, "user").catch(e => console.error("saveCover:", e.message));
    }
    track("book_publish", u.id, { bookId: id, title: b.title, mode, city });
    notifyWishlist(id, b.title, b.author, u.id).catch(e => console.error("wishlist notify:", e.message));
    res.json({ ok: true, book: publicBook(req, await getBookRow(id), coords) });
  } catch (e) { console.error("publish:", e.message); res.status(500).json({ error: "הפרסום נכשל, נסו שוב" }); }
});

async function ownBook(req, res) {
  const existing = (await pool.query("SELECT * FROM books WHERE id=$1", [req.params.id])).rows[0];
  if (!existing) { res.status(404).json({ error: "הספר לא נמצא" }); return null; }
  if (existing.ownerid !== req.user.id) { res.status(403).json({ error: "אין הרשאה לשנות ספר של משתמש אחר" }); return null; }
  return existing;
}

app.put("/api/books/:id", requireAuth, async (req, res) => {
  const { title, author, publisher, year, summary, mode, price, condition, lendDuration, swapFor, lendUntil, avail, dealStatus } = req.body;
  try {
    const existing = await ownBook(req, res);
    if (!existing) return;
    if ((title && title !== existing.title) || (author !== undefined && author !== existing.author) || (summary !== undefined && summary !== existing.summary)) {
      const t = title || existing.title, a = author ?? existing.author;
      const policy = await checkBookPolicy({ title: t, author: a, summary: summary ?? existing.summary });
      if (policy.block) {
        recordBlocked(req, { title: t, author: a, category: policy.category, reason: policy.reason }, "edit").catch(e => console.error("blocked:", e.message));
        return res.status(400).json({ error: POLICY_ERROR, code: "book_blocked" });
      }
    }
    const newMode = ["sell", "lend", "swap", "give"].includes(mode) ? mode : existing.mode;
    const newPrice = newMode === "sell" ? (price !== undefined && price !== null && price !== "" ? Number(price) || null : existing.price) : null;
    const coords = parseCoords(req.body);
    const city = coords ? (await reverseGeocode(coords.lat, coords.lng)) || existing.city : existing.city;
    await pool.query(
      `UPDATE books SET title=$1,author=$2,publisher=$3,year=$4,summary=$5,mode=$6,price=$7,condition=$8,lendduration=$9,swapfor=$10,lenduntil=$11,avail=$12,lat=$13,lng=$14,city=$15,dealstatus=$16 WHERE id=$17`,
      [clip(title || existing.title, 300), clip(author ?? existing.author, 200), clip(publisher ?? existing.publisher, 200), clip(year ?? existing.year, 10),
       clip(summary ?? existing.summary, 4000), newMode, newPrice, clip(condition ?? existing.condition, 100),
       clip(lendDuration ?? existing.lendduration, 60), clip(swapFor ?? existing.swapfor, 300), clip(lendUntil ?? existing.lenduntil ?? "", 20),
       existing.hidden ? false : (typeof avail === "boolean" ? avail : existing.avail), coords ? coords.lat : existing.lat, coords ? coords.lng : existing.lng, city,
       dealStatus !== undefined ? (dealStatus ? clip(dealStatus, 20) : null) : existing.dealstatus, req.params.id]
    );
    if (dealStatus && existing.avail) track("book_deal", req.user.id, { bookId: req.params.id, dealStatus });
    res.json({ ok: true, book: publicBook(req, await getBookRow(req.params.id), null) });
  } catch (e) { console.error("update book:", e.message); res.status(500).json({ error: "העדכון נכשל" }); }
});

// ── דיווח על מודעה והסתרה ─────────────────────────────────
async function hideBook(id, why) {
  await pool.query("UPDATE books SET hidden=true, avail=false WHERE id=$1", [id]);
  track("book_hidden", null, { bookId: id, why });
}
async function notifyUnchecked(req, id, title, u) {
  if (!process.env.ADMIN_EMAIL) return;
  const hide = `${apiUrl(req)}/api/admin/hide/${id}?t=${hideToken(id)}`;
  await sendEmail(process.env.ADMIN_EMAIL, `🖼️ ספר עם תמונה שלא נבדקה: ${clip(title, 60)}`, `<div dir="rtl" style="font-family:sans-serif">
    <p>הבדיקה האוטומטית של התמונה לא הצליחה (למשל בעיה זמנית בשירות), והספר פורסם בלי בדיקה. כדאי להציץ.</p>
    <p><b>${escapeHtml(title)}</b> · פורסם על ידי ${escapeHtml(u.name || "")}</p>
    <p><a href="${siteUrl()}/?book=${id}">לצפייה בספר</a> · <a href="${hide}">להסתיר את הספר</a></p></div>`);
}
const REPORT_REASONS = { image: "תמונה לא הולמת", notbook: "זה לא ספר", misleading: "מודעה מטעה", other: "אחר" };
const AUTO_HIDE_REPORTS = 3;
app.post("/api/books/:id/report", limit("report", 20, 60 * 60 * 1000), requireAuth, async (req, res) => {
  const reason = REPORT_REASONS[req.body.reason] ? req.body.reason : "other";
  const note = clip(String(req.body.note || "").trim(), 500);
  try {
    const b = (await pool.query("SELECT id, title, ownerid, ownername, hidden FROM books WHERE id=$1", [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: "הספר לא נמצא" });
    if (b.ownerid === req.user.id) return res.status(400).json({ error: "אי אפשר לדווח על ספר שלך" });
    const ins = await pool.query("INSERT INTO reports (bookid,userid,reason,createdat) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [b.id, req.user.id, reason, Date.now()]);
    const count = Number((await pool.query("SELECT COUNT(*) FROM reports WHERE bookid=$1", [b.id])).rows[0].count);
    let autoHidden = false;
    if (!b.hidden && count >= AUTO_HIDE_REPORTS) { await hideBook(b.id, "reports"); autoHidden = true; }
    if (ins.rowCount && process.env.ADMIN_EMAIL) {
      const hide = `${apiUrl(req)}/api/admin/hide/${b.id}?t=${hideToken(b.id)}`;
      sendEmail(process.env.ADMIN_EMAIL, `🚩 דיווח על מודעה: ${clip(b.title, 60)}${autoHidden ? " (הוסתרה אוטומטית)" : ""}`, `<div dir="rtl" style="font-family:sans-serif">
        <p><b>${escapeHtml(b.title)}</b> · של ${escapeHtml(b.ownername || "")}</p>
        <p>סיבה: ${REPORT_REASONS[reason]}${note ? `<br>הערה: ${escapeHtml(note)}` : ""}</p>
        <p>דיווח מאת: ${escapeHtml(req.user.name || "")} (${escapeHtml(req.user.email || "")}) · סך הכל ${count} דיווחים${autoHidden ? " · <b>המודעה הוסתרה אוטומטית</b>" : ""}</p>
        <p><a href="${siteUrl()}/?book=${b.id}">לצפייה בספר</a>${b.hidden || autoHidden ? "" : ` · <a href="${hide}">להסתיר את הספר</a>`}</p></div>`).catch(e => console.error("report email:", e.message));
    }
    track("book_report", req.user.id, { bookId: b.id, reason });
    res.json({ ok: true });
  } catch (e) { console.error("report:", e.message); res.status(500).json({ error: "הדיווח נכשל, נסו שוב" }); }
});
// קישור הסתרה מהמייל למנהל (חתום, בלי צורך בהתחברות)
app.get("/api/admin/hide/:id", limit("admin", 30, 15 * 60 * 1000), async (req, res) => {
  const ok = typeof req.query.t === "string" && safeEqual(req.query.t, hideToken(req.params.id));
  const page = msg => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div dir="rtl" style="font-family:sans-serif;padding:40px;text-align:center;font-size:18px">${msg}</div>`;
  if (!ok) return res.status(403).send(page("הקישור לא תקין"));
  try {
    const r = await pool.query("SELECT title FROM books WHERE id=$1", [req.params.id]);
    if (!r.rows[0]) return res.status(404).send(page("הספר לא נמצא (אולי כבר נמחק)"));
    await hideBook(req.params.id, "admin");
    res.send(page(`✅ הספר "${escapeHtml(r.rows[0].title)}" הוסתר מהאתר`));
  } catch (e) { console.error("hide:", e.message); res.status(500).send(page("שגיאה, נסו שוב")); }
});

app.get("/api/admin/suspend/:id", limit("admin", 30, 15 * 60 * 1000), async (req, res) => {
  const ok = typeof req.query.t === "string" && safeEqual(req.query.t, suspendToken(req.params.id));
  const page = msg => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div dir="rtl" style="font-family:sans-serif;padding:40px;text-align:center;font-size:18px">${msg}</div>`;
  if (!ok) return res.status(403).send(page("הקישור לא תקין"));
  try {
    const u = (await pool.query("UPDATE users SET suspended=true WHERE id=$1 RETURNING name", [req.params.id])).rows[0];
    if (!u) return res.status(404).send(page("המשתמש לא נמצא (אולי מחק את החשבון)"));
    const h = await pool.query("UPDATE books SET hidden=true, avail=false WHERE ownerid=$1", [req.params.id]);
    await pool.query("DELETE FROM sessions WHERE userid=$1", [req.params.id]);
    track("user_suspended", req.params.id, { books: h.rowCount });
    res.send(page(`✅ המשתמש ${escapeHtml(u.name || "")} הושעה, ו-${h.rowCount} הספרים שלו הוסתרו מהאתר`));
  } catch (e) { console.error("suspend:", e.message); res.status(500).send(page("שגיאה, נסו שוב")); }
});

app.delete("/api/books/:id", requireAuth, async (req, res) => {
  try {
    const existing = await ownBook(req, res);
    if (!existing) return;
    await pool.query("DELETE FROM books WHERE id=$1", [req.params.id]);
    await pool.query("DELETE FROM favorites WHERE bookid=$1", [req.params.id]);
    await pool.query("DELETE FROM reports WHERE bookid=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error("delete book:", e.message); res.status(500).json({ error: "המחיקה נכשלה" }); }
});

// ── יצירת קשר: הטלפון נחשף רק למשתמש מחובר ─────────────────
async function recordContact(bookId, bookTitle, fromUserId, toUserId, type) {
  const existing = await pool.query("SELECT * FROM contacts WHERE bookId=$1 AND fromUserId=$2 ORDER BY createdat DESC LIMIT 1", [bookId, fromUserId]);
  const c = existing.rows[0];
  if (c && c.status === "pending" && !c.askedstatus) return c;
  const id = randomUUID();
  await pool.query(
    "INSERT INTO contacts (id,bookId,bookTitle,fromUserId,toUserId,type,status,askedStatus,createdAt) VALUES ($1,$2,$3,$4,$5,$6,'pending',false,$7)",
    [id, bookId, clip(bookTitle, 300), fromUserId, toUserId || "", ["whatsapp", "phone"].includes(type) ? type : "whatsapp", Date.now()]
  );
  track("book_contact", fromUserId, { bookId, type });
  return { id };
}

// מחזיר את מספר הטלפון של המפרסם (לצפייה בדף הספר)
app.get("/api/books/:id/phone", requireAuth, async (req, res) => {
  if (!hit(`phone:${req.user.id}`, 80, DAY)) return res.status(429).json({ error: "הגעת למכסת הפניות היומית" });
  try {
    const b = (await pool.query("SELECT phone, ownerid, avail FROM books WHERE id=$1", [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: "הספר לא נמצא" });
    if (!b.avail && b.ownerid !== req.user.id) return res.status(410).json({ error: "הספר כבר לא זמין" });
    let phone = b.phone;
    if (b.ownerid) {
      const o = (await pool.query("SELECT phone FROM users WHERE id=$1", [b.ownerid])).rows[0];
      if (o?.phone) phone = o.phone;
    }
    res.json({ ok: true, phone: phone || "" });
  } catch { res.status(500).json({ error: "שגיאה" }); }
});

app.post("/api/contacts", requireAuth, async (req, res) => {
  const { bookId, type } = req.body;
  if (!bookId) return res.status(400).json({ error: "חסרים פרטים" });
  try {
    const b = (await pool.query("SELECT title, ownerid FROM books WHERE id=$1", [bookId])).rows[0];
    if (!b) return res.status(404).json({ error: "הספר לא נמצא" });
    if (b.ownerid === req.user.id) return res.json({ ok: true });
    const contact = await recordContact(bookId, b.title, req.user.id, b.ownerid, type);
    res.json({ ok: true, contact });
  } catch (e) { console.error("contact:", e.message); res.status(500).json({ error: "שגיאה" }); }
});

app.get("/api/contacts/owner-pending/:userId", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, b.title as booktitle, u.name as interestedname
       FROM contacts c LEFT JOIN books b ON c.bookid=b.id LEFT JOIN users u ON c.fromuserid=u.id
       WHERE c.touserid=$1 AND c.status='done' AND c.ownerasked=false AND b.avail=true
       ORDER BY c.createdat DESC LIMIT 1`,
      [req.user.id]
    );
    res.json(result.rows[0] || null);
  } catch { res.status(500).json({ error: "שגיאה" }); }
});

app.get("/api/contacts/pending/:userId", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, b.title as booktitle FROM contacts c LEFT JOIN books b ON c.bookid=b.id
       WHERE c.fromuserid=$1 AND c.status='pending' AND c.askedstatus=false AND b.avail=true
       ORDER BY c.createdat DESC LIMIT 1`,
      [req.user.id]
    );
    res.json(result.rows[0] || null);
  } catch { res.status(500).json({ error: "שגיאה" }); }
});

app.put("/api/contacts/:id", requireAuth, async (req, res) => {
  try {
    const { status, dealStatus, markAsked, confirmedByOwner } = req.body;
    const contact = (await pool.query("SELECT * FROM contacts WHERE id=$1", [req.params.id])).rows[0];
    if (!contact) return res.status(404).json({ error: "לא נמצא" });
    const me = req.user.id;
    const isInterested = contact.fromuserid === me;
    const isOwner = contact.touserid === me;
    if (!isInterested && !isOwner) return res.status(403).json({ error: "אין הרשאה" });

    if (isInterested && confirmedByOwner === undefined) {
      const st = ["pending", "no", "skip", "done"].includes(status) ? status : contact.status;
      await pool.query("UPDATE contacts SET status=$1, askedStatus=$2 WHERE id=$3", [st, markAsked === true, contact.id]);
    }
    if (isOwner && confirmedByOwner !== undefined) {
      await pool.query("UPDATE contacts SET ownerAsked=true, ownerConfirmed=$1 WHERE id=$2", [!!confirmedByOwner, contact.id]);
      if (confirmedByOwner && contact.status === "done") {
        const bookRow = (await pool.query("SELECT * FROM books WHERE id=$1", [contact.bookid])).rows[0];
        if (bookRow && bookRow.ownerid === me && bookRow.avail) {
          const newOwnerId = contact.fromuserid;
          await pool.query("INSERT INTO book_history (id,bookid,fromuserid,touserid,type,createdat) VALUES ($1,$2,$3,$4,$5,$6)",
            [randomUUID(), bookRow.id, bookRow.ownerid, newOwnerId, clip(dealStatus || "agreed", 20), Date.now()]);
          const newOwner = (await pool.query("SELECT name,storename FROM users WHERE id=$1", [newOwnerId])).rows[0];
          await pool.query("UPDATE books SET avail=false,dealstatus=null,prevownerid=$1,ownerid=$2,ownername=$3 WHERE id=$4",
            [bookRow.ownerid, newOwnerId, newOwner?.storename || newOwner?.name || "", bookRow.id]);
          track("book_deal", me, { bookId: bookRow.id, dealStatus });
        }
      }
    }
    res.json({ ok: true });
  } catch (e) { console.error("contact update:", e.message); res.status(500).json({ error: "שגיאה" }); }
});

// ── קוד כניסה במייל (OTP) ─────────────────────────────────
async function sendEmail(to, subject, html, attachments) {
  if (!process.env.RESEND_API_KEY) { console.log(`[email skipped] to=${to} subject=${subject}${attachments ? " attachments=" + attachments.map(a => a.filename + ":" + a.content.length).join(",") : ""}`); return; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Pageturner <noreply@pageturner.co.il>", to: [to], subject, html, ...(attachments ? { attachments } : {}) }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Resend ${r.status}: ${t.slice(0, 200)}`); }
  const kind = /קוד הכניסה/.test(subject) ? "otp" : /גיבוי/.test(subject) ? "backup" : /דוח/.test(subject) ? "report" : /זמין עכשיו/.test(subject) ? "wishlist" : "admin";
  track("email_sent", null, { kind });
}

app.post("/api/auth/send-otp", limit("otp-send", 40, 15 * 60 * 1000), async (req, res) => {
  const email = normEmail(req.body.email);
  if (!isEmail(email)) return res.status(400).json({ error: "כתובת המייל לא תקינה" });
  try {
    const now = Date.now();
    const row = (await pool.query("SELECT * FROM otps WHERE email=$1", [email])).rows[0];
    let sends = 1, windowstart = now;
    if (row && now - Number(row.windowstart) < 60 * 60 * 1000) {
      if (row.sends >= 5) return res.status(429).json({ error: "נשלחו יותר מדי קודים לכתובת הזו. נסו שוב בעוד שעה" });
      sends = row.sends + 1; windowstart = Number(row.windowstart);
    }
    const code = String(randomInt(100000, 1000000));
    await pool.query(
      `INSERT INTO otps (email,codehash,expires,attempts,sends,windowstart) VALUES ($1,$2,$3,0,$4,$5)
       ON CONFLICT (email) DO UPDATE SET codehash=$2, expires=$3, attempts=0, sends=$4, windowstart=$5`,
      [email, sha256(email + ":" + code), now + 10 * 60 * 1000, sends, windowstart]
    );
    if (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production") console.log(`[dev] OTP for ${email}: ${code}`);
    await sendEmail(email, "קוד הכניסה שלך ל-Pageturner", `<div dir="rtl" style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px">
      <h2 style="color:#1E2D3D">📚 Pageturner</h2>
      <p>קוד הכניסה שלך:</p>
      <div style="font-size:36px;font-weight:900;letter-spacing:8px;color:#1E2D3D;padding:16px;background:#f0f4ec;border-radius:12px;text-align:center">${code}</div>
      <p style="color:#888;font-size:12px">הקוד תקף ל-10 דקות. אם לא ביקשת קוד, אפשר להתעלם מההודעה.</p>
    </div>`);
    track("otp_sent", null, { ctx: req.body.ctx === "signup" ? "signup" : "login", eh: emailKey(email) });
    res.json({ ok: true });
  } catch (e) {
    console.error("OTP send:", e.message);
    res.status(500).json({ error: "לא הצלחנו לשלוח את הקוד. בדקו את כתובת המייל ונסו שוב" });
  }
});

app.post("/api/auth/verify-otp", limit("otp-verify", 80, 15 * 60 * 1000), async (req, res) => {
  const email = normEmail(req.body.email);
  const code = String(req.body.code || "").trim();
  if (!email || !code) return res.status(400).json({ error: "חסרים פרטים" });
  try {
    const row = (await pool.query("SELECT * FROM otps WHERE email=$1", [email])).rows[0];
    if (!row || !row.codehash) return res.status(400).json({ error: "לא נשלח קוד לכתובת הזו" });
    if (Date.now() > Number(row.expires)) return res.status(400).json({ error: "הקוד פג תוקף, בקשו קוד חדש" });
    if (row.attempts >= 5) return res.status(429).json({ error: "יותר מדי ניסיונות. בקשו קוד חדש" });
    if (!safeEqual(row.codehash, sha256(email + ":" + code))) {
      await pool.query("UPDATE otps SET attempts=attempts+1 WHERE email=$1", [email]);
      track("otp_bad", null, { eh: emailKey(email) });
      return res.status(400).json({ error: "הקוד שגוי" });
    }
    const existing = (await pool.query("SELECT * FROM users WHERE email=$1", [email])).rows[0];
    if (existing) {
      await pool.query("UPDATE otps SET codehash=NULL WHERE email=$1", [email]);
      const token = await createSession(existing.id);
      track("login", existing.id, {});
      return res.json({ ok: true, user: privateUser(req, existing), token, isNew: false });
    }
    // משתמש חדש: כרטיס הרשמה חד-פעמי שתקף ל-30 דקות
    const ticket = randomBytes(24).toString("base64url");
    await pool.query("UPDATE otps SET codehash=NULL, tickethash=$2, ticketexpires=$3, ticketvia='email' WHERE email=$1", [email, sha256(ticket), Date.now() + 30 * 60 * 1000]);
    track("otp_ok", null, { eh: emailKey(email) });
    res.json({ ok: true, user: null, isNew: true, ticket });
  } catch (e) { console.error("OTP verify:", e.message); res.status(500).json({ error: "שגיאה באימות, נסו שוב" }); }
});

// ── כניסה עם Google: אימות ה-ID token מול המפתחות הציבוריים של Google (בלי ספריות) ──
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "558837526271-at1k2c514u1bj7h7n6pjbq3n0genks6m.apps.googleusercontent.com";
let googleKeys = { keys: [], exp: 0 };
async function googleKey(kid, retry = true) {
  if (Date.now() > googleKeys.exp || (retry && !googleKeys.keys.find(k => k.kid === kid))) {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if (!r.ok) throw new Error("google certs " + r.status);
    const maxAge = Number((r.headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1] || 3600);
    googleKeys = { keys: (await r.json()).keys || [], exp: Date.now() + maxAge * 1000 };
  }
  return googleKeys.keys.find(k => k.kid === kid);
}
async function verifyGoogleToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("bad token");
  const dec = x => JSON.parse(Buffer.from(x, "base64url").toString("utf8"));
  const header = dec(parts[0]), payload = dec(parts[1]);
  if (header.alg !== "RS256") throw new Error("bad alg");
  const jwk = await googleKey(header.kid);
  if (!jwk) throw new Error("unknown key");
  const ok = cryptoVerify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  if (!ok) throw new Error("bad signature");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) throw new Error("bad iss");
  if (payload.aud !== GOOGLE_CLIENT_ID) throw new Error("bad aud");
  if (!payload.exp || payload.exp * 1000 < Date.now() - 60000) throw new Error("expired");
  if (!payload.email || payload.email_verified !== true && payload.email_verified !== "true") throw new Error("email not verified");
  return payload;
}

app.post("/api/auth/google", limit("google", 60, 15 * 60 * 1000), async (req, res) => {
  let g;
  try { g = await verifyGoogleToken(req.body.credential); }
  catch (e) { console.warn("google auth:", e.message); return res.status(401).json({ error: "הכניסה עם Google לא הצליחה, נסו שוב" }); }
  try {
    const email = normEmail(g.email);
    if (!email) return res.status(400).json({ error: "כתובת המייל לא תקינה" });
    const existing = (await pool.query("SELECT * FROM users WHERE email=$1", [email])).rows[0];
    if (existing) {
      const token = await createSession(existing.id);
      track("login", existing.id, { via: "google" });
      return res.json({ ok: true, user: privateUser(req, existing), token, isNew: false });
    }
    const ticket = randomBytes(24).toString("base64url");
    await pool.query(
      `INSERT INTO otps (email, tickethash, ticketexpires, ticketvia) VALUES ($1,$2,$3,'google')
       ON CONFLICT (email) DO UPDATE SET tickethash=$2, ticketexpires=$3, ticketvia='google'`,
      [email, sha256(ticket), Date.now() + 30 * 60 * 1000]);
    track("google_new", null, { eh: emailKey(email) });
    res.json({ ok: true, user: null, isNew: true, ticket, email, name: clip(g.name || "", 80) });
  } catch (e) { console.error("google login:", e.message); res.status(500).json({ error: "שגיאה בכניסה, נסו שוב" }); }
});

// הרשמה: רק אחרי אימות המייל (עם הכרטיס מ-verify-otp)
app.post("/api/users/register", limit("register", 40, 60 * 60 * 1000), async (req, res) => {
  const { name, phone, type, storeName, address, storeType, ticket, emailConsent } = req.body;
  const email = normEmail(req.body.email);
  const miss = [];
  if (!name?.trim()) miss.push("שם");
  if (!email) miss.push("אימייל");
  if (miss.length) return res.status(400).json({ error: `שדות חסרים: ${miss.join(", ")}`, missing: miss });
  const phoneDigits = String(phone || "").replace(/[^\d+]/g, "");
  if (phoneDigits && !/^(\+972|0)\d{8,9}$/.test(phoneDigits)) return res.status(400).json({ error: "מספר הטלפון לא תקין" });
  try {
    const row = (await pool.query("SELECT tickethash, ticketexpires, ticketvia FROM otps WHERE email=$1", [email])).rows[0];
    if (!ticket || !row?.tickethash || Date.now() > Number(row.ticketexpires) || !safeEqual(row.tickethash, sha256(ticket)))
      return res.status(401).json({ error: "צריך לאמת את המייל מחדש", code: "verify" });
    const ex = (await pool.query("SELECT * FROM users WHERE email=$1", [email])).rows[0];
    let user = ex;
    if (!ex) {
      let lat = null, lng = null;
      if (address?.trim()) { const geo = await geocode(address.trim()); if (geo) { lat = geo.lat; lng = geo.lng; } }
      const id = randomUUID();
      await pool.query(
        `INSERT INTO users (id,name,phone,email,type,storeName,address,storeType,lat,lng,plan,xp,chatCount,bookCount,createdAt,email_consent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'free',0,0,0,$11,$12)`,
        [id, clip(name.trim(), 80), phoneDigits || null, email, type === "store" ? "store" : "private",
         clip(storeName, 120), clip(address, 200), clip(storeType, 60), lat, lng, Date.now(), !!emailConsent]
      );
      user = (await pool.query("SELECT * FROM users WHERE id=$1", [id])).rows[0];
      track("register", id, { type: user.type, method: row.ticketvia || "email", phone: !!phoneDigits, src: clip(req.body.src, 40) || undefined });
    }
    await pool.query("UPDATE otps SET tickethash=NULL WHERE email=$1", [email]);
    const token = await createSession(user.id);
    res.json({ ok: true, user: privateUser(req, user), token, existing: !!ex });
  } catch (e) { console.error("register:", e.message); res.status(500).json({ error: "ההרשמה נכשלה, נסו שוב" }); }
});

// ── משתמשים ──────────────────────────────────────────────
app.get("/api/me", requireAuth, (req, res) => res.json({ ok: true, user: privateUser(req, req.user) }));

app.put("/api/me", requireAuth, async (req, res) => {
  const { name, phone, emailConsent } = req.body;
  try {
    let phoneDigits = req.user.phone || null;
    if (phone !== undefined) {
      phoneDigits = String(phone).replace(/[^\d+]/g, "") || null;
      if (phoneDigits && !/^(\+972|0)\d{8,9}$/.test(phoneDigits)) return res.status(400).json({ error: "מספר הטלפון לא תקין" });
      if (!phoneDigits && req.user.phone) {
        const n = Number((await pool.query("SELECT COUNT(*) n FROM books WHERE ownerid=$1 AND avail=true", [req.user.id])).rows[0].n);
        if (n > 0) return res.status(400).json({ error: "יש לך ספרים על המדף, ושכנים צריכים דרך לפנות אליך. אפשר להחליף את המספר, אבל לא למחוק אותו" });
      }
    }
    if (phoneDigits && !req.user.phone) track("phone_added", req.user.id, { at: ["publish", "profile"].includes(req.body.at) ? req.body.at : "settings" });
    const newName = name?.trim() ? clip(name.trim(), 80) : req.user.name;
    await pool.query("UPDATE users SET name=$1, phone=$2, email_consent=$3 WHERE id=$4",
      [newName, phoneDigits, emailConsent !== undefined ? !!emailConsent : req.user.email_consent, req.user.id]);
    if (newName !== req.user.name && !req.user.storename) await pool.query("UPDATE books SET ownername=$1 WHERE ownerid=$2", [newName, req.user.id]);
    if ((phoneDigits || "") !== (req.user.phone || "")) await pool.query("UPDATE books SET phone=$1 WHERE ownerid=$2", [phoneDigits || "", req.user.id]);
    const user = (await pool.query("SELECT * FROM users WHERE id=$1", [req.user.id])).rows[0];
    res.json({ ok: true, user: privateUser(req, user) });
  } catch (e) { console.error("update me:", e.message); res.status(500).json({ error: "העדכון נכשל" }); }
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM sessions WHERE tokenhash=$1", [req.tokenHash]).catch(() => {});
  res.json({ ok: true });
});

// מחיקת חשבון: המשתמש, הספרים, המשאלות, החיבורים, ונתוני הפעילות מאוחסנים בלי זיהוי
app.delete("/api/me", requireAuth, async (req, res) => {
  const id = req.user.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM books WHERE ownerid=$1", [id]);
    await client.query("DELETE FROM wishlist WHERE userid=$1", [id]);
    await client.query("DELETE FROM favorites WHERE userid=$1", [id]);
    await client.query("DELETE FROM contacts WHERE fromuserid=$1 OR touserid=$1", [id]);
    await client.query("DELETE FROM sessions WHERE userid=$1", [id]);
    await client.query("DELETE FROM otps WHERE email=$1", [req.user.email]);
    await client.query("UPDATE analytics SET userid=NULL WHERE userid=$1", [id]);
    await client.query("DELETE FROM users WHERE id=$1", [id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("delete account:", e.message);
    res.status(500).json({ error: "מחיקת החשבון נכשלה" });
  } finally { client.release(); }
});

app.get("/api/users/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id=$1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "לא נמצא" });
    const u = result.rows[0];
    res.json(req.user?.id === u.id ? privateUser(req, u) : publicUser(req, u));
  } catch { res.status(500).json({ error: "שגיאה" }); }
});

function selfOnly(req, res, next) {
  if (req.params.id !== req.user.id) return res.status(403).json({ error: "אין הרשאה" });
  next();
}

app.post("/api/users/:id/avatar", requireAuth, selfOnly, async (req, res) => {
  try {
    const parsed = dataUriToBuffer(req.body.avatar);
    if (!parsed) return res.status(400).json({ error: "תמונה לא תקינה" });
    const mod = await moderateImages([parsed.buf], { avatar: true });
    if (mod.status === "unsafe") { track("image_rejected", req.user.id, { reason: "avatar" }); return res.status(400).json({ error: "התמונה לא מתאימה לפרסום באתר. נסו תמונה אחרת", code: "image_unsafe" }); }
    const avatar = await shrinkImage(parsed.buf, 300, 300, 75);
    await pool.query("UPDATE users SET avatar=$1 WHERE id=$2", [avatar, req.user.id]);
    res.json({ ok: true, avatar: avatarUrl(req, { id: req.user.id, avatar }) });
  } catch (e) { console.error("avatar:", e.message); res.status(500).json({ error: "העלאת התמונה נכשלה" }); }
});

app.put("/api/users/:id/profile", requireAuth, selfOnly, async (req, res) => {
  try {
    const { bio, featuredBooks } = req.body;
    await pool.query("UPDATE users SET bio=$1, featuredBooks=$2 WHERE id=$3", [clip(bio, 150), JSON.stringify(Array.isArray(featuredBooks) ? featuredBooks.slice(0, 12) : []), req.user.id]);
    const user = (await pool.query("SELECT * FROM users WHERE id=$1", [req.user.id])).rows[0];
    res.json({ ok: true, user: privateUser(req, user) });
  } catch { res.status(500).json({ error: "העדכון נכשל" }); }
});

// ── ספרים שמורים (לב) ─────────────────────────────────────
app.get("/api/favorites", requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${BOOK_COLS} FROM favorites f JOIN books b ON b.id=f.bookid LEFT JOIN users u ON b.ownerid=u.id WHERE f.userid=$1 ORDER BY f.createdat DESC`,
      [req.user.id]
    );
    res.json(r.rows.map(b => publicBook(req, b, null)));
  } catch { res.status(500).json({ error: "שגיאה" }); }
});
app.put("/api/favorites/:bookId", requireAuth, async (req, res) => {
  try {
    const n = (await pool.query("SELECT COUNT(*) FROM favorites WHERE userid=$1", [req.user.id])).rows[0].count;
    if (+n >= 300) return res.status(400).json({ error: "אפשר לשמור עד 300 ספרים" });
    const b = await pool.query("SELECT 1 FROM books WHERE id=$1", [req.params.bookId]);
    if (!b.rows.length) return res.status(404).json({ error: "הספר לא נמצא" });
    await pool.query("INSERT INTO favorites (userid,bookid,createdat) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [req.user.id, req.params.bookId, Date.now()]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "שגיאה" }); }
});
app.delete("/api/favorites/:bookId", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM favorites WHERE userid=$1 AND bookid=$2", [req.user.id, req.params.bookId]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "שגיאה" }); }
});

// ── רשימת משאלות ─────────────────────────────────────────
app.post("/api/wishlist", requireAuth, async (req, res) => {
  try {
    const query = String(req.body.query || "").toLowerCase().trim();
    if (query.length < 2) return res.status(400).json({ error: "חסר שם ספר" });
    const count = (await pool.query("SELECT COUNT(*) FROM wishlist WHERE userid=$1", [req.user.id])).rows[0].count;
    if (+count >= 50) return res.status(400).json({ error: "אפשר לשמור עד 50 משאלות" });
    const dup = await pool.query("SELECT id FROM wishlist WHERE userid=$1 AND query=$2", [req.user.id, query]);
    if (!dup.rows.length) {
      await pool.query("INSERT INTO wishlist (id,userid,query,createdat,notified) VALUES ($1,$2,$3,$4,false)", [randomUUID(), req.user.id, clip(query, 200), Date.now()]);
      track("wishlist_add", req.user.id, { q: clip(query, 80) });
    }
    res.json({ ok: true });
  } catch (e) { console.error("wishlist:", e.message); res.status(500).json({ error: "שגיאה" }); }
});

app.get("/api/wishlist/matches/:userId", requireAuth, async (req, res) => {
  try {
    const wishes = (await pool.query("SELECT * FROM wishlist WHERE userid=$1", [req.user.id])).rows;
    const matches = [];
    for (const w of wishes) {
      const r = await pool.query(
        `SELECT ${BOOK_COLS} FROM books b LEFT JOIN users u ON b.ownerid=u.id WHERE b.avail=true AND b.ownerid<>$2 AND (LOWER(b.title) LIKE $1 OR LOWER(b.author) LIKE $1) ORDER BY b.createdat DESC LIMIT 3`,
        [`%${w.query}%`, req.user.id]
      );
      if (r.rows.length) matches.push({ wish: w, books: r.rows.map(b => publicBook(req, b, null)) });
    }
    res.json(matches);
  } catch { res.status(500).json({ error: "שגיאה" }); }
});

app.delete("/api/wishlist/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM wishlist WHERE id=$1 AND userid=$2", [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "שגיאה" }); }
});

// כשמתפרסם ספר — מייל למי שחיכה לו
async function notifyWishlist(bookId, title, author, ownerId) {
  const t = String(title || "").toLowerCase(), a = String(author || "").toLowerCase();
  if (!t) return;
  const r = await pool.query(
    `SELECT w.id, w.query, u.email, u.name FROM wishlist w JOIN users u ON u.id=w.userid
     WHERE w.notified=false AND w.userid<>$3 AND length(w.query)>=2 AND ($1 LIKE '%' || w.query || '%' OR ($2 <> '' AND $2 LIKE '%' || w.query || '%'))`,
    [t, a, ownerId]
  );
  for (const w of r.rows) {
    try {
      await sendEmail(w.email, `📚 "${title}" זמין עכשיו ב-Pageturner`, `<div dir="rtl" style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1E2D3D">היי ${escapeHtml(w.name || "")},</h2>
        <p>ביקשת שנעדכן אותך — הספר <b>${escapeHtml(title)}</b> פורסם עכשיו בספרייה השכונתית.</p>
        <p><a href="${PUBLIC_SITE}/?book=${bookId}" style="display:inline-block;background:#6B8F47;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700">לצפייה בספר</a></p>
        <p style="color:#999;font-size:12px">קיבלת את המייל כי ביקשת התראה על הספר הזה.</p>
      </div>`);
      await pool.query("UPDATE wishlist SET notified=true WHERE id=$1", [w.id]);
    } catch (e) { console.error("wish email:", e.message); }
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── צור קשר: נשלח למייל של המנהל ─────────────────────────
app.post("/api/feedback", limit("feedback", 5, 60 * 60 * 1000), async (req, res) => {
  const message = String(req.body.message || "").trim();
  const replyTo = normEmail(req.body.email || req.user?.email || "");
  if (message.length < 3) return res.status(400).json({ error: "כתבו כמה מילים" });
  if (!process.env.ADMIN_EMAIL) return res.status(503).json({ error: "לא ניתן לשלוח כרגע" });
  try {
    await sendEmail(process.env.ADMIN_EMAIL, `📮 פנייה מהאתר${req.user ? " — " + clip(req.user.name, 40) : ""}`, `<div dir="rtl" style="font-family:sans-serif">
      <p><b>מאת:</b> ${escapeHtml(req.user?.name || "אורח")} ${replyTo ? "&lt;" + escapeHtml(replyTo) + "&gt;" : ""}</p>
      <p style="white-space:pre-wrap;background:#f5f0e8;padding:12px;border-radius:8px">${escapeHtml(clip(message, 3000))}</p>
    </div>`);
    res.json({ ok: true });
  } catch (e) { console.error("feedback:", e.message); res.status(500).json({ error: "השליחה נכשלה, נסו שוב" }); }
});

// ── אנליטיקס ─────────────────────────────────────────────
const CLIENT_EVENTS = new Set(["search", "book_view", "page_load", "guest_login", "book_contact", "share", "visit", "signup_start", "signup_submit", "signup_invalid", "signup_back", "add_start", "pwa_install"]);
app.post("/api/analytics", limit("analytics", 120, 60 * 1000), async (req, res) => {
  const { event, data } = req.body;
  if (!CLIENT_EVENTS.has(event)) return res.status(400).json({ error: "event לא מוכר" });
  const safe = JSON.stringify(data || {}).length <= 1000 ? data : {};
  await track(event, req.user?.id || null, safe);
  res.json({ ok: true });
});

// ── אדמין ────────────────────────────────────────────────
function isAdmin(req) {
  const key = req.get("x-admin-key") || req.query.key || req.body?.key;
  return !!process.env.ADMIN_KEY && safeEqual(key, process.env.ADMIN_KEY);
}
app.get("/api/admin/stats", limit("admin", 20, 15 * 60 * 1000), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const now = Date.now(), week = DAY * 7, month = DAY * 30;
    const q = (sql, p) => pool.query(sql, p);
    const [users, books, contacts, todayUsers, weekUsers, monthUsers, todayBooks, weekBooks, monthBooks, todayLogins, cities, hourly] = await Promise.all([
      q("SELECT COUNT(*) FROM users"),
      q("SELECT COUNT(*) FROM books WHERE avail=true"),
      q("SELECT COUNT(*) FROM book_history"),
      q("SELECT COUNT(*) FROM users WHERE createdat>$1", [now - DAY]),
      q("SELECT COUNT(*) FROM users WHERE createdat>$1", [now - week]),
      q("SELECT COUNT(*) FROM users WHERE createdat>$1", [now - month]),
      q("SELECT COUNT(*) FROM books WHERE createdat>$1", [now - DAY]),
      q("SELECT COUNT(*) FROM books WHERE createdat>$1", [now - week]),
      q("SELECT COUNT(*) FROM books WHERE createdat>$1", [now - month]),
      q("SELECT COUNT(DISTINCT userid) FROM analytics WHERE event IN ('login','register','page_load') AND userid IS NOT NULL AND createdat>$1", [now - DAY]),
      q("SELECT city, COUNT(*) as cnt FROM books WHERE city IS NOT NULL AND city!='' GROUP BY city ORDER BY cnt DESC LIMIT 10"),
      q("SELECT EXTRACT(HOUR FROM to_timestamp(createdat/1000) AT TIME ZONE 'Asia/Jerusalem') as hour, COUNT(*) as cnt FROM analytics WHERE createdat>$1 GROUP BY hour ORDER BY hour", [now - week]),
    ]);
    res.json({
      totals: { users: +users.rows[0].count, books: +books.rows[0].count, deals: +contacts.rows[0].count },
      today: { users: +todayUsers.rows[0].count, books: +todayBooks.rows[0].count, logins: +todayLogins.rows[0].count },
      week: { users: +weekUsers.rows[0].count, books: +weekBooks.rows[0].count },
      month: { users: +monthUsers.rows[0].count, books: +monthBooks.rows[0].count },
      cities: cities.rows, hourly: hourly.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/send-report", limit("admin", 20, 15 * 60 * 1000), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  await sendReport(req.body.type || "daily");
  res.json({ ok: true });
});

// ── מדדים: חישוב לכל טווח זמן, צילום יומי ומגמות ─────────────────
const TZ = "Asia/Jerusalem";
async function dayBounds(day) { // day = 'YYYY-MM-DD' (שעון ישראל) → [תחילת היום, תחילת היום הבא] במילישניות
  const r = await pool.query(`SELECT (EXTRACT(EPOCH FROM ($1::date::timestamp AT TIME ZONE '${TZ}'))*1000)::bigint a,
    (EXTRACT(EPOCH FROM (($1::date + 1)::timestamp AT TIME ZONE '${TZ}'))*1000)::bigint b`, [day]);
  return [Number(r.rows[0].a), Number(r.rows[0].b)];
}
async function israelDay(offsetDays = 0) {
  const r = await pool.query(`SELECT to_char((now() AT TIME ZONE '${TZ}')::date + $1::int, 'YYYY-MM-DD') d`, [offsetDays]);
  return r.rows[0].d;
}
const STAT_FIELDS = [
  ["visitors", "מבקרים ייחודיים"], ["new_visitors", "מבקרים חדשים"], ["visits", "כניסות"], ["app_visits", "כניסות מהאפליקציה המותקנת"],
  ["signup_starts", "התחילו הרשמה"], ["signup_submits", "לחצו המשך בטופס"], ["signup_invalid", "נתקעו על שגיאה בטופס"], ["otp_sent", "קיבלו קוד הרשמה"],
  ["otp_ok", "אימתו קוד"], ["otp_bad", "הזינו קוד שגוי"], ["google_new", "התחילו עם Google"], ["signups", "נרשמו"], ["signups_no_phone", "נרשמו בלי טלפון"], ["phone_added", "הוסיפו טלפון אחר כך"], ["signups_google", "נרשמו עם Google"], ["active_users", "משתמשים פעילים"], ["guests", "כניסות כאורח"],
  ["books_new", "ספרים חדשים"], ["new_publishers", "מפרסמים חדשים"], ["book_views", "צפיות בספרים"], ["searches", "חיפושים"], ["zero_searches", "חיפושים בלי תוצאות"],
  ["contacts", "פניות למפרסמים"], ["deals", "עסקאות שנסגרו"], ["shares", "שיתופים"], ["wishlist_adds", "משאלות חדשות"], ["pwa_installs", "התקנות לטלפון"],
  ["scans", "סריקות כריכה"], ["image_rejected", "תמונות שנחסמו"], ["books_blocked", "ספרים אסורים שנחסמו"], ["reports", "דיווחים על מודעות"], ["hidden", "מודעות שהוסתרו"],
  ["emails", "מיילים שנשלחו"], ["users_total", "סה״כ משתמשים"], ["books_total", "סה״כ ספרים פעילים"],
];
async function computeStats(a, b) {
  const q = async (sql, p = []) => (await pool.query(sql, [a, b, ...p])).rows;
  const one = async (sql, p) => Number((await q(sql, p))[0]?.n || 0);
  const ev = e => one("SELECT COUNT(*) n FROM analytics WHERE event=$3 AND createdat>=$1 AND createdat<$2", [e]);
  const [visitors, newVisitors, visits, appVisits, signupStarts, signups, signupsGoogle, active, guests, booksNew, newPublishers, views, searches, zero,
    contacts, deals, shares, wish, installs, scans, imgRej, blocked, reports, hidden, emails, usersTotal, booksTotal] = await Promise.all([
    one("SELECT COUNT(DISTINCT data->>'vid') n FROM analytics WHERE event='visit' AND createdat>=$1 AND createdat<$2"),
    one("SELECT COUNT(DISTINCT data->>'vid') n FROM analytics WHERE event='visit' AND data->>'new'='true' AND createdat>=$1 AND createdat<$2"),
    ev("visit"),
    one("SELECT COUNT(*) n FROM analytics WHERE event='visit' AND data->>'app'='true' AND createdat>=$1 AND createdat<$2"),
    one("SELECT COUNT(DISTINCT COALESCE(data->>'vid', id)) n FROM analytics WHERE event='signup_start' AND createdat>=$1 AND createdat<$2"),
    one("SELECT COUNT(*) n FROM users WHERE createdat>=$1 AND createdat<$2"),
    one("SELECT COUNT(*) n FROM analytics WHERE event='register' AND data->>'method'='google' AND createdat>=$1 AND createdat<$2"),
    one("SELECT COUNT(DISTINCT userid) n FROM analytics WHERE userid IS NOT NULL AND createdat>=$1 AND createdat<$2"),
    ev("guest_login"),
    one("SELECT COUNT(*) n FROM books WHERE createdat>=$1 AND createdat<$2"),
    one("SELECT COUNT(*) n FROM (SELECT ownerid, MIN(createdat) m FROM books GROUP BY ownerid) x WHERE m>=$1 AND m<$2"),
    ev("book_view"), ev("search"),
    one("SELECT COUNT(*) n FROM analytics WHERE event='search' AND data->>'results'='0' AND createdat>=$1 AND createdat<$2"),
    ev("book_contact"), ev("book_deal"), ev("share"), ev("wishlist_add"), ev("pwa_install"), ev("vision"), ev("image_rejected"), ev("book_blocked"), ev("book_report"), ev("book_hidden"), ev("email_sent"),
    one("SELECT COUNT(*) n FROM users WHERE createdat<$2 AND $1::bigint IS NOT NULL"),
    one("SELECT COUNT(*) n FROM books WHERE createdat<$2 AND avail=true AND NOT COALESCE(hidden,false) AND $1::bigint IS NOT NULL"),
  ]);
  const dv = e => one(`SELECT COUNT(DISTINCT COALESCE(data->>'vid', id)) n FROM analytics WHERE event='${e}' AND createdat>=$1 AND createdat<$2`);
  const de = (e, extra = "") => one(`SELECT COUNT(DISTINCT COALESCE(data->>'eh', id)) n FROM analytics WHERE event='${e}' ${extra} AND createdat>=$1 AND createdat<$2`);
  const [signupSubmits, signupInvalid, otpSent, otpOk, otpBad, googleNew, noPhone, phoneAdded] = await Promise.all([
    dv("signup_submit"), dv("signup_invalid"), de("otp_sent", "AND data->>'ctx'='signup'"), de("otp_ok"), ev("otp_bad"), de("google_new"),
    one("SELECT COUNT(*) n FROM analytics WHERE event='register' AND data->>'phone'='false' AND createdat>=$1 AND createdat<$2"), ev("phone_added"),
  ]);
  const list = async (sql, p) => (await q(sql, p)).map(r => ({ k: r.k, n: Number(r.n) }));
  const [sources, topSearches, zeroSearches, topViewed, booksByMode, emailKinds, wishTop, invalidWhy, backSteps] = await Promise.all([
    list(`SELECT COALESCE(NULLIF(data->>'src',''), CASE WHEN COALESCE(data->>'ref','')<>'' THEN data->>'ref' ELSE 'ישיר / וואטסאפ' END) k, COUNT(DISTINCT data->>'vid') n
          FROM analytics WHERE event='visit' AND createdat>=$1 AND createdat<$2 GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    list("SELECT LOWER(TRIM(data->>'q')) k, COUNT(*) n FROM analytics WHERE event='search' AND COALESCE(data->>'q','')<>'' AND createdat>=$1 AND createdat<$2 GROUP BY 1 ORDER BY 2 DESC LIMIT 10"),
    list("SELECT LOWER(TRIM(data->>'q')) k, COUNT(*) n FROM analytics WHERE event='search' AND data->>'results'='0' AND createdat>=$1 AND createdat<$2 GROUP BY 1 ORDER BY 2 DESC LIMIT 10"),
    list("SELECT data->>'title' k, COUNT(*) n FROM analytics WHERE event='book_view' AND COALESCE(data->>'title','')<>'' AND createdat>=$1 AND createdat<$2 GROUP BY 1 ORDER BY 2 DESC LIMIT 5"),
    list("SELECT mode k, COUNT(*) n FROM books WHERE createdat>=$1 AND createdat<$2 GROUP BY 1 ORDER BY 2 DESC"),
    list("SELECT data->>'kind' k, COUNT(*) n FROM analytics WHERE event='email_sent' AND createdat>=$1 AND createdat<$2 GROUP BY 1 ORDER BY 2 DESC"),
    list("SELECT data->>'q' k, COUNT(*) n FROM analytics WHERE event='wishlist_add' AND createdat>=$1 AND createdat<$2 GROUP BY 1 ORDER BY 2 DESC LIMIT 5"),
    list("SELECT COALESCE(data->>'why','?') k, COUNT(*) n FROM analytics WHERE event='signup_invalid' AND createdat>=$1 AND createdat<$2 GROUP BY 1 ORDER BY 2 DESC"),
    list("SELECT COALESCE(data->>'step','?') k, COUNT(DISTINCT COALESCE(data->>'vid', id)) n FROM analytics WHERE event='signup_back' AND createdat>=$1 AND createdat<$2 GROUP BY 1 ORDER BY 2 DESC"),
  ]);
  return {
    visitors, new_visitors: newVisitors, visits, app_visits: appVisits, signup_starts: signupStarts, signups, signups_google: signupsGoogle, active_users: active, guests,
    signup_submits: signupSubmits, signup_invalid: signupInvalid, otp_sent: otpSent, otp_ok: otpOk, otp_bad: otpBad, google_new: googleNew, signups_no_phone: noPhone, phone_added: phoneAdded,
    books_new: booksNew, new_publishers: newPublishers, book_views: views, searches, zero_searches: zero, contacts, deals, shares, wishlist_adds: wish, pwa_installs: installs,
    scans, image_rejected: imgRej, books_blocked: blocked, reports, hidden, emails, users_total: usersTotal, books_total: booksTotal,
    lists: { sources, topSearches, zeroSearches, topViewed, booksByMode, emailKinds, wishTop, invalidWhy, backSteps },
  };
}
async function dayStats(day, { fresh = false } = {}) {
  const today = await israelDay(0);
  if (!fresh && day < today) {
    const r = await pool.query("SELECT data FROM daily_stats WHERE day=$1", [day]);
    if (r.rows[0]) return r.rows[0].data;
  }
  const [a, b] = await dayBounds(day);
  const st = await computeStats(a, Math.min(b, Date.now() + 1));
  if (day < today) await pool.query("INSERT INTO daily_stats (day,data,createdat) VALUES ($1,$2,$3) ON CONFLICT (day) DO UPDATE SET data=$2, createdat=$3", [day, st, Date.now()]);
  return st;
}
// צילום יומי של אתמול (ומילוי ימים חסרים)
async function snapshotDays(back = 45) {
  for (let i = back; i >= 1; i--) {
    const d = await israelDay(-i);
    const have = await pool.query("SELECT 1 FROM daily_stats WHERE day=$1", [d]);
    if (!have.rows.length) await dayStats(d).catch(e => console.error("snapshot", d, e.message));
  }
}
cron.schedule("5 0 * * *", async () => { try { await dayStats(await israelDay(-1), { fresh: true }); } catch (e) { console.error("daily snapshot:", e.message); } }, { timezone: TZ });
setTimeout(() => snapshotDays().catch(e => console.error("backfill:", e.message)), 20000);

async function trendRows(days) {
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = await israelDay(-i);
    const st = await dayStats(day);
    const { lists, ...nums } = st;
    rows.push({ day, ...nums });
  }
  return rows;
}
app.get("/api/admin/trends", limit("admin", 60, 15 * 60 * 1000), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
    const rows = await trendRows(days);
    const today = await dayStats(await israelDay(0), { fresh: true });
    const [a] = await dayBounds(await israelDay(-6));
    const week = await computeStats(a, Date.now() + 1);
    res.json({ rows, today, week, fields: STAT_FIELDS, emailDailyLimit: Number(process.env.EMAIL_DAILY_LIMIT || 100) });
  } catch (e) { console.error("trends:", e.message); res.status(500).json({ error: e.message }); }
});
app.get("/api/admin/trends.csv", limit("admin", 30, 15 * 60 * 1000), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).send("unauthorized");
  try {
    const rows = await trendRows(Math.min(365, Math.max(7, Number(req.query.days) || 90)));
    const head = ["תאריך", ...STAT_FIELDS.map(f => f[1])];
    const csv = "﻿" + [head, ...rows.map(r => [r.day, ...STAT_FIELDS.map(f => r[f[0]] ?? 0)])].map(l => l.map(x => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="pageturner-stats-${await israelDay(0)}.csv"`).send(csv);
  } catch (e) { console.error("csv:", e.message); res.status(500).send("error"); }
});

// ── דוחות במייל ──────────────────────────────────────────
async function sendReport(type) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  try {
    const html = await buildReport(type);
    const periodHe = type === "daily" ? "יומי" : type === "weekly" ? "שבועי" : "חודשי";
    await sendEmail(adminEmail, `📊 Pageturner — דוח ${periodHe} | ${html.label}`, html.body);
    console.log(`✅ דוח ${periodHe} נשלח`);
  } catch (e) { console.error("Report error:", e.message); }
}
// בונה את הדוח: יומי = אתמול (יום קלנדרי), שבועי = 7 ימים מלאים, חודשי = 30 ימים מלאים, עם השוואה לתקופה הקודמת
async function buildReport(type) {
  const days = type === "daily" ? 1 : type === "weekly" ? 7 : 30;
  const firstDay = await israelDay(-days), prevFirst = await israelDay(-2 * days), today = await israelDay(0);
  const [a] = await dayBounds(firstDay), [pa] = await dayBounds(prevFirst), [b] = await dayBounds(today);
  const cur = days === 1 ? await dayStats(firstDay, { fresh: true }) : await computeStats(a, b);
  const prev = days === 1 ? await dayStats(prevFirst) : await computeStats(pa, a);
  const trend = await trendRows(days === 1 ? 9 : days === 7 ? 14 : 30);
  const past = trend.filter(r => r.day < today);
  const avg7 = {};
  if (days === 1) { const w = past.slice(-8, -1); for (const [k] of STAT_FIELDS) avg7[k] = w.length ? w.reduce((x, r) => x + (r[k] || 0), 0) / w.length : 0; }
  const fmtDay = d => new Date(d + "T12:00:00Z").toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });
  const short = d => d.slice(8, 10) + "." + d.slice(5, 7);
  const label = days === 1 ? fmtDay(firstDay) : `${short(firstDay)}–${short(await israelDay(-1))}`;
  const prevName = days === 1 ? "מאתמול" : days === 7 ? "מהשבוע הקודם" : "מהחודש הקודם";
  const delta = (v, p) => {
    if (!p && !v) return `<span style="color:#9aa">—</span>`;
    if (!p) return `<span style="color:#15803D">חדש ▲</span>`;
    const d = Math.round((v - p) / p * 100);
    return d === 0 ? `<span style="color:#9aa">ללא שינוי</span>` : `<span style="color:${d > 0 ? "#15803D" : "#B91C1C"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}%</span>`;
  };
  const C = { ink: "#1E2D3D", muted: "#5A655E", line: "#E6E0D4", bg: "#F6F2EA", green: "#527236" };
  const card = (icon, title, k) => `<td style="width:50%;padding:6px;vertical-align:top"><div style="background:#fff;border:1px solid ${C.line};border-radius:14px;padding:14px">
      <div style="font-size:13px;color:${C.muted}">${icon} ${title}</div>
      <div style="font-size:30px;font-weight:800;color:${C.ink};margin:4px 0">${cur[k] ?? 0}</div>
      <div style="font-size:12px">${delta(cur[k] || 0, prev[k] || 0)} <span style="color:${C.muted}">${prevName}</span></div>
      ${days === 1 ? `<div style="font-size:12px;color:${C.muted}">ממוצע שבועי: ${(+avg7[k] || 0).toFixed(1)}</div>` : ""}</div></td>`;
  const h2 = t => `<h2 style="font-size:16px;color:${C.green};margin:26px 0 8px">${t}</h2>`;
  const tbl = (rows, cols) => `<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid ${C.line};border-radius:10px;font-size:14px">
      ${cols ? `<tr>${cols.map(c => `<th style="padding:8px;border-bottom:1px solid ${C.line};text-align:right;color:${C.muted};font-weight:600;font-size:12px">${c}</th>`).join("")}</tr>` : ""}
      ${rows.map((r, i) => `<tr style="${i % 2 ? `background:${C.bg}` : ""}">${r.map((c, j) => `<td style="padding:8px;border-bottom:1px solid ${C.line};${j ? "text-align:center;font-weight:700" : ""}">${c}</td>`).join("")}</tr>`).join("")}</table>`;
  const listTbl = (arr, empty, unit = "") => arr?.length ? tbl(arr.map(x => [escapeHtml(x.k || "—"), x.n + unit])) : `<p style="color:${C.muted};font-size:13px;margin:0">${empty}</p>`;
  const pct = (x, y) => y ? Math.round(x / y * 100) + "%" : "—";
  const L = cur.lists || {};
  const modeHe = { sell: "מכירה", lend: "השאלה", swap: "החלפה", give: "מסירה" };
  // משפט סיכום
  const summary = cur.visitors || cur.signups || cur.books_new
    ? `${cur.visitors} מבקרים, ${cur.signups} נרשמו, ${cur.books_new} ספרים חדשים ו-${cur.contacts} פניות למפרסמים.`
    : "תקופה שקטה: לא היו כניסות חדשות.";
  const safetyTotal = (cur.image_rejected || 0) + (cur.books_blocked || 0) + (cur.reports || 0) + (cur.hidden || 0);
  const emailLimit = Number(process.env.EMAIL_DAILY_LIMIT || 100);
  const maxDayEmails = Math.max(0, ...past.slice(-days).map(r => r.emails || 0));
  const body = `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:20px;background:${C.bg};color:${C.ink}">
  <div style="font-size:22px;font-weight:800">📚 Pageturner · דוח ${days === 1 ? "יומי" : days === 7 ? "שבועי" : "חודשי"}</div>
  <div style="color:${C.muted};font-size:14px;margin-top:2px">${label}</div>
  <div style="background:${C.ink};color:#fff;border-radius:14px;padding:14px 16px;margin:16px 0 6px;font-size:15px;line-height:1.6">${summary}</div>
  <table style="width:100%;border-collapse:collapse"><tr>${card("👀", "מבקרים ייחודיים", "visitors")}${card("✅", "נרשמו", "signups")}</tr>
    <tr>${card("📖", "ספרים חדשים", "books_new")}${card("📱", "פניות למפרסמים", "contacts")}</tr></table>

  ${h2("🔻 המשפך: מכניסה ועד פנייה")}
  ${(() => {
    const has = cur.signup_submits !== undefined;
    const sent = (cur.signup_submits || 0) + (cur.google_new || 0), verified = (cur.otp_ok || 0) + (cur.google_new || 0);
    const rows = [["מבקרים ייחודיים", cur.visitors, ""], ["פתחו את טופס ההרשמה", cur.signup_starts, pct(cur.signup_starts, cur.visitors)]];
    if (has) rows.push(["לחצו \"המשך\" או Google", sent, pct(sent, cur.signup_starts)], ["אימתו את המייל", verified, pct(verified, sent)]);
    rows.push(["נרשמו", `${cur.signups}${cur.signups_google ? ` (${cur.signups_google} עם Google)` : ""}`, pct(cur.signups, has ? verified : cur.signup_starts)],
      ["העלו ספר ראשון", cur.new_publishers, pct(cur.new_publishers, cur.signups)], ["פניות למפרסמים", cur.contacts, ""], ["עסקאות שנסגרו", cur.deals, ""]);
    return tbl(rows, ["שלב", "כמה", "המרה"]);
  })()}
  <p style="font-size:12px;color:${C.muted};margin:6px 0 0">המרה = מתוך השלב שמעליו.</p>
  ${(() => {
    const WHY = { name: "שם חסר", email: "מייל לא תקין", phone: "טלפון לא תקין" }, STEP = { form: "בטופס", otp: "במסך הקוד" };
    const bits = [];
    if (L.invalidWhy?.length) bits.push("נתקעו על שגיאה: " + L.invalidWhy.map(x => `${WHY[x.k] || x.k} ${x.n}`).join(", "));
    if (L.backSteps?.length) bits.push("לחצו חזרה: " + L.backSteps.map(x => `${STEP[x.k] || x.k} ${x.n}`).join(", "));
    if (cur.otp_bad) bits.push(`קוד שגוי: ${cur.otp_bad}`);
    if (cur.signups_no_phone || cur.phone_added) bits.push(`נרשמו בלי טלפון: ${cur.signups_no_phone || 0} · הוסיפו טלפון אחר כך: ${cur.phone_added || 0}`);
    return bits.length ? `<p style="font-size:13px;color:${C.ink};margin:8px 0 0;line-height:1.7">${bits.join("<br>")}</p>` : "";
  })()}

  ${h2("📣 מאיפה הגיעו")}
  ${listTbl(L.sources, "אין נתונים עדיין.", " מבקרים")}
  <p style="font-size:12px;color:${C.muted};margin:6px 0 0">טיפ: לכל קבוצה קישור משלה, למשל pageturner.co.il/?s=bima — ואז תראו כאן כמה הגיעו מכל קבוצה.</p>

  ${h2("🔍 מה מחפשים")}
  ${listTbl(L.topSearches, "לא היו חיפושים.")}
  ${h2("💡 מחפשים ולא מוצאים — הזדמנות")}
  ${listTbl(L.zeroSearches, "כל החיפושים מצאו תוצאות 👌")}
  ${L.wishTop?.length ? h2("⭐ משאלות חדשות") + listTbl(L.wishTop, "") : ""}

  ${h2("👁️ הספרים הנצפים ביותר")}
  ${listTbl(L.topViewed, "לא היו צפיות.", " צפיות")}
  ${h2("📚 ספרים חדשים לפי סוג")}
  ${L.booksByMode?.length ? tbl(L.booksByMode.map(x => [modeHe[x.k] || x.k, x.n])) : `<p style="color:${C.muted};font-size:13px;margin:0">לא נוספו ספרים.</p>`}

  ${h2("📈 מגמה")}
  ${tbl(past.slice(days === 1 ? -7 : -days).map(r => [short(r.day), r.visitors, r.signups, r.books_new, r.contacts]), ["יום", "מבקרים", "נרשמו", "ספרים", "פניות"])}

  ${h2("🧮 פעילות נוספת")}
  ${tbl([
    ["משתמשים פעילים", cur.active_users], ["צפיות בספרים", cur.book_views], ["חיפושים", `${cur.searches} (${cur.zero_searches} בלי תוצאות)`],
    ["שיתופים", cur.shares], ["כניסות כאורח", cur.guests], ["התקנות לטלפון", cur.pwa_installs], ["סריקות כריכה (AI)", cur.scans],
  ])}

  ${h2("🛡️ בטיחות")}
  ${safetyTotal ? tbl([["תמונות שנחסמו", cur.image_rejected], ["ספרים אסורים שנחסמו", cur.books_blocked], ["דיווחים על מודעות", cur.reports], ["מודעות שהוסתרו", cur.hidden]])
    : `<p style="font-size:14px;margin:0">הכל שקט ✓ לא היו חסימות או דיווחים.</p>`}

  ${h2("⚙️ מערכת")}
  ${tbl([
    ["מיילים שנשלחו", `${cur.emails}${(L.emailKinds || []).length ? ` (${L.emailKinds.map(x => `${({ otp: "קודים", backup: "גיבוי", report: "דוחות", wishlist: "משאלות", admin: "התראות" })[x.k] || x.k}: ${x.n}`).join(", ")})` : ""}`],
    ["שיא יומי מול המכסה של Resend", `${maxDayEmails} / ${emailLimit}${maxDayEmails >= emailLimit * 0.7 ? " ⚠️ מתקרבים למכסה" : ""}`],
  ])}

  ${h2("🗂️ סה״כ באתר")}
  ${tbl([["משתמשים", cur.users_total], ["ספרים פעילים", cur.books_total]])}

  <p style="margin-top:26px;font-size:13px"><a href="${siteUrl()}/?admin=1" style="color:${C.green}">לפאנל הניהול, עם גרפים וייצוא לאקסל ←</a></p>
  <p style="color:#9aa;font-size:11px;margin-top:20px;border-top:1px solid ${C.line};padding-top:10px">Pageturner — ספרייה שכונתית · דוח אוטומטי · הימים לפי שעון ישראל</p>
</div>`;
  return { label, body };
}
app.get("/api/admin/report-preview", limit("admin", 30, 15 * 60 * 1000), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).send("unauthorized");
  try { const r = await buildReport(["daily", "weekly", "monthly"].includes(req.query.type) ? req.query.type : "daily"); res.set("Content-Type", "text/html; charset=utf-8").send(r.body); }
  catch (e) { res.status(500).send(e.message); }
});

// ── גיבוי יומי במייל (Railway Hobby לא כולל גיבויים) ─────────
// קובץ JSON דחוס עם כל הטבלאות; שחזור: node scripts/restore-backup.mjs <file>
const BACKUP_TABLES = ["users", "books", "contacts", "book_history", "wishlist", "favorites", "covers", "analytics"];
async function makeBackup() {
  const data = { version: 1, createdAt: new Date().toISOString(), tables: {} };
  for (const t of BACKUP_TABLES) {
    try { data.tables[t] = (await pool.query(`SELECT * FROM ${t}`)).rows; } catch (e) { data.tables[t] = []; console.error("backup", t, e.message); }
  }
  return data;
}
async function sendBackup() {
  const to = process.env.BACKUP_EMAIL || "pageturner.team@gmail.com";
  try {
    const data = await makeBackup();
    let gz = gzipSync(Buffer.from(JSON.stringify(data)));
    let note = "גיבוי מלא, כולל תמונות.";
    // Resend מגביל קבצים מצורפים ל-40MB; אם גדול מדי — בלי התמונות (הן הכבדות)
    if (gz.length > 30 * 1024 * 1024) {
      for (const b of data.tables.books) { if (b.frontimg?.startsWith("data:")) b.frontimg = null; if (b.thumbnail?.startsWith("data:")) b.thumbnail = null; }
      data.tables.covers = [];
      data.imagesOmitted = true;
      gz = gzipSync(Buffer.from(JSON.stringify(data)));
      note = "גיבוי ללא תמונות (המסד גדל מעבר למגבלת הקובץ המצורף — הגיע הזמן לגיבוי בתשלום או לאחסון קבצים).";
    }
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
    const counts = Object.entries(data.tables).map(([t, r]) => `${t}: ${r.length}`).join(" · ");
    if (process.env.BACKUP_DIR) { const fs = await import("fs"); fs.writeFileSync(`${process.env.BACKUP_DIR}/pageturner-backup-${date}.json.gz`, gz); }
    await sendEmail(to, `🗄️ גיבוי Pageturner ${date}`, `<div dir="rtl" style="font-family:sans-serif">
      <p>${note}</p><p style="color:#666;font-size:13px">${counts}</p>
      <p style="color:#999;font-size:12px">גודל: ${(gz.length / 1024).toFixed(0)}KB. הקובץ מכיל פרטים אישיים של משתמשים — אין להעביר אותו הלאה.</p></div>`,
      [{ filename: `pageturner-backup-${date}.json.gz`, content: gz.toString("base64") }]);
    console.log(`🗄️ backup sent (${(gz.length / 1024).toFixed(0)}KB)`);
    return { ok: true, size: gz.length, counts };
  } catch (e) { console.error("backup failed:", e.message); return { ok: false, error: e.message }; }
}
cron.schedule("15 4 * * *", () => sendBackup(), { timezone: "Asia/Jerusalem" });
app.post("/api/admin/backup", limit("admin", 20, 15 * 60 * 1000), async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: "unauthorized" });
  res.json(await sendBackup());
});

cron.schedule("0 8 * * *", () => sendReport("daily"), { timezone: "Asia/Jerusalem" });
cron.schedule("0 9 * * 0", () => sendReport("weekly"), { timezone: "Asia/Jerusalem" });
cron.schedule("0 10 1 * *", () => sendReport("monthly"), { timezone: "Asia/Jerusalem" });
// ניקוי: חיבורים שפגו וקודים ישנים
cron.schedule("30 3 * * *", async () => {
  try {
    await pool.query("DELETE FROM sessions WHERE createdat < $1", [Date.now() - SESSION_DAYS * DAY]);
    await pool.query("DELETE FROM otps WHERE windowstart < $1", [Date.now() - DAY]);
  } catch (e) { console.error("cleanup:", e.message); }
}, { timezone: "Asia/Jerusalem" });

// ── הקטנת תמונות ישנות (פעם אחת, ברקע) ──────────────────────
async function shrinkOldImages() {
  let done = 0;
  const seen = [];
  try {
    for (;;) {
      const r = await pool.query(
        `SELECT id FROM books WHERE ((frontimg LIKE 'data:%' AND length(frontimg) > 400000) OR (thumbnail LIKE 'data:%' AND length(thumbnail) > 250000))
         AND NOT (id = ANY($1::text[])) LIMIT 5`, [seen]
      );
      if (!r.rows.length) break;
      for (const { id } of r.rows) {
        seen.push(id);
        const b = (await pool.query("SELECT frontimg, thumbnail FROM books WHERE id=$1", [id])).rows[0];
        let front = b.frontimg, thumb = b.thumbnail;
        try {
          if (front?.startsWith("data:") && front.length > 400000) front = await shrinkImage(dataUriToBuffer(front).buf, 1000, 1400, 82);
          if (thumb?.startsWith("data:") && thumb.length > 250000) thumb = await shrinkImage(dataUriToBuffer(thumb).buf, 600, 900, 80);
        } catch (e) {
          console.error("shrink", id, e.message);
          if (front?.length > 400000) front = null;
          if (thumb?.startsWith("data:") && thumb.length > 250000) thumb = null;
        }
        await pool.query("UPDATE books SET frontimg=$1, thumbnail=$2 WHERE id=$3", [front, thumb, id]);
        done++;
      }
    }
    if (done) console.log(`🖼️ ${done} תמונות ישנות הוקטנו`);
  } catch (e) { console.error("shrinkOldImages:", e.message); }
}

// ── שגיאות: תמיד JSON בעברית ─────────────────────────────
app.use("/api", (req, res) => res.status(404).json({ error: "לא נמצא" }));
app.use((err, req, res, next) => {
  console.error("Request error:", err.code || "", err.message);
  const tooBig = err.code === "LIMIT_FILE_SIZE" || err.code === "LIMIT_FIELD_VALUE" || err.type === "entity.too.large";
  if (res.headersSent) return next(err);
  res.status(tooBig ? 413 : 500).json({ error: tooBig ? "התמונה גדולה מדי" : "שגיאת שרת, נסו שוב" });
});

initDB()
  .then(() => setTimeout(shrinkOldImages, 5000))
  .catch(e => console.error("DB init error:", e.message));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n📚 ספרייה שכונתית v5 — port ${PORT}`);
  console.log(`   Anthropic:    ${process.env.ANTHROPIC_API_KEY ? "✓" : "✗ חסר!"}`);
  console.log(`   Database:     ${process.env.DATABASE_URL ? "✓ PostgreSQL" : "✗ חסר!"}`);
});
