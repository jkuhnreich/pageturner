// frontend/src/App.jsx
import { useState, useRef, useEffect, useCallback, useMemo, useId } from "react";
import { useNavigate } from "react-router-dom";

const BASE = import.meta.env.VITE_API_URL ||
  (typeof location !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "" : "https://pageturner-production-5baf.up.railway.app");

// ── חיבור: הטוקן נשמר בדפדפן ונשלח בכל בקשה ─────────────────
const session = {
  token() { try { return localStorage.getItem("pt_token") || ""; } catch { return ""; } },
  save(user, token) {
    try {
      if (token) localStorage.setItem("pt_token", token);
      localStorage.setItem("pt_user", JSON.stringify(user));
      localStorage.setItem("pt_screen", "app");
    } catch {}
  },
  saveUser(user) { try { localStorage.setItem("pt_user", JSON.stringify(user)); } catch {} },
  clear() { try { ["pt_token", "pt_user", "pt_screen"].forEach(k => localStorage.removeItem(k)); } catch {} },
};

// קורא תשובה כ-JSON גם כשהשרת מחזיר HTML, בלי להציג למשתמש שגיאה טכנית
async function safeJson(r) {
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { return { error: r.status === 413 ? "התמונה גדולה מדי" : "השרת לא זמין כרגע, נסו שוב בעוד רגע" }; }
}

async function request(method, path, body, isForm) {
  const headers = {};
  const t = session.token();
  if (t) headers.Authorization = "Bearer " + t;
  let payload;
  if (isForm) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let r;
  try { r = await fetch(BASE + path, { method, headers, body: payload }); }
  catch { throw Object.assign(new Error("אין חיבור לאינטרנט או שהשרת לא זמין"), { code: "network" }); }
  const data = await safeJson(r);
  if (r.status === 401 && data?.code === "auth") document.dispatchEvent(new CustomEvent("pt-auth-expired"));
  if (!r.ok) throw Object.assign(new Error(data?.error || "משהו השתבש, נסו שוב"), { code: data?.code, status: r.status });
  return data;
}

const api = {
  get: path => request("GET", path),
  post: (path, body) => request("POST", path, body ?? {}),
  put: (path, body) => request("PUT", path, body ?? {}),
  del: path => request("DELETE", path),
  upload: (path, formData) => request("POST", path, formData, true),
  // אירועי שימוש — לא חוסמים ולא מציגים שגיאות
  track: (event, data) => { request("POST", "/api/analytics", { event, data: data || {} }).catch(() => {}); },
};

// מקטין תמונה בטלפון לפני העלאה: מהיר יותר בגלישה סלולרית
function compressImage(file, max = 1600, quality = 0.85) {
  return new Promise(resolve => {
    if (!file || !/^image\//.test(file.type) || file.type === "image/gif") return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = Math.min(max / img.width, max / img.height, 1);
      if (ratio === 1 && file.size < 1.5 * 1024 * 1024) return resolve(file);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => resolve(b ? new File([b], "photo.jpg", { type: "image/jpeg" }) : file), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ── עיצוב בסיסי ────────────────────────────────────────────
const C = {
  bg: "#F6F2EA", white: "#fff", ink: "#1E2D3D", muted: "#5A655E", faint: "#A7AEA6",
  border: "#E6E0D4", accent: "#527236", gold: "#B7791F", paper: "#FBF8F2",
  teal: "#527236", tealL: "#EEF3E8", indigo: "#1E2D3D", indigoL: "#E9EDF2",
  green: "#527236", greenL: "#EEF3E8", red: "#C2412D", redL: "#FBEDEA",
};
const HDR = "#1E2D3D";
// פונט הכותרות: כתב יד מודרני וקריא
const HEAD = "'Playpen Sans Hebrew','Rubik',sans-serif";
// פלטת כריכות — גוונים עמוקים שמתאימים למותג
const SPINES = ["#2F4858","#6B8F47","#B5653A","#8C3B4A","#3D6A8C","#C9A14A","#5B4B8A","#2E7D6B"];
// כל סוג עסקה בצבע מלא ושונה, כדי שהעין תסנן מהר (ניגודיות AA עם טקסט לבן)
const MODES = {
  sell:  { label:"מכירה",  icon:"tag",  bg:"#FDE6C8", fg:"#9A4A0B", solid:"#B45309" },
  lend:  { label:"השאלה",  icon:"loop", bg:"#DCE6FC", fg:"#1D4ED8", solid:"#1D4ED8" },
  swap:  { label:"החלפה",  icon:"swap", bg:"#ECE2FE", fg:"#6D28D9", solid:"#7C3AED" },
  give:  { label:"מסירה",  icon:"gift", bg:"#D8F0E0", fg:"#166534", solid:"#15803D" },
};
const GENRES = [
  ["ספרות ורומנים","novel","#E9E2F5"], ["מתח","mask","#E3E8EF"], ["מדע בדיוני ופנטזיה","rocket","#E2EEF4"],
  ["אהבה ורומנטיקה","heart","#F7E4E6"], ["היסטוריה","column","#F2EADB"], ["ביוגרפיה","quill","#EDE6DD"],
  ["מדע ופילוסופיה","atom","#E3EFEA"], ["פיתוח אישי","sprout","#EAF2DF"], ["עסקים וכלכלה","chart","#E6ECF4"],
  ["ילדים ונוער","kite","#FBEBD8"], ["בישול ואפייה","pot","#F6E6DA"], ["שירה","feather","#ECE7F3"],
  ["יהדות ורוחניות","candle","#F5EFD9"], ["אחר","dots","#ECEAE4"],
];
const hashColor = id => { let h = 0; for (const ch of String(id||"")) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return SPINES[h % SPINES.length]; };

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:${"#F6F2EA"};font-family:'Rubik',system-ui,sans-serif;direction:rtl;color:#1E2D3D}
input,textarea,button,select{font-family:'Rubik',system-ui,sans-serif}
input::placeholder,textarea::placeholder{color:#767670}
input[type=search]::-webkit-search-cancel-button{-webkit-appearance:none;display:none}
::-webkit-scrollbar{width:3px;height:0}::-webkit-scrollbar-thumb{background:#ccc;border-radius:3px}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes spineRise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes toastIn{from{opacity:0;transform:translate(-50%,12px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
@keyframes shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
@keyframes pop{0%{transform:scale(1)}40%{transform:scale(1.35)}100%{transform:scale(1)}}
button:focus-visible,a:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:3px solid #2F5A8C;outline-offset:2px}
.sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skip{position:fixed;top:-60px;right:12px;z-index:10000;background:#1E2D3D;color:#fff;padding:10px 16px;border-radius:10px;font-weight:700;text-decoration:none}
.skip:focus{top:12px}
img{max-width:100%}
.press{transition:transform .16s cubic-bezier(.3,.7,.4,1)}
.press:active{transform:scale(.965)}
.rail{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x proximity;padding:2px 16px 8px;margin:0 -16px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.rail::-webkit-scrollbar{display:none}
.rail>*{scroll-snap-align:start;flex-shrink:0}
.clamp1{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.clamp4{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.skel{background:linear-gradient(90deg,#ECE6DA 25%,#F5F0E7 37%,#ECE6DA 63%);background-size:400% 100%;animation:shimmer 1.3s ease infinite}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 12px}
@media (min-width:560px){.grid2{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (min-width:900px){.grid2{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;

// ── אייקונים: סט אחיד, קו 1.8, פינות מעוגלות ────────────────
const ICONS = {
  home: <><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/></>,
  search: <><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  camera: <><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/></>,
  scan: <><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8 9h8M8 12h8M8 15h5"/></>,
  pencil: <><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></>,
  user: <><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.8 3.9-6 7.5-6s6.7 2.2 7.5 6"/></>,
  shelf: <><path d="M5 4v14M9 6v12M13.5 5l3.5 13"/><path d="M3 20h18"/></>,
  heart: <><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></>,
  share: <><path d="M12 4v11M8 8l4-4 4 4"/><path d="M6 12v6.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V12"/></>,
  pin: <><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></>,
  phone: <><path d="M6.5 4h3l1.5 4-2 1.3a10 10 0 0 0 5.7 5.7L16 13l4 1.5v3A2 2 0 0 1 17.8 20 15.5 15.5 0 0 1 4 6.2 2 2 0 0 1 6.5 4z"/></>,
  close: <><path d="M6 6l12 12M18 6 6 18"/></>,
  back: <><path d="M9 6l6 6-6 6"/></>,
  forward: <><path d="M15 6l-6 6 6 6"/></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h10"/></>,
  tag: <><path d="M3.5 12.2V5a1.5 1.5 0 0 1 1.5-1.5h7.2L20.5 12 12 20.5z"/><circle cx="8" cy="8" r="1.4"/></>,
  loop: <><path d="M5 11a7 7 0 0 1 12-4.9L19 8"/><path d="M19 4v4h-4"/><path d="M19 13a7 7 0 0 1-12 4.9L5 16"/><path d="M5 20v-4h4"/></>,
  swap: <><path d="M7 4 4 7l3 3"/><path d="M4 7h12a4 4 0 0 1 4 4"/><path d="m17 20 3-3-3-3"/><path d="M20 17H8a4 4 0 0 1-4-4"/></>,
  gift: <><rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11"/><path d="M12 9S10.5 4.5 8 5s-1.5 4 4 4zM12 9s1.5-4.5 4-4 1.5 4-4 4z"/></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z"/></>,
  trash: <><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></>,
  doc: <><path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z"/><path d="M14 3.5V8h4M9 12h6M9 15.5h6"/></>,
  flag: <><path d="M5.5 21V4.5"/><path d="M5.5 4.5h11l-2 4 2 4h-11"/></>,
  access: <><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="7.6" r="1.1"/><path d="M8 10.3l4 .8 4-.8M12 11.1v3.1l-2.2 3.4M12 14.2l2.2 3.4"/></>,
  info: <><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></>,
  logout: <><path d="M14 4h4a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20h-4"/><path d="M10 8l-4 4 4 4M6 12h9"/></>,
  sparkle: <><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.9L12 18.5l-1.8-5.8L4.5 10.8 10.2 9z"/></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5"/></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="m4 18 5-5 4 4 2.5-2.5L20 19"/></>,
  filter: <><path d="M4 6h16M7 12h10M10 18h4"/></>,
  // סוגות
  novel: <><path d="M4 5.5C6.5 4.5 9.5 4.6 12 6c2.5-1.4 5.5-1.5 8-.5v13c-2.5-1-5.5-.9-8 .5-2.5-1.4-5.5-1.5-8-.5z"/><path d="M12 6v13"/></>,
  mask: <><path d="M3.5 7.5c5-2 12-2 17 0 0 6-3.3 9.5-8.5 9.5s-8.5-3.5-8.5-9.5z"/><path d="M7.5 11c.8-.8 2-.8 2.8 0M13.7 11c.8-.8 2-.8 2.8 0"/></>,
  rocket: <><path d="M12 3c3.5 2.5 5 6 4.5 10.5L14 16h-4l-2.5-2.5C7 9 8.5 5.5 12 3z"/><circle cx="12" cy="9.5" r="1.8"/><path d="M10 16l-1 4 3-2 3 2-1-4"/></>,
  column: <><path d="M4 8 12 4l8 4M5 8h14M6.5 8v9M10 8v9M14 8v9M17.5 8v9M4 20h16M5 17h14"/></>,
  quill: <><path d="M19.5 4.5C12 5 7 10 5.5 18.5"/><path d="M19.5 4.5c-.5 6-4.5 10-10 10.5"/><path d="M4 20l2-2"/></>,
  atom: <><circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="8.5" ry="3.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="8.5" ry="3.5" transform="rotate(120 12 12)"/></>,
  sprout: <><path d="M12 20v-8"/><path d="M12 12C12 8 9 6 5 6c0 4 3 6 7 6zM12 14c0-3.5 2.5-5.5 7-5.5 0 3.5-2.5 5.5-7 5.5z"/></>,
  chart: <><path d="M4 20h16"/><path d="M7 16v-4M11.5 16V8M16 16v-6"/><path d="m6 9 4.5-4 3 2.5L19 4"/></>,
  kite: <><path d="M12 3 18 9l-6 9-6-9z"/><path d="M6 9h12M12 3v15"/><path d="M12 18c-1 1.5 1 2 0 3.5"/></>,
  pot: <><path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M2.5 10h19M9 6.5c0-1 1-1.5 1-2.5M13.5 6.5c0-1 1-1.5 1-2.5"/></>,
  feather: <><path d="M20 4c-8 0-13 5-13 12v4"/><path d="M7 16c5.5 0 10-3 12-9"/><path d="M10 12.5h5"/></>,
  candle: <><rect x="8.5" y="10" width="7" height="10" rx="1"/><path d="M12 10V8"/><path d="M12 3.5c1.5 1.5 1.5 3 0 4-1.5-1-1.5-2.5 0-4z"/></>,
  dots: <><circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/></>,
};
function Icon({ name, size = 22, color = "currentColor", stroke = 1.8, fill = "none", style, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink:0,display:"block",...style}} {...rest}>
      {ICONS[name] || ICONS.dots}
    </svg>
  );
}
const WhatsAppGlyph = ({ size = 20, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.28-.2-.57-.35zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z"/></svg>
);

// כריכה: תמונה אמיתית, או כריכה מעוצבת עם שם הספר
function Cover({ book, radius = 12, titleSize = 15, eager }) {
  const [failed, setFailed] = useState(false);
  const src = book.thumbnail || book.frontimg;
  const color = hashColor(book.id);
  if (src && !failed) return (
    <img src={src} alt={book.title} loading={eager?"eager":"lazy"} decoding="async" onError={()=>setFailed(true)}
      style={{width:"100%",height:"100%",objectFit:"cover",display:"block",borderRadius:radius,background:"#E7E1D5"}}/>
  );
  return (
    <div style={{width:"100%",height:"100%",borderRadius:radius,background:`linear-gradient(160deg, ${color} 0%, ${color} 45%, #1E2D3D 150%)`,position:"relative",overflow:"hidden",display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",textAlign:"center",padding:"22% 12% 14%",color:"#fff"}}>
      <div style={{position:"absolute",top:0,bottom:0,right:"6%",width:2,background:"rgba(255,255,255,.16)"}}/>
      <div style={{position:"absolute",width:"90%",aspectRatio:"1",borderRadius:"50%",background:"rgba(255,255,255,.07)",top:"-18%",left:"-30%"}}/>
      <div style={{width:"28%",height:2,background:"rgba(255,255,255,.55)",marginBottom:"10%"}}/>
      <div className="clamp4" style={{fontFamily:"'Frank Ruhl Libre',serif",fontWeight:900,fontSize:titleSize,lineHeight:1.15,textShadow:"0 1px 2px rgba(0,0,0,.2)",position:"relative"}}>{book.title}</div>
      <div className="clamp2" style={{fontSize:Math.max(9,titleSize*.62),opacity:.82,lineHeight:1.3,marginTop:"9%",position:"relative"}}>{book.author}</div>
    </div>
  );
}

function ModeBadge({ mode, small }) {
  const m = MODES[mode] || MODES.sell;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:small?"3px 8px 3px 9px":"5px 11px 5px 12px",borderRadius:99,background:m.solid,color:"#fff",fontSize:small?11:12,fontWeight:700,whiteSpace:"nowrap",boxShadow:"0 0 0 1.5px rgba(255,255,255,.92), 0 2px 6px rgba(0,0,0,.18)"}}>
      <Icon name={m.icon} size={small?12:14} stroke={2.1}/>{m.label}
    </span>
  );
}

function HeartButton({ active, onToggle, size = 34, floating, label }) {
  const [anim, setAnim] = useState(false);
  return (
    <button aria-label={(active?"הסרה מהשמורים":"שמירה")+(label?`: ${label}`:"")} aria-pressed={!!active}
      onClick={e=>{e.stopPropagation(); setAnim(true); setTimeout(()=>setAnim(false),350); onToggle && onToggle();}}
      style={{width:size,height:size,borderRadius:"50%",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
        background:floating?"rgba(255,255,255,.92)":C.bg,boxShadow:floating?"0 2px 8px rgba(0,0,0,.15)":"none",backdropFilter:"blur(6px)"}}>
      <Icon name="heart" size={size*.55} stroke={2} color={active?"#D9465A":C.ink} fill={active?"#D9465A":"none"} style={{animation:anim?"pop .35s ease":"none"}}/>
    </button>
  );
}

function priceLine(book) {
  if (book.mode === "sell") return book.price ? `₪${book.price}` : "מחיר בתיאום";
  if (book.mode === "give") return "חינם";
  if (book.mode === "lend") return "להשאלה";
  return "להחלפה";
}

// אריח ספר — היחידה הבסיסית של הדפדוף
function BookTile({ book, onOpen, fav, onFav, width, user, showOwner = true }) {
  const own = user?.id && String(book.ownerid) === String(user.id);
  return (
    <div style={{position:"relative",width:width||"auto",animation:"fadeUp .3s ease both"}}>
    <div className="press" role="button" tabIndex={0} onClick={()=>onOpen(book)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onOpen(book);}}}
      aria-label={[book.title, book.author, (MODES[book.mode]||MODES.sell).label, priceLine(book), book.avail===false?"לא זמין כרגע":""].filter(Boolean).join(", ")}
      style={{cursor:"pointer"}}>
      <div style={{position:"relative",aspectRatio:"2/3",borderRadius:14,boxShadow:"0 6px 16px rgba(30,45,61,.13), 0 1px 2px rgba(30,45,61,.08)",background:"#E7E1D5",opacity:book.avail===false?.55:1,filter:book.avail===false?"grayscale(.7)":"none"}}>
        <Cover book={book} radius={14} titleSize={width?13:15}/>
        <div style={{position:"absolute",top:8,right:8}}><ModeBadge mode={book.mode} small/></div>
      </div>
      <div style={{padding:"9px 2px 0"}}>
        <div className="clamp2" style={{fontSize:14,fontWeight:700,lineHeight:1.3,color:C.ink}}>{book.title}</div>
        <div className="clamp1" style={{fontSize:12.5,color:C.muted,marginTop:2}}>{book.author||" "}</div>
        <div style={{display:"flex",alignItems:"center",gap:6,marginTop:5,fontSize:12,color:C.muted}}>
          <span style={{fontWeight:800,color:book.mode==="sell"?C.ink:(MODES[book.mode]||MODES.sell).fg}}>{priceLine(book)}</span>
          {book.km!=null && !isNaN(book.km) && <><span style={{opacity:.4}}>•</span><span className="clamp1">{own?"שלך":book.km<=0.5?"עד 1 ק\"מ":`${book.km} ק"מ`}</span></>}
          {book.km==null && showOwner && book.city && <><span style={{opacity:.4}}>•</span><span className="clamp1">{book.city}</span></>}
        </div>
      </div>
    </div>
    {onFav && !own && <div style={{position:"absolute",top:6,left:6}}><HeartButton active={fav} onToggle={()=>onFav(book)} size={32} floating label={book.title}/></div>}
    </div>
  );
}

function TileSkeleton({ width }) {
  return (
    <div style={{width:width||"auto"}}>
      <div className="skel" style={{aspectRatio:"2/3",borderRadius:14}}/>
      <div className="skel" style={{height:13,borderRadius:6,marginTop:10,width:"85%"}}/>
      <div className="skel" style={{height:11,borderRadius:6,marginTop:7,width:"55%"}}/>
    </div>
  );
}

function SectionHead({ title, sub, action, onAction }) {
  return (
    <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",margin:"26px 0 12px"}}>
      <div>
        <h2 style={{fontFamily:HEAD,fontSize:22,fontWeight:700,color:C.ink,lineHeight:1.1}}>{title}</h2>
        {sub && <div style={{fontSize:12.5,color:C.muted,marginTop:4}}>{sub}</div>}
      </div>
      {action && <button onClick={onAction} style={{display:"flex",alignItems:"center",gap:2,background:"none",border:"none",color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer",padding:"4px 0"}}>{action}<Icon name="forward" size={16} stroke={2.2}/></button>}
    </div>
  );
}

function Rail({ books, onOpen, favs, onFav, user, w = 128 }) {
  return (
    <div className="rail">
      {books.map(b => <BookTile key={b.id} book={b} onOpen={onOpen} fav={favs?.has(b.id)} onFav={onFav} width={w} user={user}/>)}
    </div>
  );
}

function Spinner({ size="small" }) {
  const isLarge = size === "large";
  const scale = isLarge ? 80 : 24;
  return (
    <>
      <style>{`@keyframes spinnerPageFlip{0%{transform:rotateY(0deg);opacity:1}55%{transform:rotateY(-150deg);opacity:1}100%{transform:rotateY(-180deg);opacity:0}}`}</style>
      <span aria-label="Loading" role="status" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:`${scale}px`,height:`${scale*.75}px`,perspective:`${scale*6}px`,verticalAlign:"middle"}}>
        <span style={{position:"relative",width:`${scale}px`,height:`${scale*.65}px`,transformStyle:"preserve-3d"}}>
          <span style={{position:"absolute",left:0,top:0,width:"50%",height:"100%",background:"#1E2D3D",borderRadius:`${scale*.08}px 0 0 ${scale*.08}px`,transform:"rotateY(18deg)",transformOrigin:"right center"}}/>
          <span style={{position:"absolute",right:0,top:0,width:"50%",height:"100%",background:"#6B8F47",borderRadius:`0 ${scale*.08}px ${scale*.08}px 0`,transform:"rotateY(-18deg)",transformOrigin:"left center"}}/>
          {[0,1,2].map(i=>(
            <span key={i} style={{position:"absolute",right:`${scale*.06}px`,top:`${scale*.06}px`,width:`${scale*.42}px`,height:`${scale*.53}px`,background:"#f5f0e8",borderRadius:`${scale*.04}px`,transformOrigin:"left center",animation:"spinnerPageFlip 1.4s ease-in-out infinite",animationDelay:`${i*.22}s`,boxShadow:isLarge?"0 2px 6px rgba(0,0,0,.18)":"0 1px 2px rgba(0,0,0,.18)"}}/>
          ))}
          <span style={{position:"absolute",left:"50%",top:"5%",width:`${Math.max(1,scale*.025)}px`,height:"90%",background:"rgba(0,0,0,.18)",transform:"translateX(-50%)",borderRadius:"999px"}}/>
        </span>
      </span>
    </>
  );
}

function Toast({ t }) {
  if (!t) return null;
  const bg = { ok: C.teal, warn: "#8A5A12", err: C.red }[t.type] || C.teal;
  return (
    <div role="status" aria-live="polite" style={{position:"fixed",bottom:90,left:"50%",transform:"translateX(-50%)",background:bg,color:"#fff",padding:"10px 20px",borderRadius:16,fontSize:13,fontWeight:700,zIndex:9999,maxWidth:"calc(100vw - 32px)",textAlign:"center",lineHeight:1.5,boxShadow:"0 4px 20px rgba(0,0,0,.25)",animation:"toastIn .28s cubic-bezier(.34,1.56,.64,1)"}}>
      {t.msg}
    </div>
  );
}

function Inp({ label, required: req, icon, ...rest }) {
  const [f, setF] = useState(false);
  const autoId = useId();
  const id = rest.id || autoId;
  return (
    <div style={{marginBottom:13}}>
      {label && <label htmlFor={id} style={{display:"block",fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".5px",textTransform:"uppercase",marginBottom:4}}>
        {label}{req && <span aria-hidden="true" style={{color:C.accent,marginRight:3}}>*</span>}
      </label>}
      <div style={{position:"relative"}}>
        {icon && <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",color:C.faint,pointerEvents:"none",display:"flex"}}>{ICONS[icon] ? <Icon name={icon} size={18}/> : icon}</span>}
        <input {...rest} id={id} aria-required={req||undefined}
          onFocus={e=>{setF(true);rest.onFocus?.(e);}}
          onBlur={e=>{setF(false);rest.onBlur?.(e);}}
          style={{width:"100%",boxSizing:"border-box",padding:icon?"10px 36px 10px 13px":"10px 13px",background:C.bg,border:`1.5px solid ${f?C.indigo:C.border}`,borderRadius:10,color:C.ink,fontSize:14,outline:"none",boxShadow:f?`0 0 0 3px ${C.indigoL}`:"none",transition:"all .14s"}}
        />
      </div>
    </div>
  );
}

function TA({ label, ...rest }) {
  const [f, setF] = useState(false);
  const id = useId();
  return (
    <div style={{marginBottom:13}}>
      {label && <label htmlFor={id} style={{display:"block",fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".5px",textTransform:"uppercase",marginBottom:4}}>{label}</label>}
      <textarea {...rest} id={id}
        onFocus={()=>setF(true)} onBlur={()=>setF(false)}
        style={{width:"100%",boxSizing:"border-box",padding:"10px 13px",background:C.bg,border:`1.5px solid ${f?C.indigo:C.border}`,borderRadius:10,color:C.ink,fontSize:14,outline:"none",resize:"vertical",minHeight:80,boxShadow:f?`0 0 0 3px ${C.indigoL}`:"none",transition:"all .14s"}}
      />
    </div>
  );
}

function Btn({ children, onClick, disabled, variant="dark", style:s={} }) {
  const V = {
    dark:    {bg:C.ink,    c:"#fff", b:"none"},
    accent:  {bg:C.accent, c:"#fff", b:"none"},
    teal:    {bg:C.teal,   c:"#fff", b:"none"},
    red:     {bg:C.red,    c:"#fff", b:"none"},
    outline: {bg:"transparent", c:C.ink, b:`1.5px solid ${C.border}`},
    ghost:   {bg:C.bg, c:C.muted, b:`1px solid ${C.border}`},
  };
  const v = V[variant] || V.dark;
  return (
    <button onClick={onClick} disabled={disabled}
      style={{padding:"11px 18px",borderRadius:12,fontSize:14,fontWeight:700,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.5:1,background:v.bg,color:v.c,border:v.b,transition:"opacity .13s",...s}}>
      {children}
    </button>
  );
}

// ── CoverSlot: בוחר תמונה — מצלמה + גלריה ──────────────────
// ── מצלמה בתוך האתר: מסגרת בצורת ספר, וזיהוי ברקוד בזמן אמת ──
const canLiveCamera = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
const canDetectBarcode = () => typeof window !== "undefined" && "BarcodeDetector" in window;

function CameraSheet({ mode = "cover", onCapture, onBarcode, onFallback, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState(mode === "barcode" ? "כוונו לברקוד שבגב הספר" : "ישרו את הכריכה בתוך המסגרת");
  const doneRef = useRef(false);

  useEffect(() => {
    let alive = true, timer;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current; v.srcObject = stream; await v.play(); setReady(true);
        if (mode === "barcode" && canDetectBarcode()) {
          const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a"] });
          const tick = async () => {
            if (!alive || doneRef.current) return;
            try {
              const codes = await det.detect(v);
              const c = codes.find(x => /^97[89]\d{10}$/.test(x.rawValue)) || codes[0];
              if (c && /^97[89]/.test(c.rawValue)) { doneRef.current = true; navigator.vibrate?.(60); onBarcode(c.rawValue); return; }
              if (c) setHint("זה לא ברקוד של ספר. חפשו את המספר שמתחיל ב-978");
            } catch {}
            timer = setTimeout(tick, 280);
          };
          tick();
        }
      } catch {
        if (alive) onFallback();
      }
    })();
    return () => { alive = false; clearTimeout(timer); streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  const frameRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [isbnText, setIsbnText] = useState("");
  // מצלם ברזולוציה המלאה של המצלמה, וחותך בדיוק את מה שבתוך המסגרת (עם שוליים קטנים)
  const shoot = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busy) return;
    setBusy(true);
    let src = v, sw = v.videoWidth, sh = v.videoHeight;
    try {
      const track = streamRef.current?.getVideoTracks()[0];
      if (track && "ImageCapture" in window) {
        const blob = await new window.ImageCapture(track).takePhoto();
        const bmp = await createImageBitmap(blob);
        // takePhoto מחזיר תמונה בשדה ראייה זהה לווידאו, ברזולוציה גבוהה יותר
        if (Math.abs(bmp.width / bmp.height - sw / sh) < 0.05) { src = bmp; sw = bmp.width; sh = bmp.height; }
      }
    } catch {}
    // מיפוי המסגרת שעל המסך לקואורדינטות בתמונה (הווידאו מוצג ב-object-fit: cover)
    const vr = v.getBoundingClientRect(), fr = frameRef.current?.getBoundingClientRect();
    const scale = Math.max(vr.width / sw, vr.height / sh);
    const offX = (sw * scale - vr.width) / 2, offY = (sh * scale - vr.height) / 2;
    let x = 0, y = 0, w = sw, h = sh;
    if (fr && mode === "cover") {
      const m = 0.06; // שוליים קטנים, כדי לא לחתוך את קצה הכריכה
      x = (fr.left - vr.left + offX) / scale - fr.width / scale * m;
      y = (fr.top - vr.top + offY) / scale - fr.height / scale * m;
      w = fr.width / scale * (1 + 2 * m); h = fr.height / scale * (1 + 2 * m);
      x = Math.max(0, x); y = Math.max(0, y); w = Math.min(sw - x, w); h = Math.min(sh - y, h);
    }
    const out = Math.min(1, 2000 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * out); c.height = Math.round(h * out);
    c.getContext("2d").drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    c.toBlob(b => { setBusy(false); if (b) { doneRef.current = true; onCapture(new File([b], "camera.jpg", { type: "image/jpeg" })); } }, "image/jpeg", 0.92);
  };

  const frame = mode === "barcode" ? { w: "78%", aspect: "2.2/1" } : { w: "62%", aspect: "2/3" };
  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"#000",direction:"rtl"}}>
      <video ref={videoRef} playsInline muted style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover"}}/>
      {/* מסגרת */}
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
        <div ref={frameRef} style={{width:frame.w,maxWidth:mode==="barcode"?420:300,aspectRatio:frame.aspect,borderRadius:16,boxShadow:"0 0 0 9999px rgba(0,0,0,.55)",border:"2px solid rgba(255,255,255,.9)",position:"relative"}}>
          {mode==="barcode" && ready && <div style={{position:"absolute",left:"6%",right:"6%",top:"50%",height:2,background:"#7BD389",boxShadow:"0 0 12px #7BD389",animation:"pulse 1.2s ease infinite"}}/>}
        </div>
      </div>
      <div style={{position:"absolute",top:0,left:0,right:0,padding:"calc(14px + env(safe-area-inset-top)) 16px 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <button onClick={onClose} aria-label="סגירה" style={{width:42,height:42,borderRadius:"50%",border:"none",background:"rgba(0,0,0,.5)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><Icon name="close" size={20}/></button>
        <div style={{color:"#fff",fontSize:15,fontWeight:600,background:"rgba(0,0,0,.45)",padding:"8px 14px",borderRadius:99}}>{hint}</div>
        <div style={{width:42}}/>
      </div>
      <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"0 24px calc(28px + env(safe-area-inset-bottom))",display:"flex",justifyContent:"center",alignItems:"center",gap:28}}>
        {mode === "cover" ? (
          <button onClick={shoot} disabled={!ready||busy} aria-label="צילום" style={{width:76,height:76,borderRadius:"50%",border:"4px solid #fff",background:"rgba(255,255,255,.25)",cursor:"pointer",padding:0,opacity:busy?.5:1}}>
            <span style={{display:"block",width:58,height:58,borderRadius:"50%",background:"#fff",margin:"0 auto"}}/>
          </button>
        ) : (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,width:"100%"}}>
            {canDetectBarcode() && <div style={{color:"rgba(255,255,255,.85)",fontSize:13,textAlign:"center"}}>מזהים אוטומטית, אין צורך ללחוץ.<br/>הברקוד הוא הפסים עם המספר שמתחיל ב-978</div>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={shoot} disabled={!ready||busy} style={{padding:"12px 18px",borderRadius:99,border:"none",background:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>{canDetectBarcode()?"לא מזהה? צלמו":"צלמו את גב הספר"}</button>
              <button onClick={()=>setTyping(t=>!t)} style={{padding:"12px 18px",borderRadius:99,border:"1.5px solid rgba(255,255,255,.7)",background:"transparent",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>הקלדה ידנית</button>
            </div>
            {typing && <form onSubmit={e=>{e.preventDefault();const d=isbnText.replace(/\D/g,"");if(d.length>=10){doneRef.current=true;onBarcode(d);}}} style={{display:"flex",gap:8,width:"100%",maxWidth:340}}>
              <input autoFocus value={isbnText} onChange={e=>setIsbnText(e.target.value)} inputMode="numeric" placeholder="978..." style={{flex:1,padding:"12px 14px",borderRadius:12,border:"none",fontSize:17,direction:"ltr",textAlign:"center"}}/>
              <button type="submit" style={{padding:"0 18px",borderRadius:12,border:"none",background:C.accent,color:"#fff",fontWeight:700,fontSize:15}}>חיפוש</button>
            </form>}
          </div>
        )}
      </div>
    </div>
  );
}

// משבצת צילום: מצלמה מובנית (עם מסגרת) או גלריה
function CoverSlot({ label, sub, icon, preview, loading, onFile, badge }) {
  const camRef = useRef(), galRef = useRef();
  const [cam, setCam] = useState(false);
  const handle = e => { if (e.target.files[0]) { onFile(e.target.files[0]); e.target.value = ""; } };
  const openCam = () => canLiveCamera() ? setCam(true) : camRef.current.click();
  const pill = {display:"inline-flex",alignItems:"center",gap:4,fontSize:12,fontWeight:700,padding:"6px 10px",borderRadius:9,cursor:"pointer",border:"none"};
  return (
    <div style={{flex:1,border:`2px dashed ${preview?C.accent:C.border}`,borderRadius:16,minHeight:170,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:preview?C.tealL:C.white,overflow:"hidden",position:"relative"}}>
      {cam && <CameraSheet mode="cover" onClose={()=>setCam(false)} onFallback={()=>{setCam(false);camRef.current.click();}} onCapture={f=>{setCam(false);onFile(f);}}/>}
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handle}/>
      <input ref={galRef} type="file" accept="image/*" style={{display:"none"}} onChange={handle}/>
      {loading
        ? <div style={{textAlign:"center",padding:10}}><Spinner/><div style={{fontSize:12,color:C.muted,marginTop:8,fontWeight:600}}>מזהים את הספר ומיישרים את הכריכה...</div></div>
        : preview
          ? <>
              <img src={preview} alt="" style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover"}}/>
              <div style={{position:"absolute",inset:0,background:"linear-gradient(to top, rgba(0,0,0,.65), rgba(0,0,0,.05) 60%)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",padding:10}}>
                {badge && <div style={{position:"absolute",top:8,right:8,background:"#fff",color:C.accent,fontSize:11,fontWeight:700,padding:"3px 8px",borderRadius:99,display:"flex",alignItems:"center",gap:3}}><Icon name="check" size={12} stroke={2.6}/>{badge}</div>}
                <div style={{display:"flex",gap:6}}>
                  <button onClick={openCam} style={{...pill,background:"rgba(255,255,255,.9)",color:C.ink}}><Icon name="camera" size={14}/>שוב</button>
                  <button onClick={()=>galRef.current.click()} style={{...pill,background:"rgba(255,255,255,.9)",color:C.ink}}><Icon name="image" size={14}/>גלריה</button>
                </div>
              </div>
            </>
          : <div style={{textAlign:"center",padding:"0 10px"}}>
              <div style={{color:C.accent,display:"flex",justifyContent:"center",marginBottom:6}}><Icon name={icon} size={30}/></div>
              <div style={{fontSize:13,fontWeight:700,color:C.ink,marginBottom:2}}>{label}</div>
              <div style={{fontSize:11,color:C.muted,marginBottom:10}}>{sub}</div>
              <div style={{display:"flex",gap:6,justifyContent:"center"}}>
                <button onClick={openCam} style={{...pill,background:C.ink,color:"#fff"}}><Icon name="camera" size={14}/>צילום</button>
                <button onClick={()=>galRef.current.click()} style={{...pill,background:C.bg,color:C.ink}}><Icon name="image" size={14}/>גלריה</button>
              </div>
            </div>
      }
    </div>
  );
}

// ── מסך הוספת ספר ──────────────────────────────────────────
function AddBook({ user, onDone, toast_, coords, onNeedPhone }) {
  const [step, setStep] = useState("gps"); // gps | choose | camera | manual
  const [gpsGranted, setGpsGranted] = useState(false);
  const [fp, setFp] = useState(null);  // front preview URL
  const [bp, setBp] = useState(null);  // back preview URL
  const [fl, setFl] = useState(false); // front loading
  const [bl, setBl] = useState(false); // back loading
  const [frontFile, setFrontFile] = useState(null);
  const [form, setForm] = useState({
    title:"", author:"", publisher:"", year:"",
    summary:"", condition:"", genre:"", mode:"sell", price:"", lendUntil:"", swapFor:""
  });
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [coverNote, setCoverNote] = useState("");
  const [barcodeCam, setBarcodeCam] = useState(false);
  const barcodeInputRef = useRef(null);
  const copyInputRef = useRef(null);
  const [copyPreview, setCopyPreview] = useState(null);
  const [isbnBusy, setIsbnBusy] = useState(false);
  const upd = k => e => setForm(p=>({...p,[k]:e.target.value}));

  // סריקת ברקוד → פרטי הספר והכריכה לפי ISBN
  const lookupIsbn = async code => {
    setBarcodeCam(false); setIsbnBusy(true); setStep("camera");
    try {
      const res = await api.get(`/api/books/isbn/${encodeURIComponent(code)}`);
      const d = res.data;
      setForm(f => ({ ...f, isbn: d.isbn, title: d.title || f.title, author: d.author || f.author, publisher: d.publisher || f.publisher,
        year: d.year || f.year, summary: d.summary || f.summary, genre: d.genre || f.genre,
        thumbnail: d.thumbnail || f.thumbnail, coverQuality: d.thumbnail?.includes("/api/img/cover/") ? "community" : f.coverQuality }));
      if (d.thumbnail) setCoverNote(d.thumbnail.includes("/api/img/cover/") ? "כריכה מהספרייה" : "כריכה מהקטלוג");
      toast_(res.found ? `מצאנו: ${d.title} ✓` : "הברקוד נקרא, אבל הספר לא בקטלוג. צלמו את הכריכה", res.found ? "ok" : "warn");
    } catch (e) { toast_(e.message, "err"); }
    setIsbnBusy(false);
  };
  // בלי זיהוי ברקוד בדפדפן: צילום הגב ו-Claude קורא את המספר
  const barcodeFromPhoto = async file => {
    setBarcodeCam(false); setStep("camera");
    await scanBack(file);
  };

  const scanFront = async raw => {
    setCoverNote("");
    setFp(URL.createObjectURL(raw));
    setFl(true);
    const file = await compressImage(raw);
    setFrontFile(file);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await api.upload("/api/analyze/front", fd);
      const d = res.data;
      // סדר עדיפויות לכריכה: ספריית הקהילה ← הצילום שלכם אחרי יישור ← מאגר חיצוני ← חיתוך פשוט
      const thumb = res.communityCover || (res.straightened && res.croppedImage) || d.thumbnail || res.croppedImage || "";
      const quality = res.communityCover ? "community" : res.straightened ? "straight" : "";
      setForm(f => ({
        ...f,
        title:     d.title     || f.title,
        author:    d.author    || f.author,
        publisher: d.publisher || f.publisher,
        year:      d.year      || f.year,
        isbn:      d.isbn      || f.isbn,
        thumbnail: thumb || f.thumbnail,
        coverQuality: thumb ? quality : f.coverQuality,
        genre:     d.genre     || f.genre,
      }));
      setCoverNote(res.communityCover ? "כריכה מהספרייה" : res.straightened ? "הכריכה יושרה" : "");
      const cnt = [d.title, d.author, d.publisher].filter(Boolean).length;
      toast_(cnt ? `זיהינו ${cnt} פרטים מהכריכה ✓` : "לא הצלחנו לקרוא את הכריכה, אפשר להשלים ידנית", cnt ? "ok" : "warn");
    } catch (e) {
      toast_(e.message, "err");
    } finally { setFl(false); }
  };

  const scanBack = async raw => {
    setBp(URL.createObjectURL(raw));
    setBl(true);
    const file = await compressImage(raw);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await api.upload("/api/analyze/back", fd);
      const d = res.data;
      const updates = {};
      if (d.summary) updates.summary = d.summary;
      if (d.isbn) updates.isbn = d.isbn;
      if (d.publisher) updates.publisher = d.publisher;
      if (d.year) updates.year = d.year;
      if (d.genre) updates.genre = d.genre;
      // אם Google Books החזיר נתונים מהISBN — עדיפות גבוהה
      if (d.googleTitle) updates.title = d.googleTitle;
      if (d.googleAuthor) updates.author = d.googleAuthor;
      if (res.communityCover) { updates.thumbnail = res.communityCover; updates.coverQuality = "community"; setCoverNote("כריכה מהספרייה"); }
      if (Object.keys(updates).length) {
        setForm(f => ({ ...f, ...updates, thumbnail: f.coverQuality === "community" ? f.thumbnail : (updates.thumbnail || f.thumbnail) }));
        toast_("✓ פרטי הספר עודכנו מהכריכה האחורית");
      } else {
        toast_("כריכה נותחה — לא נמצאו פרטים", "warn");
      }
    } catch (e) {
      toast_(e.message, "err");
    } finally { setBl(false); }
  };

  const getCoords = () => new Promise(resolve => {
    if (coords) return resolve(coords);
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10000 }
    );
  });

  const save = async () => {
    if (!form.title.trim()) return toast_("שם ספר הוא שדה חובה", "warn");
    if (!form.author.trim()) return toast_("שם המחבר הוא שדה חובה", "warn");
    setSaving(true);
    try {
      const location = await getCoords();
      const fd = new FormData();
      Object.entries(form).forEach(([k,v]) => { if(v) fd.append(k, String(v)); });
      if (location) { fd.append("lat", location.lat); fd.append("lng", location.lng); }
      if (frontFile) fd.append("frontImage", frontFile);

      const res = await api.upload("/api/books", fd);
      toast_("הספר פורסם! 🎉");
      onDone(res.book);
    } catch (e) {
      toast_(e.message, "err");
      if (e.code === "phone" && onNeedPhone) onNeedPhone();
      if (String(e.code || "").startsWith("image_")) setPreview(false);
    } finally { setSaving(false); }
  };

  if (preview) {
    const pb = { id: form.title, title: form.title, author: form.author, thumbnail: form.thumbnail || fp, mode: form.mode, price: form.price };
    return (
    <div style={{padding:"4px 0 20px",direction:"rtl",animation:"fadeUp .2s ease"}}>
      <h2 style={{fontFamily:HEAD,fontSize:24,fontWeight:700,color:C.ink,textAlign:"center"}}>ככה זה ייראה</h2>
      <div style={{fontSize:13,color:C.muted,textAlign:"center",marginTop:4,marginBottom:18}}>אפשר לחזור ולתקן לפני הפרסום</div>
      <div style={{display:"flex",justifyContent:"center"}}>
        <div style={{width:170}}><BookTile book={pb} onOpen={()=>{}} user={null}/></div>
      </div>
      {form.summary && <div className="clamp4" style={{fontSize:13.5,color:C.muted,lineHeight:1.7,margin:"16px 8px 0",textAlign:"center"}}>{form.summary}</div>}
      {/* תמונה של העותק עצמו: הקונה רואה את המצב האמיתי */}
      <div style={{display:"flex",alignItems:"center",gap:12,background:"#fff",border:`1px solid ${C.border}`,borderRadius:16,padding:12,margin:"18px 0 14px"}}>
        <div style={{width:54,height:72,borderRadius:10,overflow:"hidden",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:C.faint}}>
          {(copyPreview || (frontFile && fp)) ? <img src={copyPreview || fp} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <Icon name="camera" size={22}/>}
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:14,fontWeight:700,color:C.ink}}>צילום של העותק שלך</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2}}>{frontFile ? "יוצג בדף הספר לצד הכריכה" : "מומלץ: מראה את המצב האמיתי של הספר"}</div>
        </div>
        <button onClick={()=>copyInputRef.current.click()} style={{padding:"8px 12px",borderRadius:10,border:"none",background:C.ink,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>{frontFile?"החלפה":"הוספה"}</button>
        <input ref={copyInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{
          const file = e.target.files[0]; e.target.value = "";
          if (!file) return;
          setCopyPreview(URL.createObjectURL(file));
          setFrontFile(await compressImage(file));
          if (!form.thumbnail) setFp(URL.createObjectURL(file));
        }}/>
      </div>
      <div style={{display:"flex",gap:10}}>
        <Btn variant="outline" onClick={()=>setPreview(false)} style={{flex:1,padding:"14px",borderRadius:14}}>עריכה</Btn>
        <Btn variant="accent" onClick={save} disabled={saving} style={{flex:2,padding:"14px",borderRadius:14,fontSize:15}}>
          {saving ? <><Spinner/> מפרסם...</> : "פרסום למדף"}
        </Btn>
      </div>
    </div>
    );
  }

  if (step === "gps") return (
    <div style={{animation:"fadeUp .2s ease",textAlign:"center",padding:"24px 16px"}}>
      <div style={{width:76,height:76,borderRadius:24,background:C.tealL,color:C.accent,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}><Icon name="pin" size={38} stroke={1.7}/></div>
      <div style={{fontSize:17,fontWeight:800,color:C.ink,marginBottom:10}}>איפה הספר נמצא?</div>
      <div style={{fontSize:13,color:C.muted,lineHeight:1.7,marginBottom:24}}>
        כדי שאנשים בסביבתך יוכלו למצוא את הספר, נבקש גישה למיקומך המשוער.<br/>
        המיקום משמש רק להצגת הספר לאנשים קרובים — לא נשמר בפרופיל שלך.
      </div>
      <Btn onClick={()=>{
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            pos => {
              setGpsGranted(true);
              if (typeof coords === "object" && coords !== null) return;
            },
            () => setGpsGranted(false),
            { enableHighAccuracy: false, timeout: 10000 }
          );
        }
        setStep("choose");
      }} style={{width:"100%",padding:"14px",marginBottom:10,fontSize:15}}>
        📍 אפשר מיקום משוער
      </Btn>
      <button onClick={()=>setStep("choose")} style={{background:"none",border:"none",color:C.muted,fontSize:13,cursor:"pointer",textDecoration:"underline"}}>
        דלג (הספר יוצג ללא מרחק)
      </button>
    </div>
  );

  if (step === "choose") return (
    <div style={{animation:"fadeUp .2s ease"}}>
      <h2 style={{fontFamily:HEAD,fontSize:26,fontWeight:700,color:C.ink,marginBottom:4}}>ספר חדש למדף</h2>
      <div style={{fontSize:14,color:C.muted,marginBottom:18}}>הדרך הכי מהירה: לצלם את הכריכה</div>
      <button className="press" onClick={()=>setStep("camera")} style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"18px 16px",borderRadius:20,border:"none",background:"linear-gradient(135deg,#2F4858,#1E2D3D)",color:"#fff",cursor:"pointer",textAlign:"right",marginBottom:12,boxShadow:"0 10px 24px rgba(30,45,61,.25)"}}>
        <span style={{width:52,height:52,borderRadius:16,background:"rgba(255,255,255,.12)",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="scan" size={28}/></span>
        <span style={{flex:1}}>
          <span style={{display:"block",fontSize:17,fontWeight:700}}>סריקת כריכה</span>
          <span style={{display:"block",fontSize:13,opacity:.75,marginTop:3}}>מצלמים, והשם, המחבר וההוצאה מתמלאים לבד</span>
        </span>
        <Icon name="forward" size={20}/>
      </button>
      <button className="press" onClick={()=>setStep("manual")} style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"16px",borderRadius:20,border:`1px solid ${C.border}`,background:"#fff",color:C.ink,cursor:"pointer",textAlign:"right"}}>
        <span style={{width:52,height:52,borderRadius:16,background:C.bg,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="pencil" size={24}/></span>
        <span style={{flex:1}}>
          <span style={{display:"block",fontSize:16,fontWeight:700}}>הזנה ידנית</span>
          <span style={{display:"block",fontSize:13,color:C.muted,marginTop:3}}>ממלאים את הפרטים בעצמכם</span>
        </span>
        <Icon name="forward" size={20} color={C.muted}/>
      </button>
    </div>
  );

  return (
    <div style={{animation:"fadeUp .2s ease"}}>
      <button onClick={()=>setStep("choose")} style={{background:C.bg,border:"none",borderRadius:9,padding:"6px 12px",cursor:"pointer",fontSize:13,marginBottom:14}}>
        → חזרה
      </button>

      {step === "camera" && (
        <div style={{background:C.white,borderRadius:18,border:`1px solid ${C.border}`,padding:"16px",marginBottom:12}}>
          <div style={{fontSize:14,fontWeight:700,color:C.ink,marginBottom:4}}>צלמו את שתי הכריכות</div>
          <div style={{fontSize:12,color:C.muted,marginBottom:12}}>המערכת תחלץ את הפרטים ותזין לטופס אוטומטית</div>
          <div style={{display:"flex",gap:10,marginBottom:10}}>
            <CoverSlot label="כריכה קדמית" sub="שם · מחבר · הוצאה" icon="novel" preview={form.thumbnail||fp} loading={fl||isbnBusy} onFile={scanFront} badge={coverNote}/>
            <CoverSlot label="גב הספר" sub="תקציר · ברקוד" icon="doc" preview={bp} loading={bl} onFile={scanBack}/>
          </div>
          {(fp||bp) && !fl && !bl && (
            <div style={{background:C.tealL,borderRadius:10,padding:"9px 12px",fontSize:12,color:C.teal,fontWeight:600}}>
              הפרטים מולאו בטופס למטה. כדאי לעבור עליהם רגע
            </div>
          )}
        </div>
      )}

      {/* טופס פרטי ספר */}
      <div style={{background:C.white,borderRadius:18,border:`1px solid ${C.border}`,padding:"16px",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,color:C.ink,marginBottom:14}}>פרטי הספר</div>
        <Inp label="שם הספר" required value={form.title} onChange={upd("title")} placeholder="שם הספר" icon="novel"/>
        <Inp label="מחבר" value={form.author} onChange={upd("author")} placeholder="שם המחבר" icon="quill"/>
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:2}}><Inp label="הוצאה" value={form.publisher} onChange={upd("publisher")} placeholder="שם ההוצאה"/></div>
          <div style={{flex:1}}><Inp label="שנה" value={form.year} onChange={upd("year")} placeholder="2024"/></div>
        </div>
        <TA label="תקציר" value={form.summary} onChange={upd("summary")} placeholder="תקציר הסיפור..."/>
        <Inp label="מצב" value={form.condition} onChange={upd("condition")} placeholder="כמו חדש / טוב / שימוש רב" icon="sparkle"/>
        <div style={{marginBottom:13}}>
          <label htmlFor="genre-select" style={{display:"block",fontSize:13,fontWeight:600,color:C.muted,marginBottom:6}}>סוגה</label>
          <select id="genre-select" value={form.genre} onChange={e=>setForm(f=>({...f,genre:e.target.value}))} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1px solid ${C.border}`,fontSize:14,background:C.bg,direction:"rtl"}}>
            <option value="">בחר סוגה (מומלץ)</option>
            <option value="ספרות ורומנים">ספרות ורומנים</option>
            <option value="מתח">מתח</option>
            <option value="מדע בדיוני ופנטזיה">מדע בדיוני ופנטזיה</option>
            <option value="אהבה ורומנטיקה">אהבה ורומנטיקה</option>
            <option value="היסטוריה">היסטוריה</option>
            <option value="ביוגרפיה">ביוגרפיה</option>
            <option value="מדע ופילוסופיה">מדע ופילוסופיה</option>
            <option value="פיתוח אישי">פיתוח אישי</option>
            <option value="עסקים וכלכלה">עסקים וכלכלה</option>
            <option value="ילדים ונוער">ילדים ונוער</option>
            <option value="בישול ואפייה">בישול ואפייה</option>
            <option value="שירה">שירה</option>
            <option value="יהדות ורוחניות">יהדות ורוחניות</option>
            <option value="אחר">אחר</option>
          </select>
        </div>
      </div>

      {/* מה לעשות */}
      <div style={{background:C.white,borderRadius:18,border:`1px solid ${C.border}`,padding:"16px",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,color:C.ink,marginBottom:12}}>מה עושים עם הספר?</div>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {Object.entries(MODES).map(([k,m])=>(
            <button key={k} onClick={()=>setForm(f=>({...f,mode:k}))}
              style={{flex:1,padding:"10px 3px",borderRadius:12,border:`2px solid ${form.mode===k?m.fg:C.border}`,background:form.mode===k?m.bg:C.bg,color:form.mode===k?m.fg:C.muted,fontSize:12,fontWeight:800,cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"center",marginBottom:4}}><Icon name={m.icon} size={22}/></div>{m.label}
            </button>
          ))}
        </div>
        {form.mode === "sell" && (
          <Inp label="מחיר (₪)" type="number" value={form.price} onChange={upd("price")} placeholder="0" icon="tag"/>
        )}
        {form.mode === "lend" && (
          <div>
            <div style={{fontSize:13,fontWeight:600,color:C.muted,marginBottom:6}}>תאריך החזרה</div>
            <input type="date" value={form.lendUntil||""} onChange={e=>setForm(f=>({...f,lendUntil:e.target.value}))} min={new Date().toISOString().split("T")[0]} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1px solid ${C.border}`,fontSize:15,background:C.bg}}/>
          </div>
        )}
        {form.mode === "swap" && (
          <Inp label="איזה ספר מחפש?" value={form.swapFor||""} onChange={e=>setForm(f=>({...f,swapFor:e.target.value}))} placeholder="שם ספר / נושא / סוגה" icon="search"/>
        )}
        {form.mode === "give" && (
          <div style={{padding:"10px 12px",background:"#f0fdf4",borderRadius:10,fontSize:13,color:"#15803d",fontWeight:600}}>🎁 הספר יסומן כמסירה חינם — כל אחד יכול לבוא לקחת!</div>
        )}
      </div>

      <Btn onClick={()=>{if(!form.title.trim()||!form.author.trim())return toast_("שם ספר ומחבר הם שדות חובה","warn");setPreview(true);}} style={{width:"100%",padding:"13px",borderRadius:13,marginBottom:24}}>
        המשך לתצוגה מקדימה
      </Btn>
    </div>
  );
}

// שדה קוד בן 6 ספרות — מקלדת מספרים והשלמה אוטומטית מה-SMS/מייל
function CodeInput({ value, onChange, onEnter }) {
  return (
    <input value={value} onChange={e=>onChange(e.target.value.replace(/\D/g,"").slice(0,6))}
      onKeyDown={e=>e.key==="Enter"&&onEnter&&onEnter()}
      inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" autoFocus
      style={{width:"100%",padding:"16px",borderRadius:12,border:`1.5px solid ${C.border}`,marginBottom:14,fontSize:26,textAlign:"center",letterSpacing:10,background:C.bg,color:C.ink,outline:"none",direction:"ltr"}} />
  );
}

// ── כפתור "המשך עם Google" (Google Identity Services) ─────────────────
const GOOGLE_CLIENT_ID = "558837526271-at1k2c514u1bj7h7n6pjbq3n0genks6m.apps.googleusercontent.com";
let gsiPromise = null;
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gsiPromise) gsiPromise = new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = ok; s.onerror = () => { gsiPromise = null; fail(new Error("gsi")); };
    document.head.appendChild(s);
  });
  return gsiPromise;
}
function GoogleButton({ onResult, onError }) {
  const ref = useRef(null);
  const cb = useRef({ onResult, onError });
  cb.current = { onResult, onError };
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadGsi().then(() => {
      if (!alive || !ref.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID, ux_mode: "popup", use_fedcm_for_button: true,
        callback: async ({ credential }) => {
          setBusy(true);
          try { cb.current.onResult(await api.post("/api/auth/google", { credential })); }
          catch (e) { cb.current.onError(e.message); }
          finally { if (alive) setBusy(false); }
        },
      });
      const w = Math.min(380, Math.max(220, Math.round(ref.current.getBoundingClientRect().width || 320)));
      window.google.accounts.id.renderButton(ref.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "pill", locale: "he", width: w, logo_alignment: "center" });
    }).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);
  if (failed) return null;
  return (
    <div style={{position:"relative",minHeight:44,marginBottom:4}}>
      <div ref={ref} style={{display:"flex",justifyContent:"center",width:"100%",opacity:busy?.4:1}}/>
      {busy && <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:C.muted}}><Spinner/>&nbsp;מתחברים...</div>}
    </div>
  );
}
function OrDivider() {
  return <div style={{display:"flex",alignItems:"center",gap:10,margin:"14px 0",color:C.muted,fontSize:12}}><div style={{flex:1,height:1,background:C.border}}/>או עם קוד למייל<div style={{flex:1,height:1,background:C.border}}/></div>;
}

function Login({ onBack, onDone, onRegister }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState("email");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const sendOtp = async () => {
    if (!email.trim()) return setErr("הכנס כתובת מייל");
    setLoading(true); setErr(""); setInfo("");
    try {
      await api.post("/api/auth/send-otp", { email });
      setStep("code"); setCode("");
      setInfo("הקוד נשלח. כדאי לבדוק גם בתיקיית הספאם");
    } catch(e) { setErr(e.message); }
    setLoading(false);
  };

  const verifyOtp = async () => {
    if (code.length !== 6) return setErr("הקוד בן 6 ספרות");
    setLoading(true); setErr("");
    try {
      const res = await api.post("/api/auth/verify-otp", { email, code });
      if (res.isNew) { setLoading(false); return onRegister({ email: email.trim().toLowerCase(), ticket: res.ticket }); }
      onDone(res.user, res.token);
    } catch(e) { setErr(e.message); }
    setLoading(false);
  };

  return (
    <div style={{minHeight:"100vh",background:HDR,display:"flex",alignItems:"center",justifyContent:"center",padding:24,direction:"rtl"}}>
      <div style={{background:C.white,borderRadius:22,padding:"26px 24px 28px",width:"100%",maxWidth:380,boxShadow:"0 20px 60px rgba(0,0,0,.3)",animation:"fadeUp .25s ease"}}>
        <button onClick={step==="code"?()=>{setStep("email");setErr("");}:onBack} style={{background:C.bg,border:"none",borderRadius:9,padding:"6px 12px",fontSize:13,color:C.muted,cursor:"pointer",marginBottom:18}}>→ חזרה</button>
        <h1 style={{fontFamily:HEAD,fontSize:26,color:C.ink,marginBottom:6}}>{step==="email"?"התחברות":"הקוד שלך"}</h1>
        {step==="email" ? <>
          <p style={{fontSize:14,color:C.muted,marginBottom:18,lineHeight:1.6}}>בלי סיסמאות. נכנסים עם Google או עם קוד שנשלח למייל.</p>
          <GoogleButton onError={setErr} onResult={res => res.isNew ? onRegister({ email: res.email, ticket: res.ticket, name: res.name }) : onDone(res.user, res.token)}/>
          <OrDivider/>
          <input type="email" inputMode="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendOtp()} placeholder="כתובת מייל"
            style={{width:"100%",padding:"15px 16px",borderRadius:12,border:`1.5px solid ${C.border}`,marginBottom:14,fontSize:17,background:C.bg,color:C.ink,outline:"none",direction:"ltr",textAlign:"right"}} />
          {err && <div role="alert" style={{color:C.red,fontSize:13,marginBottom:10}}>{err}</div>}
          <Btn onClick={sendOtp} disabled={loading} style={{width:"100%",padding:"16px",borderRadius:14,fontSize:16}}>{loading?"שולח...":"שלחו לי קוד"}</Btn>
        </> : <>
          <p style={{fontSize:14,color:C.muted,marginBottom:16,lineHeight:1.6}}>שלחנו קוד בן 6 ספרות אל <b style={{color:C.ink,direction:"ltr",display:"inline-block"}}>{email}</b></p>
          <CodeInput value={code} onChange={setCode} onEnter={verifyOtp}/>
          {err && <div role="alert" style={{color:C.red,fontSize:13,marginBottom:10}}>{err}</div>}
          {!err && info && <div style={{color:C.muted,fontSize:12,marginBottom:10}}>{info}</div>}
          <Btn onClick={verifyOtp} disabled={loading||code.length!==6} style={{width:"100%",padding:"16px",borderRadius:14,fontSize:16}}>{loading?"מאמת...":"כניסה"}</Btn>
          <button onClick={sendOtp} disabled={loading} style={{width:"100%",marginTop:12,background:"none",border:"none",color:C.accent,fontSize:13,fontWeight:600,cursor:"pointer"}}>לא הגיע? שלחו שוב</button>
        </>}
      </div>
    </div>
  );
}

// ── מסך הרשמה: פרטים ← קוד במייל ← סיום ─────────────────────
function Register({ onBack, onDone, prefill, onShowLegal, onGooglePrefill }) {
  // הרשמה כחנות מוסתרת כרגע — כולם נרשמים כאנשים פרטיים (הקוד לחנויות נשאר להמשך)
  const [type, setType] = useState("private");
  const [form, setForm] = useState({ name: prefill?.name || "", phone:"", email: prefill?.email || "", storeName:"", address:"" });
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ticket, setTicket] = useState(prefill?.ticket || null);
  const upd = k => e => setForm(p=>({...p,[k]:e.target.value}));
  const phoneOk = /^(\+972|0)\d{8,9}$/.test(form.phone.replace(/[^\d+]/g,""));
  const valid = form.name.trim() && phoneOk && /\S+@\S+\.\S+/.test(form.email) && (type!=="store" || (form.storeName && form.address));

  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState("");

  const finish = async (tk) => {
    const res = await api.post("/api/users/register", { ...form, type, ticket: tk, emailConsent: consent });
    onDone(res.user, res.token);
  };

  const submit = async () => {
    if (!valid) return setErr(!phoneOk && form.phone ? "מספר הטלפון לא תקין" : "יש למלא את כל שדות החובה");
    setLoading(true); setErr("");
    try {
      if (ticket) { await finish(ticket); return; }
      await api.post("/api/auth/send-otp", { email: form.email });
      setOtpStep(true);
    } catch(e) {
      if (e.code === "verify") { setTicket(null); setErr("צריך לאמת את המייל שוב"); }
      else setErr(e.message);
    }
    finally { setLoading(false); }
  };

  const verifyOtp = async () => {
    if (otp.length !== 6) return setErr("הקוד בן 6 ספרות");
    setLoading(true); setErr("");
    try {
      const res = await api.post("/api/auth/verify-otp", { email: form.email, code: otp });
      if (!res.isNew) { onDone(res.user, res.token); return; }
      setTicket(res.ticket);
      await finish(res.ticket);
    } catch(e) { setErr(e.message); }
    setLoading(false);
  };

  const quotes = [
    "\"ספר טוב הוא חבר לכל החיים\"",
    "\"מי שקורא חי אלף חיים\"",
    "\"הכל מתחיל בפרק הבא...\"",
  ];
  const q = quotes[Math.floor(Date.now()/1000) % 3];

  return (
    <div style={{minHeight:"100vh",background:C.bg,direction:"rtl"}}>
      <div style={{background:HDR,padding:"22px 18px 22px"}}>
        {onBack && <button onClick={onBack} style={{background:"rgba(255,255,255,.12)",border:"none",borderRadius:9,padding:"6px 12px",color:"rgba(255,255,255,.8)",fontSize:13,cursor:"pointer",marginBottom:14}}>→ חזרה</button>}
        <h1 style={{fontFamily:HEAD,fontSize:26,fontWeight:700,color:"#fff"}}>
          {otpStep ? "כמעט שם" : type ? "הרשמה" : "מדפדפים לפרק הבא"}
        </h1>
        {!type && <div style={{fontSize:13,color:"rgba(255,255,255,.7)",marginTop:6,fontStyle:"italic"}}>{q}</div>}
        {prefill && !otpStep && <div style={{fontSize:13,color:"rgba(255,255,255,.7)",marginTop:6}}>המייל אומת. נשארו רק כמה פרטים</div>}
      </div>

      <div style={{padding:"18px 15px",maxWidth:520,margin:"0 auto"}}>
        {!type
          ? <>
              <div style={{fontSize:14,color:C.muted,marginBottom:18,lineHeight:1.7,textAlign:"center"}}>
                רק שם, טלפון ומייל, ואנחנו בפרק הבא
              </div>
              <div style={{display:"flex",gap:12}}>
                {[
                  {t:"private",i:"👤",tl:"אדם פרטי",   d:"שתף ספרים עם שכנים"},
                  {t:"store",  i:"🏪",tl:"חנות ספרים", d:"נהל מלאי וקבל התראות"},
                ].map(o=>(
                  <div key={o.t} onClick={()=>setType(o.t)}
                    style={{flex:1,background:C.white,borderRadius:18,border:`2px solid ${C.border}`,padding:"22px 12px",cursor:"pointer",textAlign:"center",boxShadow:"0 2px 9px rgba(0,0,0,.06)"}}>
                    <div style={{fontSize:38,marginBottom:10}}>{o.i}</div>
                    <div style={{fontSize:14,fontWeight:800,color:C.ink,marginBottom:5}}>{o.tl}</div>
                    <div style={{fontSize:12,color:C.muted,lineHeight:1.5}}>{o.d}</div>
                  </div>
                ))}
              </div>
            </>
          : otpStep ? <>
              <div style={{background:C.white,borderRadius:18,border:`1px solid ${C.border}`,padding:"20px 16px",marginBottom:12}}>
                <p style={{fontSize:14,color:C.muted,marginBottom:14,lineHeight:1.6}}>שלחנו קוד בן 6 ספרות אל <b style={{color:C.ink,direction:"ltr",display:"inline-block"}}>{form.email}</b>. כדאי לבדוק גם בספאם.</p>
                <CodeInput value={otp} onChange={setOtp} onEnter={verifyOtp}/>
                {err && <div role="alert" style={{color:C.red,fontSize:13,marginBottom:10}}>{err}</div>}
                <Btn onClick={verifyOtp} disabled={loading||otp.length!==6} style={{width:"100%",padding:"15px",borderRadius:13,fontSize:15}}>{loading?"מאמת...":"אמת והיכנס"}</Btn>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:12}}>
                  <button onClick={()=>{setOtpStep(false);setErr("");}} style={{background:"none",border:"none",color:C.muted,fontSize:13,cursor:"pointer"}}>תיקון פרטים</button>
                  <button onClick={submit} disabled={loading} style={{background:"none",border:"none",color:C.accent,fontSize:13,fontWeight:600,cursor:"pointer"}}>שלחו קוד שוב</button>
                </div>
              </div>
            </>
          : <>
              {false && <button onClick={()=>setType(null)} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:9,padding:"6px 13px",cursor:"pointer",fontSize:13,marginBottom:14,color:C.muted}}>→ סוג חשבון</button>}
              {!ticket && <>
                <GoogleButton onError={setErr} onResult={res => res.isNew ? onGooglePrefill({ email: res.email, ticket: res.ticket, name: res.name }) : onDone(res.user, res.token)}/>
                <OrDivider/>
              </>}
              <div style={{background:C.white,borderRadius:18,border:`1px solid ${C.border}`,padding:"16px",marginBottom:12}}>
                <div style={{fontSize:12,color:C.muted,marginBottom:14}}>שדות עם * הם חובה</div>
                <Inp label="שם" required value={form.name}  onChange={upd("name")}  placeholder="השם שלך" icon="user" autoComplete="name"/>
                <Inp label="טלפון" required value={form.phone} onChange={upd("phone")} placeholder="050-0000000" inputMode="tel" type="tel" icon="phone" autoComplete="tel"/>
                <div style={{fontSize:11,color:C.muted,marginTop:-8,marginBottom:12}}>מוצג רק למשתמשים רשומים שפונים אליך לגבי ספר</div>
                <Inp label="אימייל" required value={form.email} onChange={upd("email")} placeholder="email@example.com" type="email" inputMode="email" icon="mail" autoComplete="email" disabled={!!prefill}/>
                {type === "store" && <>
                  <div style={{height:1,background:C.border,margin:"12px 0"}}/>
                  <Inp label="שם החנות" required value={form.storeName} onChange={upd("storeName")} placeholder="שם החנות" icon="home"/>
                  <Inp label="כתובת החנות" required value={form.address} onChange={upd("address")} placeholder="רחוב, מספר, עיר" icon="pin"/>
                </>}
                <label style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:13,color:C.ink,lineHeight:1.5,cursor:"pointer",marginTop:4}}>
                  <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} style={{marginTop:3,width:18,height:18,accentColor:C.accent,flexShrink:0}}/>
                  <span>אשמח לקבל עדכונים על ספרים חדשים בשכונה (אפשר להסיר בכל רגע)</span>
                </label>
              </div>
              {err && <div role="alert" style={{background:C.redL,borderRadius:10,padding:"10px 14px",fontSize:13,color:C.red,marginBottom:12}}>{err}</div>}
              <Btn onClick={submit} disabled={!valid||loading} style={{width:"100%",padding:"15px",borderRadius:13,fontSize:15}}>
                {loading ? <><Spinner/> רגע...</> : ticket ? "סיום הרשמה" : type==="store" ? "פתיחת חנות" : "המשך"}
              </Btn>
              <div style={{fontSize:12,color:C.muted,textAlign:"center",marginTop:12,lineHeight:1.6}}>
                בהרשמה אני מסכים/ה ל<button onClick={()=>onShowLegal("terms")} style={linkBtn}>תנאי השימוש</button> ול<button onClick={()=>onShowLegal("privacy")} style={linkBtn}>מדיניות הפרטיות</button>
              </div>
            </>
        }
      </div>
    </div>
  );
}
const linkBtn = {background:"none",border:"none",padding:0,color:"#4a6b2f",textDecoration:"underline",cursor:"pointer",fontSize:"inherit",fontFamily:"inherit"};

// ── מסך פתיחה ──────────────────────────────────────────────
function Splash({ onReg, onGuest, onLogin, onShowLegal }) {
  return (
    <div style={{minHeight:"100vh",background:`radial-gradient(120% 80% at 50% 0%, #2a3d52 0%, ${HDR} 60%)`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:28,direction:"rtl"}}>
      <div style={{display:"flex",gap:5,marginBottom:34,alignItems:"flex-end"}}>
        {SPINES.map((c,i)=>(
          <div key={i} style={{width:14,height:52+Math.sin(i*.9)*9,borderRadius:"3px 5px 5px 3px",background:c,boxShadow:`2px 2px 10px ${c}66`,animation:`spineRise .5s ${i*.07}s both ease`}}/>
        ))}
      </div>
      <h1 style={{fontFamily:HEAD,fontSize:36,fontWeight:700,color:"#fff",textAlign:"center",lineHeight:1.12,marginBottom:12}}>ספרייה<br/>שכונתית</h1>
      <div style={{color:"rgba(255,255,255,.7)",fontSize:15,marginBottom:10,textAlign:"center",lineHeight:1.6,maxWidth:300}}>הספרים שכבר קראת, אצל השכנים שמחפשים אותם</div>
      <div style={{color:"rgba(255,255,255,.7)",fontSize:13,marginBottom:40,letterSpacing:".5px"}}>השאלה · מכירה · החלפה · מסירה</div>
      <div style={{width:"100%",maxWidth:320,display:"flex",flexDirection:"column",gap:10}}>
        <Btn variant="accent" onClick={onReg} style={{width:"100%",padding:"15px",fontSize:16,borderRadius:14,boxShadow:"0 6px 20px rgba(107,143,71,.35)"}}>הצטרפות חינם</Btn>
        <Btn onClick={onLogin} style={{width:"100%",padding:"15px",fontSize:15,borderRadius:14,background:"rgba(255,255,255,.14)"}}>יש לי חשבון</Btn>
        <button onClick={onGuest} style={{width:"100%",padding:"13px",background:"none",border:"none",color:"rgba(255,255,255,.7)",fontSize:14,cursor:"pointer",textDecoration:"underline",textUnderlineOffset:4}}>להציץ בספרים בלי להירשם</button>
      </div>
      <div style={{marginTop:36,fontSize:12,color:"rgba(255,255,255,.6)",display:"flex",gap:14}}>
        <button onClick={()=>onShowLegal("terms")} style={{...linkBtn,color:"rgba(255,255,255,.78)",textDecoration:"none"}}>תנאי שימוש</button>
        <span>·</span>
        <button onClick={()=>onShowLegal("privacy")} style={{...linkBtn,color:"rgba(255,255,255,.78)",textDecoration:"none"}}>פרטיות</button>
        <span>·</span>
        <button onClick={()=>onShowLegal("accessibility")} style={{...linkBtn,color:"rgba(255,255,255,.78)",textDecoration:"none"}}>נגישות</button>
      </div>
    </div>
  );
}

// ── מדיניות פרטיות ותנאי שימוש ──────────────────────────────
const LEGAL_UPDATED = "26.10.2026";
const LEGAL = {
  privacy: { title: "מדיניות פרטיות", sections: [
    ["מי אנחנו", "Pageturner (\"ספרייה שכונתית\", pageturner.co.il) היא פלטפורמה ישראלית שמחברת בין שכנים שרוצים למכור, להשאיל, להחליף או למסור ספרים. לכל שאלה או בקשה בנוגע למידע שלכם אפשר לפנות אלינו דרך \"צור קשר\" בתפריט האתר, או במייל pageturner.team@gmail.com."],
    ["איזה מידע אנחנו אוספים", "שם, מספר טלפון וכתובת מייל שמסרתם בהרשמה. אם נכנסתם עם Google, אנחנו מקבלים מ-Google רק את כתובת המייל והשם שלכם, ולא שום מידע אחר מהחשבון. פרטי הספרים שפרסמתם ותמונות שצילמתם. מיקום משוער של הספר, רק אם אישרתם גישה למיקום. תמונת פרופיל ומשפט על עצמכם, אם הוספתם. נתוני שימוש בסיסיים: חיפושים, צפייה בספרים ופניות למפרסמים, כדי לשפר את השירות."],
    ["מה רואים משתמשים אחרים", "כל מי שנכנס לאתר רואה את פרטי הספר, את השם שלכם ואת העיר. המרחק מוצג בעיגול, כך שאי אפשר לדעת את הכתובת המדויקת. מספר הטלפון מוצג רק למשתמש רשום שפותח את דף הספר כדי לפנות אליכם. כתובת המייל לא מוצגת לאף אחד."],
    ["תמונות", "כשאתם מצלמים כריכה לזיהוי אוטומטי, התמונה נשלחת לשירות בינה מלאכותית חיצוני (Anthropic) כדי לחלץ את פרטי הספר. כל תמונה שמועלית לאתר (תמונות ספרים ותמונת פרופיל) נבדקת אוטומטית באותו שירות, כדי לוודא שאין בה תוכן לא הולם ושתמונות הספרים באמת מציגות ספר. אנחנו לא שולחים עם התמונות שום פרט מזהה עליכם."],
    ["ספקים שעובדים איתנו", "כניסה עם חשבון Google (Google), אחסון השרת ומסד הנתונים (Railway), אחסון האתר (Vercel), שליחת מיילים (Resend), זיהוי ספרים מתמונה (Anthropic), חיפוש פרטי ספרים (Google Books, Open Library) ותרגום מיקום לשם עיר (OpenStreetMap). חלק מהספקים פועלים מחוץ לישראל. אנחנו לא מוכרים מידע אישי לאף אחד."],
    ["מיילים", "נשלח לכם קודי כניסה, ועדכון כשספר שביקשתם להתעדכן עליו מתפרסם. עדכונים שיווקיים יישלחו רק אם הסכמתם לכך בהרשמה, ואפשר לבטל בכל רגע בהגדרות הפרופיל."],
    ["הזכויות שלכם", "אפשר לעיין במידע שלכם ולתקן אותו בפרופיל. אפשר למחוק את החשבון בכל רגע מתוך הפרופיל: החשבון, הספרים והמשאלות נמחקים מיד, ונתוני השימוש נשמרים ללא זיהוי. לבקשות נוספות אפשר לפנות אלינו דרך \"צור קשר\" בתפריט או במייל pageturner.team@gmail.com."],
    ["אבטחה", "הכניסה לאתר נעשית עם חשבון Google או בקוד חד-פעמי שנשלח למייל, בלי סיסמאות. החיבור לאתר מוצפן, והגישה לפעולות בחשבון מחייבת זיהוי. שום מערכת אינה חסינה לחלוטין, ואנחנו פועלים כדי לצמצם סיכונים."],
  ]},
  terms: { title: "תנאי שימוש", sections: [
    ["השירות", "Pageturner מאפשרת לפרסם ספרים ולמצוא ספרים אצל אנשים בסביבה. אנחנו לוח מודעות שמחבר בין אנשים, ולא צד לעסקאות. התשלום, המסירה וההחזרה של ספרים נעשים ישירות בין המשתמשים."],
    ["פרסום ספרים", "מפרסמים רק ספרים שבבעלותכם, עם פרטים נכונים ומצב אמיתי של הספר, ומעלים רק תמונות של הספר עצמו. אסור לפרסם תוכן פוגעני, מיני, אלים, מטעה, או כזה שמפר זכויות של אחרים. תמונות נבדקות אוטומטית לפני הפרסום, וכל משתמש יכול לדווח על מודעה לא הולמת. מודעה שקיבלה כמה דיווחים מוסתרת עד שנבדוק אותה. אנחנו רשאים להסיר מודעות או לחסום משתמשים שמפרים את התנאים."],
    ["עסקאות בין משתמשים", "בדקו את הספר לפני תשלום, ותאמו מפגש במקום ציבורי כשאפשר. האחריות על העסקה, על מצב הספר ועל החזרת ספרים מושאלים היא של המשתמשים עצמם."],
    ["פניות", "השתמשו בפרטי הקשר של משתמשים אחרים רק כדי לפנות לגבי הספר שפרסמו. אסור לשלוח ספאם, לאסוף פרטים או להטריד."],
    ["אחריות", "השירות ניתן כמו שהוא. אנחנו עושים מאמץ שיפעל כראוי, אבל לא מתחייבים לזמינות רציפה או לדיוק של מידע שמשתמשים פרסמו או שזוהה אוטומטית מתמונה."],
    ["שינויים", "ייתכן שנעדכן את התנאים מעת לעת. נעדכן כאן את תאריך העדכון האחרון, ושימוש בשירות לאחר עדכון מהווה הסכמה לתנאים המעודכנים. על התנאים חל הדין הישראלי."],
    ["יצירת קשר", "שאלות, דיווח על מודעה בעייתית או כל פנייה אחרת: דרך \"צור קשר\" בתפריט האתר, או במייל pageturner.team@gmail.com."],
  ]},  accessibility: { title: "הצהרת נגישות", sections: [
    ["המחויבות שלנו", "חשוב לנו ש-Pageturner יהיה נוח ושימושי לכל אחד ואחת, כולל אנשים עם מוגבלות. השקענו בהנגשת האתר כדי שכל השכנים יוכלו לחפש, לפרסם ולשתף ספרים בקלות."],
    ["רמת הנגישות", "האתר הותאם לדרישות תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע\"ג-2013, ולתקן הישראלי ת\"י 5568, המבוסס על הנחיות WCAG 2.0 ברמה AA."],
    ["מה עשינו באתר", "ניגודיות צבעים לפי התקן בכל הטקסטים והכפתורים. תוויות מפורשות לכל שדות הטפסים. תיאור טקסטואלי לכל הכפתורים והאייקונים, כולל ספרים ותמונות כריכה. אפשרות לנווט ולהפעיל את כל האתר באמצעות מקלדת, עם סימון בולט של האלמנט שבפוקוס. חלונות קופצים שמקבלים פוקוס, נסגרים במקש Esc ומחזירים את הפוקוס למקומו. הודעות מערכת והודעות שגיאה שמוקראות אוטומטית בקורא מסך. מבנה כותרות ואזורים ברורים בכל מסך. התאמה לגדלי מסך שונים ותמיכה בהגדלת טקסט בדפדפן. הפחתת אנימציות למי שהגדיר זאת במכשיר. כניסה לאתר בלי סיסמאות, עם חשבון Google או קוד למייל."],
    ["דפדפנים וטכנולוגיות מסייעות", "האתר בנוי לעבודה בגרסאות העדכניות של Chrome, Safari, Edge ו-Firefox, במחשב ובטלפון, ולתמיכה בקוראי מסך נפוצים כמו NVDA, VoiceOver ו-TalkBack. האתר נבדק בכלי בדיקה אוטומטיים ובבדיקת ניווט במקלדת."],
    ["מגבלות ידועות", "תמונות שמשתמשים מצלמים ומעלים (צילומי עותק) מוצגות בלי תיאור מפורט, אבל לצד כל תמונה מופיעים שם הספר, הסופר ומצב העותק. חלון הכניסה עם Google מופעל על ידי Google ואינו בשליטתנו. אם נתקלתם בבעיה, נשמח לעזור גם בדרך אחרת, למשל לפרסם ספר עבורכם."],
    ["נתקלתם בבעיה? פנו אלינו", "אם משהו באתר לא נגיש לכם, או שיש לכם הצעה לשיפור, נשמח לשמוע: דרך \"צור קשר\" בתפריט האתר, או במייל pageturner.team@gmail.com. כדאי לציין באיזה מסך הייתה הבעיה, מה ניסיתם לעשות ובאיזה מכשיר ודפדפן השתמשתם. נחזור אליכם בהקדם, ולכל המאוחר תוך 14 ימים."],
  ]},
};

// דיאלוג נגיש: פוקוס נכנס לחלון, Escape סוגר, והפוקוס חוזר למקום שממנו נפתח
const dialogStack = [];
function useDialog(onClose) {
  const ref = useRef(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    const me = {}; dialogStack.push(me);
    ref.current?.focus({ preventScroll: true });
    const onKey = e => {
      if (dialogStack[dialogStack.length - 1] !== me) return;
      if (e.key === "Escape") { e.stopPropagation(); close.current?.(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const f = [...ref.current.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),textarea,select,[tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { const i = dialogStack.indexOf(me); if (i >= 0) dialogStack.splice(i, 1); document.removeEventListener("keydown", onKey); if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true }); };
  }, []);
  return ref;
}

function Overlay({ onClose, label, outerStyle, panelStyle, children }) {
  const dref = useDialog(onClose);
  return (
    <div style={outerStyle} onClick={onClose}>
      <div ref={dref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} style={{outline:"none",...panelStyle}} onClick={e=>e.stopPropagation()}>{children}</div>
    </div>
  );
}

function LegalSheet({ kind, onClose }) {
  const doc = LEGAL[kind];
  const dref = useDialog(onClose);
  if (!doc) return null;
  return (
    <div style={{position:"fixed",inset:0,zIndex:900,background:"rgba(14,12,8,.7)",display:"flex",alignItems:"flex-end",direction:"rtl"}} onClick={onClose}>
      <div ref={dref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={doc.title} style={{outline:"none",width:"100%",maxWidth:560,margin:"0 auto",background:C.white,borderRadius:"22px 22px 0 0",maxHeight:"88vh",overflowY:"auto",padding:"22px 20px 32px",animation:"sheetUp .28s cubic-bezier(.33,1,.68,1)"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:32,height:4,borderRadius:99,background:C.border,margin:"0 auto 18px"}}/>
        <h2 style={{fontFamily:HEAD,fontSize:24,fontWeight:700,color:C.ink}}>{doc.title}</h2>
        <div style={{fontSize:12,color:C.muted,marginTop:4,marginBottom:18}}>עודכן לאחרונה: {LEGAL_UPDATED}</div>
        {doc.sections.map(([h,t])=>(
          <div key={h} style={{marginBottom:16}}>
            <div style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:4}}>{h}</div>
            <div style={{fontSize:14,color:"#4a5560",lineHeight:1.75}}>{t}</div>
          </div>
        ))}
        <button onClick={onClose} style={{width:"100%",marginTop:8,padding:"13px",borderRadius:12,background:C.ink,color:"#fff",border:"none",fontSize:15,fontWeight:700,cursor:"pointer"}}>סגירה</button>
      </div>
    </div>
  );
}

// ── App ראשי ────────────────────────────────────────────────
export default function App() {
  const navigate = useNavigate();

  useEffect(() => {
    const handlePop = () => {
      const p = new URLSearchParams(window.location.search);
      const uid = p.get("user");
      const t = p.get("tab") || "search";
      const bid = p.get("book");
      setViewUserId(uid || null);
      setTab(t);
      if (!bid) setViewBook(null);
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  const [screen, setScreen] = useState(() => {
    if (new URLSearchParams(window.location.search).has("admin")) return "admin";
    try {
      const u = JSON.parse(localStorage.getItem("pt_user") || "null");
      if (u && u.type !== "guest" && !session.token()) return "login";
      return u ? (localStorage.getItem("pt_screen") || "app") : "splash";
    } catch { return "splash"; }
  });
  const [user, setUser] = useState(() => {
    try {
      const u = JSON.parse(localStorage.getItem("pt_user") || "null");
      if (u && u.type !== "guest" && !session.token()) { session.clear(); return null; }
      return u;
    } catch { return null; }
  });
  // pageturner.co.il/privacy ו-/terms פותחים ישירות את המסמך (קישור קבוע עבור Google ואחרים)
  const [legal, setLegal] = useState(() => window.location.pathname.match(/^\/(privacy|terms|accessibility)\/?$/)?.[1] || null);
  const [regPrefill, setRegPrefill] = useState(null);
  const [showContact, setShowContact] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [wishMatches, setWishMatches] = useState([]);
  const [profTab, setProfTab] = useState("shelf");
  const [books, setBooks] = useState([]);
  const [myBooks, setMyBooks] = useState([]);
  const [tab, setTab] = useState(()=>{
    const p = new URLSearchParams(window.location.search);
    return p.get("tab") || "search";
  });
  const [viewUserId, setViewUserId] = useState(()=>{
    const p = new URLSearchParams(window.location.search);
    return p.get("user") || null;
  });
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("all");
  const [genreFilter, setGenreFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [editBook, setEditBook] = useState(null);
  const [viewBook, setViewBook] = useState(null);
  const [viewBookId, setViewBookId] = useState(()=>{
    const p = new URLSearchParams(window.location.search);
    return p.get("book") || null;
  });

  const toast_ = useCallback((msg, type="ok") => {
    setToast({msg, type});
    setTimeout(()=>setToast(null), 3000);
  }, []);

  const isGuest = user?.type === "guest";
  const onGuestAction = useCallback(() => setScreen("register"), []);

  // טען ספרים מהשרת
  const [userCoords, setUserCoords] = useState(null);

  useEffect(() => {
    if (navigator.geolocation && user && screen === "app") {
      navigator.geolocation.getCurrentPosition(
        pos => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: false, timeout: 10000 }
      );
    }
  }, [user, screen]);

  const loadMyBooks = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await api.get(`/api/books?ownerId=${user?.id}&all=true`);
      setMyBooks(Array.isArray(data) ? data : []);
    } catch(e) {}
  }, [user?.id]);

  useEffect(() => {
    if (tab === "profile") loadMyBooks();
  }, [tab, loadMyBooks]);

  // כל הספרים נטענים פעם אחת; חיפוש וסינון קורים מיד בדפדפן
  const lastSearch = useRef("");
  const loadBooks = useCallback(async (quiet) => {
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (userCoords) { params.set("lat", userCoords.lat); params.set("lng", userCoords.lng); }
      const data = await api.get(`/api/books?${params}`);
      setBooks(Array.isArray(data) ? data : []);
    } catch(e) {
      if (!quiet) toast_(e.message, "err");
    } finally { setLoading(false); }
  }, [toast_, userCoords]);

  useEffect(() => {
    if (screen === "app") loadBooks(books.length > 0);
  }, [screen, loadBooks]);

  useEffect(() => {
    const q = search.trim();
    if (!q || q === lastSearch.current) return;
    const t = setTimeout(() => { lastSearch.current = q; api.track("search", { q }); }, 1200);
    return () => clearTimeout(t);
  }, [search]);

  const norm = t => String(t || "").toLowerCase().replace(/["'״׳-]/g, "");
  const filtered = useMemo(() => {
    const q = norm(search.trim());
    return books.filter(b =>
      (modeFilter === "all" || b.mode === modeFilter) &&
      (genreFilter === "all" || b.genre === genreFilter) &&
      (!q || norm(b.title).includes(q) || norm(b.author).includes(q) || norm(b.ownername).includes(q))
    );
  }, [books, search, modeFilter, genreFilter]);
  const browsing = !search.trim() && modeFilter === "all" && genreFilter === "all";

  // ספרים שמורים
  const [favIds, setFavIds] = useState(() => new Set());
  const [favBooks, setFavBooks] = useState([]);
  const loadFavs = useCallback(async () => {
    if (!user?.id || isGuest || !session.token()) return;
    try { const d = await api.get("/api/favorites"); if (Array.isArray(d)) { setFavBooks(d); setFavIds(new Set(d.map(b => b.id))); } } catch {}
  }, [user?.id, isGuest]);
  useEffect(() => { if (screen === "app") loadFavs(); }, [screen, loadFavs]);
  const toggleFav = useCallback(async (book) => {
    if (isGuest || !user?.id) { toast_("הירשמו כדי לשמור ספרים", "warn"); return; }
    const had = favIds.has(book.id);
    setFavIds(prev => { const n = new Set(prev); had ? n.delete(book.id) : n.add(book.id); return n; });
    setFavBooks(prev => had ? prev.filter(b => b.id !== book.id) : [book, ...prev]);
    try { had ? await api.del(`/api/favorites/${book.id}`) : await api.put(`/api/favorites/${book.id}`); if (!had) toast_("נשמר ❤"); }
    catch (e) {
      setFavIds(prev => { const n = new Set(prev); had ? n.add(book.id) : n.delete(book.id); return n; });
      toast_(e.message, "err");
    }
  }, [favIds, isGuest, user?.id, toast_]);
  const openBook = useCallback(b => { setViewBook(b); api.track("book_view", { bookId: b.id, title: b.title }); }, []);

  useEffect(() => {
    const onEdit = e => setEditBook(e.detail);
    const onDelete = e => deleteBook(e.detail.id);
    document.addEventListener("editBook", onEdit);
    document.addEventListener("deleteBook", onDelete);
    return () => {
      document.removeEventListener("editBook", onEdit);
      document.removeEventListener("deleteBook", onDelete);
    };
  }, []);

  const [pendingContact, setPendingContact] = useState(null);
  const [askDealMode, setAskDealMode] = useState(false);
  const [ownerPending, setOwnerPending] = useState(null);
  const [ownerAskDeal, setOwnerAskDeal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [editBio, setEditBio] = useState(false);
  const [bioText, setBioText] = useState("");
  const [showWishModal, setShowWishModal] = useState(false);
  const [wishResults, setWishResults] = useState([]);
  const [wishLoading, setWishLoading] = useState(false);
  const [wishQuery, setWishQuery] = useState("");

  useEffect(() => {
    if (!user?.id || isGuest) return;
    const checkPending = async () => {
      try {
        const d = await api.get(`/api/contacts/pending/${user?.id}`);
        if (d) setPendingContact(d);
        // בדוק גם שאלות למפרסם
        const d2 = await api.get(`/api/contacts/owner-pending/${user?.id}`);
        if (d2) setOwnerPending(d2);
        const m = await api.get(`/api/wishlist/matches/${user?.id}`);
        if (Array.isArray(m)) setWishMatches(m);
      } catch {}
    };
    const t = setTimeout(checkPending, 2000);
    return () => clearTimeout(t);
  }, [user?.id, screen]);

  const handleContactAnswer = async (answer, dealStatus) => {
    if (!pendingContact) return;
    try {
      // "לא" — לא מסמן askedStatus כדי לאפשר שאילה חוזרת
      // "skip" ו-"done" — מסמן askedStatus=true לצמיתות
      const markAsked = answer === "skip" || answer === "done";
      await api.put(`/api/contacts/${pendingContact.id}`, { status: answer, dealStatus, markAsked });
    } catch {}
    setPendingContact(null);
    setAskDealMode(false);
    if (answer === "done") { loadBooks(); loadMyBooks(); }
  };

  const checkPendingSoon = () => {
    setTimeout(async () => {
      try { const d = await api.get(`/api/contacts/pending/${user?.id}`); if (d) setPendingContact(d); } catch {}
    }, 3000);
  };

  const handleOwnerAnswer = async (answer, dealStatus) => {
    if (!ownerPending) return;
    try {
      await api.put(`/api/contacts/${ownerPending.id}`, { dealStatus, confirmedByOwner: answer === "confirmed" });
      if (answer === "confirmed") {
        toast_("✅ הספר ירד מזמינות — תודה על העדכון!");
        loadBooks();
        loadMyBooks();
      }
    } catch {}
    setOwnerPending(null);
    setOwnerAskDeal(false);
  };

  useEffect(() => {
    if (screen === "app") api.track("page_load");
  }, [screen]);

  // חיבור שפג: חזרה למסך הכניסה
  const resetUi = () => {
    setEditBio(false); setShowSettings(false); setShowContact(false); setMenuOpen(false);
    setViewBook(null); setEditBook(null); setViewUserId(null); setTab("search");
    setPendingContact(null); setOwnerPending(null); setWishMatches([]); setMyBooks([]);
  };
  useEffect(() => {
    const onExpired = () => {
      resetUi(); session.clear(); setUser(null); setScreen("login");
      setTimeout(() => toast_("צריך להתחבר שוב. נשלח לך קוד למייל", "warn"), 60);
    };
    document.addEventListener("pt-auth-expired", onExpired);
    return () => document.removeEventListener("pt-auth-expired", onExpired);
  }, [toast_]);

  // רענון פרטי המשתמש מהשרת
  useEffect(() => {
    if (!user?.id || isGuest || !session.token()) return;
    api.get("/api/me").then(d => { if (d?.user) { setUser(d.user); session.saveUser(d.user); } }).catch(() => {});
  }, [user?.id]);

  // קישור ישיר לספר (?book=...) — למשל ממייל או משיתוף
  useEffect(() => {
    if (screen !== "app" || !viewBookId) return;
    const id = viewBookId; setViewBookId(null);
    api.get(`/api/books/${encodeURIComponent(id)}`).then(b => b?.id && setViewBook(b)).catch(() => toast_("הספר לא נמצא", "warn"));
  }, [screen, viewBookId]);

  // כפתור חזרה של הטלפון
  useEffect(() => {
    const hasState = viewBook || editBook || showAbout || menuOpen || tab !== "search";
    if (hasState) {
      window.history.pushState(null, "", window.location.href);
    }
    const handleBack = () => {
      if (menuOpen) { setMenuOpen(false); }
      else if (showAbout) { setShowAbout(false); }
      else if (viewBook) { setViewBook(null); }
      else if (editBook) { setEditBook(null); }
      else if (tab !== "search") { setTab("search"); }
    };
    window.addEventListener("popstate", handleBack);
    return () => window.removeEventListener("popstate", handleBack);
  }, [tab, viewBook, editBook, showAbout, menuOpen]);

  const handleAuth = (u, token, welcome) => {
    session.save(u, token); setUser(u); setScreen("app"); setRegPrefill(null);
    toast_(welcome ? `ברוך הבא, ${u.name} 📖` : `שלום ${u.name} 👋`);
  };
  const handleGuest = () => { const g = {name:"אורח",type:"guest"}; setUser(g); session.save(g); setScreen("app"); api.track("guest_login"); };
  const logout = async () => {
    resetUi();
    try { await api.post("/api/auth/logout"); } catch {}
    session.clear(); setUser(null); setScreen("splash");
  };

  const saveEdit = async (id, fields) => {
    try {

      await api.put(`/api/books/${id}`, fields);
      setEditBook(null);
      toast_("✓ הספר עודכן");
      loadBooks();
      loadMyBooks();
    } catch(e) { toast_(e.message, "err"); }
  };

  const deleteBook = async id => {
    try {
      await api.del(`/api/books/${id}`);
      setBooks(p => p.filter(b => b.id!==id));
      setMyBooks(p => p.filter(b => b.id!==id));
      setEditBook(null);
      toast_("הספר נמחק", "warn");
    } catch(e) { toast_(e.message, "err"); }
  };

  // ── screens ──────────────────────────────────────────────
  const legalSheet = legal && <LegalSheet kind={legal} onClose={()=>{setLegal(null);if(/^\/(privacy|terms|accessibility)/.test(window.location.pathname))window.history.replaceState(null,"","/");}}/>;
  if (screen === "admin") return <><style>{CSS}</style><AdminPage onBack={()=>{navigate("/");setScreen(user?"app":"splash");}}/></>
  if (screen === "splash") return <><style>{CSS}</style><main><Splash onReg={()=>setScreen("register")} onGuest={handleGuest} onLogin={()=>setScreen("login")} onShowLegal={setLegal}/></main>{legalSheet}<Toast t={toast}/></>;
  if (screen === "login") return <><style>{CSS}</style><main><Login onBack={()=>setScreen("splash")} onDone={(u,t)=>handleAuth(u,t,false)} onRegister={pf=>{setRegPrefill(pf);setScreen("register");}}/></main><Toast t={toast}/></>;
  if (screen === "register") return <><style>{CSS}</style><main><Register key={regPrefill?.email||"new"} prefill={regPrefill} onBack={()=>{setRegPrefill(null);setScreen(user?"app":"splash");}} onDone={(u,t)=>handleAuth(u,t,true)} onGooglePrefill={setRegPrefill} onShowLegal={setLegal}/></main>{legalSheet}</>;

  const TABS = [["search","home","גילוי"],["add","plus","הוספה"],["profile","user","פרופיל"]];
  const greet = (()=>{const h=new Date().getHours();return h>=5&&h<12?"בוקר טוב":h<17?"צהריים טובים":h<21?"ערב טוב":"לילה טוב";})();
  const others = books.filter(b => String(b.ownerid) !== String(user?.id));
  const nearby = userCoords ? others.filter(b => b.km != null).sort((a,b) => a.km - b.km).slice(0, 14) : [];
  const newest = [...others].sort((a,b) => Number(b.createdat) - Number(a.createdat)).slice(0, 14);
  const free = others.filter(b => b.mode === "give").slice(0, 14);
  const genreCounts = books.reduce((acc,b) => { if (b.genre) acc[b.genre] = (acc[b.genre]||0) + 1; return acc; }, {});
  const genreList = GENRES.filter(([g]) => genreCounts[g]);
  const clearFilters = () => { setSearch(""); setModeFilter("all"); setGenreFilter("all"); };
  const goTab = id => {
    setTab(id); navigate(`?tab=${id}`); window.scrollTo({top:0});
    if (id === "add" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }), () => {}, { enableHighAccuracy: false, timeout: 10000 });
    }
  };
  const onAvatarFile = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const canvas = document.createElement("canvas");
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = async () => {
      const MAX = 320, ratio = Math.min(MAX/img.width, MAX/img.height, 1);
      canvas.width = img.width * ratio; canvas.height = img.height * ratio;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      try {
        const d = await api.post("/api/users/"+user.id+"/avatar", { avatar: canvas.toDataURL("image/jpeg", 0.82) });
        const nu = {...user, avatar: d.avatar}; setUser(nu); session.saveUser(nu); toast_("התמונה עודכנה ✓");
      } catch(err) { toast_(err.message, "err"); }
    };
    img.src = objectUrl;
  };
  const shelf = myBooks.filter(b => b.avail);
  const past = myBooks.filter(b => !b.avail);
  const avatarEl = (sz, u = user) => (
    <div style={{width:sz,height:sz,borderRadius:"50%",overflow:"hidden",background:`linear-gradient(135deg,#6B8F47,#2F4858)`,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:sz*.42,flexShrink:0}}>
      {u?.avatar ? <img src={u.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <Icon name="user" size={sz*.55} stroke={1.9}/>}
    </div>
  );

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",direction:"rtl",background:C.bg,position:"relative",overflow:(viewUserId||viewBook)?"hidden":"visible",height:(viewUserId||viewBook)?"100vh":"auto"}}>
      <style>{CSS}</style>

      {editBook && <EditDrawer book={editBook} onSave={saveEdit} onDelete={deleteBook} onCancel={()=>setEditBook(null)} toast_={toast_}/>}
      {viewUserId && <UserPage userId={viewUserId} me={user} onClose={()=>{setViewUserId(null);navigate("/");}} onViewBook={b=>{setViewUserId(null);openBook(b);}} favs={favIds} onFav={toggleFav}/>}
      {viewBook && <BookPage book={viewBook} onClose={()=>setViewBook(null)} isGuest={isGuest} onGuest={onGuestAction} user={user} toast_={toast_}
        fav={favIds.has(viewBook.id)} onFav={()=>toggleFav(viewBook)}
        more={books.filter(b=>b.ownerid&&b.ownerid===viewBook.ownerid&&b.id!==viewBook.id).slice(0,10)}
        onOpenBook={b=>setViewBook(b)}
        onBookUpdated={()=>{loadBooks(true);loadMyBooks();}} onContactMade={checkPendingSoon} onViewUser={id=>{setViewBook(null);setViewUserId(id);navigate(`?user=${id}`);}}/>}

      {/* Header */}
      <header style={{position:"sticky",top:0,zIndex:60,background:"rgba(30,45,61,.97)",backdropFilter:"saturate(1.4) blur(10px)",paddingTop:"env(safe-area-inset-top)",boxShadow:"0 1px 0 rgba(255,255,255,.04)"}}>
        <div style={{maxWidth:900,margin:"0 auto",padding:"12px 16px 0",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
          <button onClick={()=>{clearFilters();goTab("search");}} style={{display:"flex",alignItems:"center",gap:9,background:"none",border:"none",cursor:"pointer",padding:0,color:"#fff"}}>
            <img src="/favicon.svg" alt="" width="30" height="30" style={{borderRadius:8}}/>
            <span style={{fontFamily:HEAD,fontSize:21,fontWeight:700}}>ספרייה שכונתית</span>
          </button>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {isGuest
              ? <button onClick={onGuestAction} style={{background:C.accent,border:"none",borderRadius:99,padding:"8px 14px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>הצטרפות</button>
              : <button onClick={()=>goTab("profile")} aria-label="הפרופיל שלי" style={{background:"none",border:"2px solid rgba(255,255,255,.25)",borderRadius:"50%",padding:0,cursor:"pointer"}}>{avatarEl(32)}</button>}
            <button onClick={()=>setMenuOpen(true)} aria-label="תפריט" style={{background:"rgba(255,255,255,.1)",border:"none",borderRadius:12,cursor:"pointer",width:38,height:38,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="menu" size={20}/></button>
          </div>
        </div>
        {tab === "search" && (
          <div style={{maxWidth:900,margin:"0 auto",padding:"12px 16px 14px"}}>
            <label style={{display:"flex",alignItems:"center",gap:10,background:"#fff",borderRadius:16,padding:"0 14px",boxShadow:"0 4px 14px rgba(0,0,0,.18)"}}>
              <Icon name="search" size={20} color={C.muted}/>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="איזה ספר בא לך לקרוא?" type="search" enterKeyHint="search" aria-label="חיפוש"
                style={{flex:1,minWidth:0,padding:"13px 0",background:"none",border:"none",color:C.ink,fontSize:16,outline:"none"}}/>
              {search && <button onClick={()=>setSearch("")} aria-label="ניקוי" style={{background:C.bg,border:"none",borderRadius:"50%",width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:C.muted}}><Icon name="close" size={14} stroke={2.2}/></button>}
            </label>
          </div>
        )}
      </header>

      <main id="main" tabIndex={-1} style={{flex:1,padding:"0 16px 24px",width:"100%",maxWidth:900,margin:"0 auto",outline:"none"}}>
        <h1 className="sr-only">{tab==="add"?"הוספת ספר":tab==="profile"?"הפרופיל שלי":"גילוי ספרים בשכונה"}</h1>

        {tab === "search" && <>
          {/* סינון לפי סוג עסקה */}
          <div className="rail" style={{padding:"14px 16px 4px",gap:8}}>
            {[["all","הכל","shelf"],...Object.entries(MODES).map(([k,m])=>[k,m.label,m.icon])].map(([k,l,ic])=>{
              const on = modeFilter===k;
              return (
                <button key={k} className="press" onClick={()=>setModeFilter(k)} aria-pressed={on}
                  style={{display:"flex",alignItems:"center",gap:6,padding:"9px 15px",borderRadius:99,fontSize:14,fontWeight:on?700:500,cursor:"pointer",whiteSpace:"nowrap",
                    border:"1.5px solid "+(MODES[k]?(on?MODES[k].solid:MODES[k].solid+"55"):(on?C.ink:C.border)),
                    background:on?(MODES[k]?.solid||C.ink):(MODES[k]?.bg||"#fff"),color:on?"#fff":(MODES[k]?.fg||C.ink),transition:"background .15s,color .15s"}}>
                  <Icon name={ic} size={16} stroke={2} color={on?"#fff":(MODES[k]?.fg||C.ink)}/>{l}
                </button>
              );
            })}
          </div>
          {genreFilter!=="all" && (
            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:10}}>
              <span style={{fontSize:13,color:C.muted}}>סוגה:</span>
              <button onClick={()=>setGenreFilter("all")} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px 6px 12px",borderRadius:99,border:"none",background:C.ink,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>{genreFilter}<Icon name="close" size={13} stroke={2.4}/></button>
            </div>
          )}

          {loading && !books.length ? (
            <div className="grid2" style={{marginTop:20}}>{[0,1,2,3,4,5].map(i=><TileSkeleton key={i}/>)}</div>
          ) : browsing ? <>
            {/* פתיח */}
            <div style={{marginTop:18,padding:"20px 18px",borderRadius:22,background:"linear-gradient(135deg,#2F4858 0%,#1E2D3D 70%)",color:"#fff",position:"relative",overflow:"hidden",animation:"fadeUp .35s ease"}}>
              <div style={{position:"absolute",left:-10,bottom:-14,display:"flex",gap:6,alignItems:"flex-end",opacity:.9}}>
                {["#6B8F47","#F5F0E8","#C9822F","#8C3B4A"].map((c,i)=><div key={i} style={{width:16,height:[58,74,50,66][i],background:c,borderRadius:"3px 6px 2px 2px",transform:i===3?"rotate(-12deg)":"none",transformOrigin:"bottom"}}/>)}
              </div>
              <div style={{fontSize:14,opacity:.75}}>{greet}{!isGuest&&user?.name?`, ${user.name}`:""}</div>
              <div style={{fontFamily:HEAD,fontSize:26,fontWeight:700,lineHeight:1.15,marginTop:4,maxWidth:"72%"}}>{books.length ? `${books.length} ספרים מחכים לקוראים חדשים` : "הספרייה של השכונה מתחילה כאן"}</div>
              <button className="press" onClick={()=>isGuest?onGuestAction():goTab("add")} style={{marginTop:14,display:"inline-flex",alignItems:"center",gap:8,padding:"10px 16px",borderRadius:99,border:"none",background:"#fff",color:C.ink,fontSize:14,fontWeight:700,cursor:"pointer"}}>
                <Icon name="camera" size={18}/> צלמו ספר והעלו אותו
              </button>
            </div>

            {nearby.length>0 && <><SectionHead title="קרוב אליך" sub="מסודר לפי מרחק" action="הכל" onAction={()=>document.getElementById("all-books")?.scrollIntoView({behavior:"smooth"})}/>
              <Rail books={nearby} onOpen={openBook} favs={favIds} onFav={toggleFav} user={user}/></>}
            {newest.length>0 && <><SectionHead title="חדש על המדף" sub="הספרים שעלו לאחרונה"/>
              <Rail books={newest} onOpen={openBook} favs={favIds} onFav={toggleFav} user={user}/></>}
            {free.length>0 && <><SectionHead title="חינם למסירה" sub="שווה להזדרז" action="הכל" onAction={()=>setModeFilter("give")}/>
              <Rail books={free} onOpen={openBook} favs={favIds} onFav={toggleFav} user={user}/></>}
            {genreList.length>=2 && <><SectionHead title="לפי סוגה"/>
              <div className="rail" style={{gap:10}}>
                {genreList.map(([g,ic,bg])=>(
                  <button key={g} className="press" onClick={()=>{setGenreFilter(g);window.scrollTo({top:0,behavior:"smooth"});}}
                    style={{width:112,height:96,borderRadius:18,border:"none",background:bg,cursor:"pointer",padding:"12px",display:"flex",flexDirection:"column",justifyContent:"space-between",alignItems:"flex-start",textAlign:"right",color:C.ink}}>
                    <Icon name={ic} size={26} stroke={1.7}/>
                    <div><div className="clamp1" style={{fontSize:13,fontWeight:700}}>{g}</div><div style={{fontSize:11.5,color:C.muted}}>{genreCounts[g]} ספרים</div></div>
                  </button>
                ))}
              </div></>}

            <div id="all-books" style={{scrollMarginTop:150}}><SectionHead title="כל הספרים" sub={userCoords?"הקרובים ביותר קודם":"החדשים קודם"}/></div>
            {books.length ? (
              <div className="grid2">{books.map(b => <BookTile key={b.id} book={b} onOpen={openBook} fav={favIds.has(b.id)} onFav={toggleFav} user={user}/>)}</div>
            ) : (
              <div style={{textAlign:"center",padding:"30px 20px",color:C.muted,background:"#fff",borderRadius:20,border:`1px dashed ${C.border}`}}>
                <Icon name="shelf" size={40} color={C.accent} style={{margin:"0 auto 10px"}}/>
                <div style={{fontSize:16,fontWeight:700,color:C.ink,marginBottom:6}}>עוד אין כאן ספרים</div>
                <div style={{fontSize:13,marginBottom:14}}>תהיו הראשונים לפתוח את המדף השכונתי</div>
                {!isGuest&&<Btn onClick={()=>goTab("add")}>הוספת ספר</Btn>}
              </div>
            )}
          </> : <>
            {/* תוצאות */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"16px 0 14px"}}>
              <div style={{fontSize:14,color:C.muted}}><b style={{color:C.ink,fontSize:16}}>{filtered.length}</b> {filtered.length===1?"ספר":"ספרים"}</div>
              <button onClick={clearFilters} style={{background:"none",border:"none",color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer"}}>ניקוי</button>
            </div>
            {filtered.length ? (
              <div className="grid2">{filtered.map(b => <BookTile key={b.id} book={b} onOpen={openBook} fav={favIds.has(b.id)} onFav={toggleFav} user={user}/>)}</div>
            ) : (
              <div style={{textAlign:"center",padding:"40px 20px",color:C.muted}}>
                <Icon name="search" size={44} color={C.faint} style={{margin:"0 auto 12px"}}/>
                <div style={{fontSize:17,fontWeight:700,color:C.ink,marginBottom:6}}>לא מצאנו את זה בשכונה</div>
                {search.trim()&&<div style={{fontSize:13,marginBottom:16,lineHeight:1.6}}>אף אחד עוד לא פרסם את "{search}"</div>}
                {search.trim()&&(isGuest
                  ? <Btn variant="accent" onClick={onGuestAction}>הירשמו ונעדכן כשיגיע</Btn>
                  : <Btn variant="accent" onClick={async()=>{setWishQuery(search);setShowWishModal(true);setWishLoading(true);setWishResults([]);try{const d=await api.get("/api/books/search-google?q="+encodeURIComponent(search));setWishResults(Array.isArray(d)?d:[]);}catch{}setWishLoading(false);}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:8}}><Icon name="bell" size={18}/>עדכנו אותי כשיתווסף</span></Btn>)}
              </div>
            )}
          </>}
        </>}

        {tab === "add" && (
          isGuest
            ? <div style={{textAlign:"center",padding:"56px 20px"}}>
                <Icon name="camera" size={46} color={C.accent} style={{margin:"0 auto 12px"}}/>
                <div style={{fontSize:17,fontWeight:700,color:C.ink,marginBottom:8}}>להוספת ספרים צריך חשבון</div>
                <div style={{fontSize:13,color:C.muted,marginBottom:16}}>לוקח פחות מדקה, רק קוד במייל</div>
                <Btn variant="accent" onClick={onGuestAction}>הצטרפות</Btn>
              </div>
            : <div style={{paddingTop:16}}><AddBook user={user} onDone={b=>{setBooks(p=>[b,...p]);setMyBooks(p=>[b,...p]);goTab("search");}} toast_={toast_} coords={userCoords} onNeedPhone={()=>setShowSettings(true)}/></div>
        )}

        {tab === "profile" && (
          isGuest
            ? <div style={{textAlign:"center",padding:"56px 20px"}}>
                <Icon name="user" size={46} color={C.accent} style={{margin:"0 auto 12px"}}/>
                <div style={{fontSize:17,fontWeight:700,color:C.ink,marginBottom:8}}>אתם גולשים כאורחים</div>
                <div style={{fontSize:13,color:C.muted,marginBottom:16}}>הירשמו כדי לפרסם, לשמור ספרים ולפנות למפרסמים</div>
                <Btn variant="accent" onClick={onGuestAction}>הצטרפות</Btn>
              </div>
            : <div key="profile-content" style={{animation:"fadeUp .25s ease",paddingTop:18}}>
                <div style={{background:"#fff",borderRadius:24,padding:"22px 18px 18px",boxShadow:"0 4px 18px rgba(30,45,61,.06)",textAlign:"center"}}>
                  <label style={{position:"relative",display:"inline-block",cursor:"pointer"}} aria-label="החלפת תמונת פרופיל">
                    {avatarEl(84)}
                    <span style={{position:"absolute",bottom:0,left:0,width:28,height:28,borderRadius:"50%",background:C.accent,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",border:"3px solid #fff"}}><Icon name="camera" size={14} stroke={2.2}/></span>
                    <input type="file" accept="image/*" style={{display:"none"}} onChange={onAvatarFile}/>
                  </label>
                  <div style={{fontSize:21,fontWeight:800,color:C.ink,marginTop:10}}>{user?.storeName||user?.name}</div>
                  {user?.bio
                    ? <button onClick={()=>{setBioText(user.bio);setEditBio(true);}} style={{background:"none",border:"none",fontSize:14,color:C.muted,marginTop:4,cursor:"pointer",lineHeight:1.5}}>{user.bio}</button>
                    : <button onClick={()=>{setBioText("");setEditBio(true);}} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:13,color:C.accent,background:"none",border:"none",cursor:"pointer",marginTop:4,fontWeight:600}}><Icon name="pencil" size={14}/>כמה מילים עלי</button>}
                  {!user?.phone && <div style={{marginTop:10}}><button onClick={()=>setShowSettings(true)} style={{fontSize:13,color:C.red,background:C.redL,border:"none",borderRadius:10,padding:"7px 12px",cursor:"pointer",fontWeight:600}}>הוסיפו טלפון כדי לפרסם ספרים</button></div>}
                  <div style={{display:"flex",justifyContent:"center",gap:0,marginTop:16,borderTop:`1px solid ${C.border}`,paddingTop:14}}>
                    {[["על המדף",shelf.length],["שמורים",favBooks.length],["עברו הלאה",past.length]].map(([l,n],i)=>(
                      <div key={l} style={{flex:1,borderInlineStart:i?`1px solid ${C.border}`:"none"}}>
                        <div style={{fontSize:20,fontWeight:800,color:C.ink}}>{n}</div>
                        <div style={{fontSize:12,color:C.muted}}>{l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:14}}>
                    <button className="press" onClick={()=>setShowSettings(true)} style={{display:"flex",alignItems:"center",gap:6,padding:"9px 14px",borderRadius:12,border:`1px solid ${C.border}`,background:C.paper,fontSize:13,fontWeight:600,color:C.ink,cursor:"pointer"}}><Icon name="settings" size={16}/>פרטים והגדרות</button>
                    <button className="press" onClick={()=>setViewUserId(user.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"9px 14px",borderRadius:12,border:`1px solid ${C.border}`,background:C.paper,fontSize:13,fontWeight:600,color:C.ink,cursor:"pointer"}}><Icon name="eye" size={16}/>הפרופיל הציבורי</button>
                  </div>
                </div>

                <div role="tablist" style={{display:"flex",gap:4,background:"#EAE4D8",borderRadius:14,padding:4,margin:"20px 0 16px"}}>
                  {[["shelf","המדף שלי"],["saved","שמורים"],["past","עברו הלאה"]].map(([k,l])=>(
                    <button key={k} role="tab" aria-selected={profTab===k} onClick={()=>setProfTab(k)}
                      style={{flex:1,padding:"9px 6px",borderRadius:11,border:"none",cursor:"pointer",fontSize:14,fontWeight:profTab===k?700:500,background:profTab===k?"#fff":"transparent",color:profTab===k?C.ink:C.muted,boxShadow:profTab===k?"0 1px 4px rgba(0,0,0,.08)":"none",transition:"all .15s"}}>{l}</button>
                  ))}
                </div>
                {(()=>{
                  const list = profTab==="shelf"?shelf:profTab==="saved"?favBooks:past;
                  if (!list.length) return (
                    <div style={{textAlign:"center",padding:"30px 16px",background:"#fff",borderRadius:20,border:`1px dashed ${C.border}`}}>
                      <Icon name={profTab==="saved"?"heart":profTab==="past"?"loop":"shelf"} size={38} color={C.accent} style={{margin:"0 auto 10px"}}/>
                      <div style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:6}}>{profTab==="shelf"?"המדף שלך עוד ריק":profTab==="saved"?"עוד לא שמרת ספרים":"עוד לא העברת ספרים הלאה"}</div>
                      <div style={{fontSize:13,color:C.muted,marginBottom:profTab==="shelf"?14:0}}>{profTab==="shelf"?"צלמו כריכה והפרטים יתמלאו לבד":profTab==="saved"?"לחצו על הלב בספר שמעניין אתכם":"כשתסגרו עסקה, הספר יופיע כאן"}</div>
                      {profTab==="shelf"&&<Btn onClick={()=>goTab("add")}>הוספת ספר</Btn>}
                    </div>
                  );
                  return <div className="grid2">{list.map(b=><BookTile key={b.id} book={b} onOpen={openBook} fav={favIds.has(b.id)} onFav={toggleFav} user={user}/>)}</div>;
                })()}
              </div>
        )}
      </main>
        {showWishModal && (
          <div style={{position:"fixed",inset:0,zIndex:800,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"flex-end"}} onClick={()=>setShowWishModal(false)}>
            <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"20px",width:"100%",maxHeight:"70vh",overflowY:"auto",direction:"rtl"}} onClick={e=>e.stopPropagation()}>
              <div style={{fontSize:16,fontWeight:800,marginBottom:4,color:"#1E2D3D"}}>בחר את הספר שחיפשת</div>
              <div style={{fontSize:12,color:"#7a8a7a",marginBottom:10}}>נודיע לך כשהספר יתווסף לפלטפורמה</div>
              <div style={{display:"flex",gap:8,marginBottom:14}}>
                <input value={wishQuery} onChange={e=>setWishQuery(e.target.value)} placeholder="שם ספר, מחבר..." style={{flex:1,padding:"8px 12px",borderRadius:8,border:"1px solid #dde5d8",fontSize:13,direction:"rtl"}}/>
                <button onClick={async()=>{setWishLoading(true);setWishResults([]);try{const d=await api.get("/api/books/search-google?q="+encodeURIComponent(wishQuery));setWishResults(Array.isArray(d)?d:[]);}catch{}setWishLoading(false);}} style={{padding:"8px 14px",background:"#6B8F47",color:"#fff",border:"none",borderRadius:8,fontSize:13,cursor:"pointer"}}>חפש</button>
              </div>
              {wishLoading && <div style={{textAlign:"center",padding:30,color:"#7a8a7a"}}>טוען...</div>}
              {!wishLoading && wishResults.length===0 && <div style={{textAlign:"center",padding:"24px 10px",color:"#7a8a7a"}}>
                <div style={{marginBottom:12}}>לא מצאנו את הספר בקטלוג</div>
                {wishQuery.trim().length>1&&<button onClick={async()=>{try{await api.post("/api/wishlist",{query:wishQuery});toast_("🔔 נעדכן אותך כש\""+wishQuery+"\" יתפרסם");setShowWishModal(false);}catch(e){toast_(e.message,"err");}}} style={{padding:"10px 18px",background:C.accent,color:"#fff",border:"none",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer"}}>עדכנו אותי על "{wishQuery}"</button>}
              </div>}
              {!wishLoading && wishResults.map(b=>(
                <div key={b.googleId} onClick={async()=>{try{await api.post("/api/wishlist",{query:b.title});toast_("🔔 נשלח לך מייל כש\""+b.title+"\" יתפרסם");setShowWishModal(false);}catch(e){toast_(e.message,"err");}}} style={{display:"flex",gap:12,padding:"10px 0",borderBottom:"1px solid #eee",cursor:"pointer",alignItems:"center"}}>
                  {b.thumbnail?<img src={b.thumbnail} alt="" style={{width:40,height:56,objectFit:"cover",borderRadius:4}}/>:<div style={{width:40,height:56,background:"#e0ddd8",borderRadius:4}}/>}
                  <div>
                    <div style={{fontSize:14,fontWeight:700,color:"#1E2D3D"}}>{b.title}</div>
                    <div style={{fontSize:12,color:"#7a8a7a"}}>{b.author}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {editBio && <div style={{position:"fixed",inset:0,zIndex:800,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"flex-end"}} onClick={()=>setEditBio(false)}>
          <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px",width:"100%",direction:"rtl"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>כמה מילים עלי ✏️</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:12}}>יוצג בפרופיל הציבורי שלך</div>
            <textarea aria-label="כמה מילים עלי" value={bioText} onChange={e=>setBioText(e.target.value.slice(0,150))} placeholder="" style={{width:"100%",minHeight:80,borderRadius:10,border:`1px solid ${C.border}`,padding:"10px 12px",fontSize:13,fontFamily:"inherit",resize:"none",direction:"rtl",boxSizing:"border-box"}}/>
            <div style={{fontSize:11,color:C.muted,textAlign:"left",marginBottom:12}}>{bioText.length}/150</div>
            <div style={{display:"flex",gap:10}}>
              <Btn onClick={async()=>{try{await api.put("/api/users/"+user.id+"/profile",{bio:bioText});const nu={...user,bio:bioText};setUser(nu);session.saveUser(nu);toast_("הפרופיל עודכן ✓");setEditBio(false);}catch(e){toast_(e.message,"err");}}} style={{flex:1}}>שמור</Btn>
              <Btn variant="outline" onClick={()=>setEditBio(false)} style={{flex:1}}>ביטול</Btn>
            </div>
          </div>
        </div>
          }

      {/* ניווט תחתון */}
      <nav aria-label="ניווט ראשי" style={{position:"sticky",bottom:0,zIndex:60,background:"rgba(255,255,255,.96)",backdropFilter:"saturate(1.4) blur(12px)",borderTop:`1px solid ${C.border}`,paddingBottom:"env(safe-area-inset-bottom)"}}>
        <div style={{display:"flex",maxWidth:560,margin:"0 auto"}}>
          {TABS.map(([id,ic,lb])=>{
            const a = tab===id;
            const isAdd = id==="add";
            return (
              <button key={id} aria-current={a?"page":undefined} onClick={()=>goTab(id)}
                style={{flex:1,padding:"8px 4px 9px",border:"none",background:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,color:a?C.ink:C.muted}}>
                {isAdd
                  ? <span style={{width:46,height:34,borderRadius:13,background:a?C.ink:C.accent,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 12px rgba(107,143,71,.35)",transition:"background .15s"}}><Icon name="plus" size={22} stroke={2.4}/></span>
                  : id==="profile" && user?.avatar && !isGuest
                    ? <span style={{width:28,height:28,borderRadius:"50%",overflow:"hidden",border:a?`2px solid ${C.ink}`:"2px solid transparent"}}><img src={user.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/></span>
                    : <span style={{height:28,display:"flex",alignItems:"center"}}><Icon name={ic} size={25} stroke={a?2.2:1.8} fill={a&&id==="search"?"rgba(30,45,61,.1)":"none"}/></span>}
                <span style={{fontSize:12,fontWeight:a?700:500}}>{lb}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <Toast t={toast}/>
      {legalSheet}
      {showContact && <ContactSheet user={user} isGuest={isGuest} onClose={()=>setShowContact(false)} toast_={toast_}/>}
      {showSettings && !isGuest && <SettingsSheet user={user} onClose={()=>setShowSettings(false)} toast_={toast_}
        onSaved={u=>{setUser(u);session.saveUser(u);}}
        onDeleted={()=>{resetUi();session.clear();setUser(null);setScreen("splash");toast_("החשבון נמחק");}}
        onShowLegal={setLegal}/>}
      {wishMatches.length>0 && tab==="search" && !viewBook && !pendingContact && !ownerPending && (
        <div style={{position:"fixed",bottom:80,left:0,right:0,zIndex:590,padding:"0 16px",direction:"rtl"}}>
          <div style={{maxWidth:480,margin:"0 auto",background:C.white,borderRadius:16,padding:"14px 16px",boxShadow:"0 6px 28px rgba(0,0,0,.18)",border:`1px solid ${C.border}`,animation:"fadeUp .25s ease"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:14,fontWeight:800,color:C.ink}}>🔔 ספר שחיכית לו זמין!</div>
              <button aria-label="סגירה" onClick={()=>setWishMatches([])} style={{background:"none",border:"none",fontSize:16,color:C.muted,cursor:"pointer"}}>✕</button>
            </div>
            {wishMatches.slice(0,2).map(m=>(
              <div key={m.wish.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"6px 0"}}>
                <button onClick={()=>{setViewBook(m.books[0]);}} style={{background:"none",border:"none",textAlign:"right",cursor:"pointer",color:C.ink,fontSize:14,fontWeight:600,padding:0,flex:1}}>{m.books[0].title} <span style={{color:C.muted,fontWeight:400,fontSize:12}}>· {m.books[0].ownername}</span></button>
                <button onClick={async()=>{try{await api.del(`/api/wishlist/${m.wish.id}`);}catch{}setWishMatches(p=>p.filter(x=>x.wish.id!==m.wish.id));}} style={{background:C.bg,border:"none",borderRadius:8,padding:"5px 10px",fontSize:12,color:C.muted,cursor:"pointer",whiteSpace:"nowrap"}}>הבנתי</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* תפריט המבורגר */}
      {menuOpen && (
        <Overlay onClose={()=>setMenuOpen(false)} label="תפריט" outerStyle={{position:"fixed",inset:0,zIndex:700,direction:"rtl"}}
          panelStyle={{position:"absolute",top:0,right:0,width:270,height:"100%",background:C.white,boxShadow:"-4px 0 24px rgba(0,0,0,.15)",display:"flex",flexDirection:"column",overflowY:"auto",animation:"slideIn .22s ease"}}>
            <div style={{background:HDR,padding:"32px 20px 20px"}}>
              <h2 style={{fontFamily:HEAD,fontSize:19,fontWeight:700,color:"#fff"}}>ספרייה שכונתית</h2>
              <div style={{fontSize:12,color:"rgba(255,255,255,.7)",marginTop:4}}>{isGuest?"Pageturner":`שלום, ${user?.name||""}`}</div>
            </div>
            <div style={{flex:1,padding:"12px 0"}}>
              {[
                {ic:"home",lb:"גילוי ספרים",ac:()=>{goTab("search");setMenuOpen(false);}},
                {ic:"camera",lb:"הוספת ספר",ac:()=>{goTab("add");setMenuOpen(false);}},
                {ic:"user",lb:"הפרופיל שלי",ac:()=>{goTab("profile");setMenuOpen(false);}},
                {ic:"info",lb:"אודות",ac:()=>{setShowAbout(true);setMenuOpen(false);}},
                {ic:"mail",lb:"צור קשר",ac:()=>{setShowContact(true);setMenuOpen(false);}},
                {ic:"lock",lb:"מדיניות פרטיות",ac:()=>{setLegal("privacy");setMenuOpen(false);}},
                {ic:"doc",lb:"תנאי שימוש",ac:()=>{setLegal("terms");setMenuOpen(false);}},
                {ic:"access",lb:"הצהרת נגישות",ac:()=>{setLegal("accessibility");setMenuOpen(false);}},
              ].map((item,i)=>(
                <button key={i} onClick={item.ac} style={{width:"100%",padding:"14px 20px",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:12,fontSize:15,fontWeight:600,color:C.ink,textAlign:"right"}}>
                  <span style={{width:36,height:36,borderRadius:11,background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",color:C.ink}}><Icon name={item.ic} size={19}/></span>{item.lb}
                </button>
              ))}
            </div>
            {isGuest && <button onClick={()=>{setMenuOpen(false);session.clear();setUser(null);setScreen("splash");}} style={{padding:"16px 20px",background:"none",border:"none",borderTop:`1px solid ${C.border}`,cursor:"pointer",display:"flex",alignItems:"center",gap:12,fontSize:14,fontWeight:600,color:C.ink,textAlign:"right"}}><Icon name="user" size={19}/>הרשמה / כניסה</button>}
            {!isGuest && <button onClick={logout} style={{padding:"16px 20px",background:"none",border:"none",borderTop:`1px solid ${C.border}`,cursor:"pointer",display:"flex",alignItems:"center",gap:12,fontSize:14,fontWeight:600,color:C.red,textAlign:"right"}}>
              <Icon name="logout" size={19}/>יציאה
            </button>}
        </Overlay>
      )}

      {/* דף אודות */}
      {showAbout && (
        <Overlay onClose={()=>setShowAbout(false)} label="אודות" outerStyle={{position:"fixed",inset:0,zIndex:700,background:"rgba(14,12,8,.7)",display:"flex",alignItems:"flex-end",direction:"rtl"}}
          panelStyle={{width:"100%",maxWidth:480,margin:"0 auto",background:C.white,borderRadius:"22px 22px 0 0",maxHeight:"85vh",overflowY:"auto",padding:"24px 20px 40px"}}>
            <div style={{width:32,height:4,borderRadius:99,background:C.border,margin:"0 auto 20px"}}/>
            <div style={{fontFamily:HEAD,fontSize:22,fontWeight:700,color:C.ink,marginBottom:6}}>ספרייה שכונתית | Pageturner</div>
            <div style={{fontSize:16,fontWeight:700,color:C.ink,marginTop:20,marginBottom:8}}>הסיפור התחיל עם ספר אחד</div>
            <div style={{fontSize:14,color:C.muted,lineHeight:1.8,marginBottom:16}}>חיפשתי ספר. ידעתי שהוא קיים, ראיתי שיש אותו אצל אנשים, אבל מצוא לא מצאתי. יצרתי קשר, שלחתי הודעות, ואפילו נסעתי רק כדי לגלות שהוא כבר עבר הלאה. המסע הזה עדיין לא נגמר, אבל משהו אחר כן התחיל.</div>
            <div style={{fontSize:16,fontWeight:700,color:C.ink,marginBottom:8}}>מה זה Pageturner?</div>
            <div style={{fontSize:14,color:C.muted,lineHeight:1.8,marginBottom:16}}>Page Turner באנגלית זה ספר שאי אפשר להפסיק לקרוא, כזה שאתה הופך דף אחרי דף בלי לעצור. זה גם מה שאנחנו רוצים שתרגיש כאן.</div>
            <div style={{fontSize:16,fontWeight:700,color:C.ink,marginBottom:8}}>הספרייה השכונתית</div>
            <div style={{fontSize:14,color:C.muted,lineHeight:1.8,marginBottom:24}}>כולנו מחזיקים ספרים שסיימנו, ספרים שכנראה לא נקרא, וספרים שמישהו אחר ממש עכשיו מחפש. הספרייה השכונתית הופכת את המדפים הביתיים של השכונה למדף אחד משותף, מקום למכור, להחליף, להשאיל או לתת ספרים לשכנים שלך. ואולי גם להכיר אנשים חדשים בדרך.</div>
            <button onClick={()=>setShowAbout(false)} style={{width:"100%",padding:"13px",borderRadius:12,background:C.ink,color:"#fff",border:"none",fontSize:15,fontWeight:700,cursor:"pointer"}}>סגור</button>
        </Overlay>
      )}
      {pendingContact && !pendingContact.askdeal && (
        <div style={{position:"fixed",bottom:80,left:0,right:0,zIndex:600,padding:"0 16px",direction:"rtl"}}>
          <div style={{background:C.white,borderRadius:16,padding:"16px",boxShadow:"0 4px 24px rgba(0,0,0,.15)",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:13,fontWeight:700,color:C.ink,marginBottom:12}}>
              יצרת קשר לגבי "{pendingContact.booktitle||pendingContact.bookid}" — האם סיכמתם משהו?
            </div>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <button onClick={()=>setAskDealMode(true)} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:C.teal,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>כן, סיכמנו</button>
              <button onClick={()=>handleContactAnswer("no")} style={{flex:1,padding:"10px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,fontSize:13,fontWeight:600,cursor:"pointer",color:C.muted}}>עוד לא</button>
            </div>
            <button onClick={()=>handleContactAnswer("skip")} style={{width:"100%",padding:"7px",borderRadius:9,border:"none",background:"none",color:C.muted,fontSize:12,cursor:"pointer"}}>אל תשאלו אותי שוב על הספר הזה</button>
          </div>
        </div>
      )}
      {pendingContact && askDealMode && (
        <div style={{position:"fixed",bottom:80,left:0,right:0,zIndex:600,padding:"0 16px",direction:"rtl"}}>
          <div style={{background:C.white,borderRadius:16,padding:"16px",boxShadow:"0 4px 24px rgba(0,0,0,.15)",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:13,fontWeight:700,color:C.ink,marginBottom:12,textAlign:"center"}}>מה סיכמתם?</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{s:"sold",ic:"tag",t:"מכירה"},{s:"lent",ic:"loop",t:"השאלה"},{s:"swapped",ic:"swap",t:"החלפה"},{s:"given",ic:"gift",t:"מסירה"}].map(o=>(
                <button key={o.s} onClick={()=>{handleContactAnswer("done",o.s);setAskDealMode(false);}} style={{padding:"12px 8px",borderRadius:11,border:`1px solid ${C.border}`,background:C.white,cursor:"pointer",fontSize:12,fontWeight:700,color:C.ink}}>
                  <div style={{display:"flex",justifyContent:"center",marginBottom:5}}><Icon name={o.ic} size={22}/></div>{o.t}
                </button>
              ))}
            </div>
            <button onClick={()=>setAskDealMode(false)} style={{width:"100%",marginTop:10,padding:"7px",borderRadius:9,border:"none",background:"none",color:C.muted,fontSize:12,cursor:"pointer"}}>חזרה</button>
          </div>
        </div>
      )}
    {ownerPending && !ownerAskDeal && (
        <div style={{position:"fixed",bottom:80,left:0,right:0,zIndex:600,padding:"0 16px",direction:"rtl"}}>
          <div style={{background:C.white,borderRadius:16,padding:"16px",boxShadow:"0 4px 24px rgba(0,0,0,.15)",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:13,fontWeight:700,color:C.ink,marginBottom:12}}>
              {ownerPending.interestedname||"מישהו"} יצר איתך קשר לגבי "{ownerPending.booktitle}" — האם סיכמתם משהו?
            </div>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <button onClick={()=>setOwnerAskDeal(true)} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:C.teal,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>כן, סיכמנו</button>
              <button onClick={()=>handleOwnerAnswer("no")} style={{flex:1,padding:"10px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,fontSize:13,fontWeight:600,cursor:"pointer",color:C.muted}}>עוד לא</button>
            </div>
          </div>
        </div>
      )}
      {ownerPending && ownerAskDeal && (
        <div style={{position:"fixed",bottom:80,left:0,right:0,zIndex:600,padding:"0 16px",direction:"rtl"}}>
          <div style={{background:C.white,borderRadius:16,padding:"16px",boxShadow:"0 4px 24px rgba(0,0,0,.15)",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:13,fontWeight:700,color:C.ink,marginBottom:12,textAlign:"center"}}>מה סיכמתם?</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{s:"sold",ic:"tag",t:"מכירה"},{s:"lent",ic:"loop",t:"השאלה"},{s:"swapped",ic:"swap",t:"החלפה"},{s:"given",ic:"gift",t:"מסירה"}].map(o=>(
                <button key={o.s} onClick={()=>handleOwnerAnswer("confirmed", o.s)} style={{padding:"12px 8px",borderRadius:11,border:`1px solid ${C.border}`,background:C.white,cursor:"pointer",fontSize:12,fontWeight:700,color:C.ink}}>
                  <div style={{display:"flex",justifyContent:"center",marginBottom:5}}><Icon name={o.ic} size={22}/></div>{o.t}
                </button>
              ))}
            </div>
            <button onClick={()=>setOwnerAskDeal(false)} style={{width:"100%",marginTop:10,padding:"7px",borderRadius:9,border:"none",background:"none",color:C.muted,fontSize:12,cursor:"pointer"}}>חזרה</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── כרטיס ספר ──────────────────────────────────────────────


function Sheet({ title, onClose, children }) {
  const dref = useDialog(onClose);
  return (
    <div style={{position:"fixed",inset:0,zIndex:850,background:"rgba(14,12,8,.6)",display:"flex",alignItems:"flex-end",direction:"rtl"}} onClick={onClose}>
      <div ref={dref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} style={{outline:"none",width:"100%",maxWidth:520,margin:"0 auto",background:C.white,borderRadius:"22px 22px 0 0",maxHeight:"90vh",overflowY:"auto",padding:"20px 18px 28px",animation:"sheetUp .28s cubic-bezier(.33,1,.68,1)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h2 style={{fontSize:18,fontWeight:800,color:C.ink}}>{title}</h2>
          <button aria-label="סגירה" onClick={onClose} style={{background:C.bg,border:"none",borderRadius:9,width:32,height:32,cursor:"pointer",fontSize:16}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ContactSheet({ user, isGuest, onClose, toast_ }) {
  const [msg, setMsg] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    try {
      await api.post("/api/feedback", { message: msg, email: isGuest ? email : undefined });
      toast_("ההודעה נשלחה, תודה! נחזור אליך בהקדם"); onClose();
    } catch(e) { toast_(e.message, "err"); }
    setSending(false);
  };
  return (
    <Sheet title="צור קשר" onClose={onClose}>
      <div style={{fontSize:13,color:C.muted,marginBottom:14,lineHeight:1.6}}>
        שאלה, הצעה, בעיה באתר או בקשה לגבי המידע שלך. אפשר גם לכתוב לנו ישירות ל-<span style={{direction:"ltr",display:"inline-block",color:C.ink,fontWeight:600}}>pageturner.team@gmail.com</span>
        {!isGuest&&user?.email&&<div style={{marginTop:6,fontSize:12}}>התשובה תישלח לכתובת שלך: <span style={{direction:"ltr",display:"inline-block"}}>{user.email}</span></div>}
      </div>
      {isGuest && <Inp label="המייל שלך (לתשובה)" value={email} onChange={e=>setEmail(e.target.value)} type="email" inputMode="email" placeholder="email@example.com"/>}
      <TA label="ההודעה" value={msg} onChange={e=>setMsg(e.target.value.slice(0,3000))} placeholder="כתבו כאן..."/>
      <Btn onClick={send} disabled={sending||msg.trim().length<3} style={{width:"100%",padding:"14px"}}>{sending?"שולח...":"שליחה"}</Btn>
    </Sheet>
  );
}

function SettingsSheet({ user, onClose, toast_, onSaved, onDeleted, onShowLegal }) {
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [consent, setConsent] = useState(!!user?.emailConsent);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState("");
  const [deleting, setDeleting] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const d = await api.put("/api/me", { name, phone, emailConsent: consent });
      onSaved(d.user); toast_("הפרטים נשמרו ✓"); onClose();
    } catch(e) { toast_(e.message, "err"); }
    setSaving(false);
  };
  const del = async () => {
    setDeleting(true);
    try { await api.del("/api/me"); onDeleted(); }
    catch(e) { toast_(e.message, "err"); setDeleting(false); }
  };
  return (
    <Sheet title="פרטים והגדרות" onClose={onClose}>
      <Inp label="שם" value={name} onChange={e=>setName(e.target.value)} icon="user" autoComplete="name"/>
      <Inp label="טלפון" value={phone} onChange={e=>setPhone(e.target.value)} icon="phone" type="tel" inputMode="tel" placeholder="050-0000000" autoComplete="tel"/>
      <div style={{fontSize:11,color:C.muted,marginTop:-8,marginBottom:12}}>מוצג רק למשתמשים רשומים שפונים אליך לגבי ספר</div>
      <label style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:13,color:C.ink,lineHeight:1.5,cursor:"pointer",marginBottom:16}}>
        <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} style={{marginTop:3,width:18,height:18,accentColor:C.accent,flexShrink:0}}/>
        <span>לקבל עדכונים על ספרים חדשים בשכונה</span>
      </label>
      <Btn onClick={save} disabled={saving||!name.trim()} style={{width:"100%",padding:"14px"}}>{saving?"שומר...":"שמירה"}</Btn>
      <div style={{fontSize:12,color:C.muted,textAlign:"center",marginTop:12}}>
        <button onClick={()=>onShowLegal("privacy")} style={linkBtn}>מדיניות פרטיות</button> · <button onClick={()=>onShowLegal("terms")} style={linkBtn}>תנאי שימוש</button> · <button onClick={()=>onShowLegal("accessibility")} style={linkBtn}>הצהרת נגישות</button>
      </div>
      <div style={{marginTop:22,paddingTop:16,borderTop:`1px solid ${C.border}`}}>
        <div style={{fontSize:14,fontWeight:700,color:C.red,marginBottom:6}}>מחיקת חשבון</div>
        <div style={{fontSize:12,color:C.muted,lineHeight:1.6,marginBottom:10}}>החשבון, כל הספרים שפרסמת והמשאלות יימחקו לצמיתות. אי אפשר לבטל.</div>
        <Inp label='כדי לאשר, הקלידו "מחק"' value={confirmDel} onChange={e=>setConfirmDel(e.target.value)}/>
        <Btn variant="red" onClick={del} disabled={confirmDel.trim()!=="מחק"||deleting} style={{width:"100%",padding:"12px"}}>{deleting?"מוחק...":"מחיקת החשבון לצמיתות"}</Btn>
      </div>
    </Sheet>
  );
}

function AdminPage({ onBack }) {
  const [key, setKey] = useState("");
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(BASE + "/api/admin/stats", { headers: { "x-admin-key": key } });
      const d = await safeJson(r);
      if (!r.ok) { setError(r.status === 401 ? "סיסמה שגויה" : d.error || "שגיאה"); return; }
      setStats(d);
    } catch(e) { setError("שגיאה: " + e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{minHeight:"100vh",background:"#0e0c08",padding:20,direction:"rtl",color:"#fff"}}>
      <button onClick={onBack} style={{background:"none",border:"none",color:"rgba(255,255,255,.6)",cursor:"pointer",fontSize:14,marginBottom:20}}>→ חזרה</button>
      <div style={{fontFamily:HEAD,fontSize:24,fontWeight:700,marginBottom:20}}>📊 Admin Panel</div>
      
      {!stats ? (
        <div>
          <input value={key} onChange={e=>setKey(e.target.value)} placeholder="הכנס סיסמת Admin" type="password"
            style={{width:"100%",padding:12,borderRadius:10,border:"1px solid rgba(255,255,255,.2)",background:"rgba(255,255,255,.1)",color:"#fff",fontSize:14,marginBottom:10,boxSizing:"border-box"}}/>
          <button onClick={load} disabled={loading} style={{width:"100%",padding:12,borderRadius:10,background:"#b5390e",color:"#fff",border:"none",fontSize:15,fontWeight:700,cursor:"pointer"}}>
            {loading ? "טוען..." : "כניסה"}
          </button>
          {error && <div style={{color:"#f87171",marginTop:10,fontSize:13}}>{error}</div>}
        </div>
      ) : (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20}}>
            {[
              {l:"משתמשים",v:stats.totals.users,ic:"👥"},
              {l:"ספרים פעילים",v:stats.totals.books,ic:"📚"},
              {l:"עסקאות",v:stats.totals.deals,ic:"🤝"},
            ].map(s=>(
              <div key={s.l} style={{background:"rgba(255,255,255,.08)",borderRadius:12,padding:14,textAlign:"center"}}>
                <div style={{fontSize:24}}>{s.ic}</div>
                <div style={{fontSize:22,fontWeight:900,marginTop:4}}>{s.v}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.5)",marginTop:2}}>{s.l}</div>
              </div>
            ))}
          </div>

          <div style={{background:"rgba(255,255,255,.08)",borderRadius:12,padding:14,marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>📅 היום</div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span>הרשמות חדשות: <b>{stats.today.users}</b></span>
              <span>ספרים חדשים: <b>{stats.today.books}</b></span>
            </div>
          </div>

          <div style={{background:"rgba(255,255,255,.08)",borderRadius:12,padding:14,marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>📆 שבוע אחרון</div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span>הרשמות: <b>{stats.week.users}</b></span>
              <span>ספרים: <b>{stats.week.books}</b></span>
            </div>
          </div>

          <div style={{background:"rgba(255,255,255,.08)",borderRadius:12,padding:14,marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>🗓️ חודש אחרון</div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span>הרשמות: <b>{stats.month.users}</b></span>
              <span>ספרים: <b>{stats.month.books}</b></span>
            </div>
          </div>

          <div style={{background:"rgba(255,255,255,.08)",borderRadius:12,padding:14,marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>📍 ערים פעילות</div>
            {stats.cities.map(c=>(
              <div key={c.city} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,.08)"}}>
                <span>{c.city}</span><span style={{fontWeight:700}}>{c.cnt}</span>
              </div>
            ))}
          </div>

          <button onClick={load} style={{width:"100%",padding:10,borderRadius:10,background:"rgba(255,255,255,.1)",color:"#fff",border:"none",fontSize:13,cursor:"pointer",marginBottom:10}}>🔄 רענן</button>
        </div>
      )}
    </div>
  );
}

function UserPage({ userId, me, onClose, onViewBook, favs, onFav }) {
  const [profile, setProfile] = useState(null);
  const [allBooks, setAllBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tabK, setTabK] = useState("avail");

  useEffect(() => {
    setLoading(true); setProfile(null); setAllBooks([]);
    Promise.all([
      api.get("/api/users/"+encodeURIComponent(userId)).catch(()=>null),
      api.get("/api/books?ownerId="+encodeURIComponent(userId)+"&all=true").catch(()=>[])
    ]).then(([u,b])=>{ setProfile(u||{}); setAllBooks(Array.isArray(b)?b:[]); setLoading(false); });
  }, [userId]);

  const availBooks = allBooks.filter(b=>b.avail);
  const pastBooks = allBooks.filter(b=>!b.avail&&b.dealstatus);
  const city = allBooks.reduce((acc,b)=>{ if(b.city){acc[b.city]=(acc[b.city]||0)+1;} return acc; }, {});
  const topCity = Object.keys(city).sort((a,b)=>city[b]-city[a])[0] || null;
  const since = profile?.createdAt ? new Date(Number(profile.createdAt)).toLocaleDateString("he-IL",{month:"long",year:"numeric"}) : null;
  const list = tabK==="avail" ? availBooks : pastBooks;
  const shareProfile = async () => {
    const url = `${location.origin}/?user=${userId}`;
    try { if (navigator.share) await navigator.share({ title: profile?.name, url }); else await navigator.clipboard.writeText(url); } catch {}
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:550,background:C.bg,overflowY:"auto",direction:"rtl",animation:"fadeUp .22s ease"}}>
      <div style={{background:"linear-gradient(160deg,#2F4858 0%,#1E2D3D 75%)",padding:"calc(14px + env(safe-area-inset-top)) 16px 28px",color:"#fff"}}>
        <div style={{display:"flex",justifyContent:"space-between",maxWidth:900,margin:"0 auto"}}>
          <button onClick={onClose} style={{display:"flex",alignItems:"center",gap:4,background:"rgba(255,255,255,.14)",border:"none",cursor:"pointer",color:"#fff",padding:"7px 13px 7px 10px",borderRadius:99,fontSize:14,fontWeight:600}}><Icon name="back" size={16} stroke={2.2}/>חזרה</button>
          <button onClick={shareProfile} aria-label="שיתוף המדף" style={{background:"rgba(255,255,255,.14)",border:"none",cursor:"pointer",color:"#fff",width:36,height:36,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="share" size={17}/></button>
        </div>
        <div style={{textAlign:"center",marginTop:10}}>
          <div style={{width:92,height:92,borderRadius:"50%",margin:"0 auto",overflow:"hidden",border:"3px solid rgba(255,255,255,.35)",background:"linear-gradient(135deg,#6B8F47,#2F4858)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,fontWeight:800}}>
            {loading ? null : profile?.avatar ? <img src={profile.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <Icon name="user" size={48} stroke={1.8}/>}
          </div>
          {loading ? <div className="skel" style={{width:140,height:22,borderRadius:8,margin:"12px auto 0",opacity:.3}}/> : <>
            <div style={{fontFamily:HEAD,fontSize:26,fontWeight:700,marginTop:10}}>{profile?.storeName||profile?.name||"משתמש"}</div>
            {profile?.bio && <div style={{fontSize:14,opacity:.8,marginTop:6,padding:"0 20px",lineHeight:1.5}}>{profile.bio}</div>}
            <div style={{display:"flex",justifyContent:"center",gap:14,marginTop:8,fontSize:12.5,opacity:.65}}>
              {topCity && <span style={{display:"flex",alignItems:"center",gap:4}}><Icon name="pin" size={13}/>{topCity}</span>}
              {since && <span>בספרייה מ{since}</span>}
            </div>
          </>}
        </div>
      </div>

      <div style={{padding:"0 16px 30px",maxWidth:900,margin:"-16px auto 0"}}>
        <div role="tablist" style={{display:"flex",gap:4,background:"#fff",borderRadius:14,padding:4,boxShadow:"0 4px 14px rgba(30,45,61,.08)",marginBottom:18,position:"relative"}}>
          {[["avail",`על המדף · ${availBooks.length}`],["past",`עברו דרכו · ${pastBooks.length}`]].map(([k,l])=>(
            <button key={k} role="tab" aria-selected={tabK===k} onClick={()=>setTabK(k)}
              style={{flex:1,padding:"10px 6px",borderRadius:11,border:"none",cursor:"pointer",fontSize:14,fontWeight:tabK===k?700:500,background:tabK===k?C.ink:"transparent",color:tabK===k?"#fff":C.muted,transition:"all .15s"}}>{l}</button>
          ))}
        </div>
        {loading ? (
          <div className="grid2">{[0,1,2,3].map(i=><TileSkeleton key={i}/>)}</div>
        ) : list.length ? (
          <div className="grid2">{list.map(b=><BookTile key={b.id} book={b} onOpen={onViewBook} fav={favs?.has(b.id)} onFav={onFav} user={me}/>)}</div>
        ) : (
          <div style={{textAlign:"center",padding:"40px 20px",color:C.muted}}>
            <Icon name="shelf" size={40} color={C.faint} style={{margin:"0 auto 10px"}}/>
            <div style={{fontSize:14}}>{tabK==="avail"?"אין כרגע ספרים על המדף":"עוד לא עברו ספרים"}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReportSheet({ book, onClose, toast_ }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const opts = [["image","תמונה לא הולמת"],["notbook","זה לא ספר"],["misleading","מודעה מטעה"],["other","אחר"]];
  const send = async () => {
    if (!reason) return;
    setSending(true);
    try { await api.post(`/api/books/${book.id}/report`, { reason, note }); toast_("תודה על הדיווח, נבדוק את המודעה"); onClose(); }
    catch (e) { toast_(e.message, "err"); }
    finally { setSending(false); }
  };
  return (
    <Overlay onClose={onClose} label="דיווח על מודעה" outerStyle={{position:"fixed",inset:0,zIndex:950,background:"rgba(14,12,8,.6)",display:"flex",alignItems:"flex-end",direction:"rtl"}}
      panelStyle={{width:"100%",maxWidth:520,margin:"0 auto",background:C.white,borderRadius:"22px 22px 0 0",padding:"20px 18px calc(24px + env(safe-area-inset-bottom))",animation:"sheetUp .28s cubic-bezier(.33,1,.68,1)"}}>
      <h2 style={{fontSize:18,fontWeight:800,color:C.ink}}>דיווח על המודעה</h2>
      <p style={{fontSize:13,color:C.muted,margin:"4px 0 14px"}}>הדיווח אנונימי למפרסם. מה הבעיה?</p>
      <div role="radiogroup" aria-label="סיבת הדיווח" style={{display:"grid",gap:8,marginBottom:12}}>
        {opts.map(([k,l])=>(
          <button key={k} role="radio" aria-checked={reason===k} onClick={()=>setReason(k)}
            style={{textAlign:"right",padding:"12px 14px",borderRadius:12,border:`1.5px solid ${reason===k?C.ink:C.border}`,background:reason===k?C.bg:"#fff",color:C.ink,fontSize:14,fontWeight:reason===k?700:500,cursor:"pointer"}}>{l}</button>
        ))}
      </div>
      <TA label="פרטים נוספים (לא חובה)" value={note} onChange={e=>setNote(e.target.value.slice(0,500))} placeholder=""/>
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={send} disabled={!reason||sending} style={{flex:1}}>{sending?"שולח...":"שליחת דיווח"}</Btn>
        <Btn variant="outline" onClick={onClose} style={{flex:1}}>ביטול</Btn>
      </div>
    </Overlay>
  );
}

function BookPage({ book, onClose, isGuest, onGuest, user, onBookUpdated, onContactMade, onViewUser, toast_, fav, onFav, more = [], onOpenBook }) {
  const [showCloseDeal, setShowCloseDeal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [phone, setPhone] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const [reporting, setReporting] = useState(false);
  const scrollRef = useRef(null);
  const dref = useDialog(onClose);
  const isOwner = !!user?.id && String(book.ownerid)===String(user?.id);
  const canContact = book.avail && !isGuest && !!user?.id && !isOwner;
  const src = book.thumbnail || book.frontimg;
  const color = hashColor(book.id);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); setExpanded(false); setShowCloseDeal(false); setShowPhoto(false); }, [book.id]);
  // מספר הטלפון נטען רק למשתמש מחובר שפתח את דף הספר
  useEffect(() => {
    setPhone(null);
    if (!canContact) return;
    api.get(`/api/books/${book.id}/phone`).then(d => setPhone(d.phone || "")).catch(e => { setPhone(""); if (e.status !== 401) toast_ && toast_(e.message, "warn"); });
  }, [book.id, canContact]);

  const recordContact = (type) => {
    if (!canContact) return;
    api.post("/api/contacts", { bookId: book.id, type }).then(() => onContactMade && onContactMade()).catch(() => {});
  };
  const closeDeal = async (status) => {
    setClosing(true);
    try {
      await api.put(`/api/books/${book.id}`, { avail: false, dealStatus: status });
      toast_ && toast_("עודכן. הספר ירד מהמדף ✓");
      onBookUpdated && onBookUpdated();
      onClose();
    } catch(e) { toast_ && toast_(e.message, "err"); }
    setClosing(false);
  };
  const share = async () => {
    const url = `${location.origin}/?book=${book.id}`;
    const text = `"${book.title}" ${MODES[book.mode]?.label ? "ל" + MODES[book.mode].label : ""} בספרייה השכונתית`;
    api.track("share", { bookId: book.id });
    try {
      if (navigator.share) await navigator.share({ title: book.title, text, url });
      else { await navigator.clipboard.writeText(url); toast_ && toast_("הקישור הועתק ✓"); }
    } catch {}
  };
  const waPhone = (phone || "").replace(/\D/g, "").replace(/^0/, "972");
  const name = book.ownername || "";
  const waMsg = `היי ${name}, ראיתי ב-Pageturner את "${book.title}". ` + (
    book.mode==="sell" ? "הוא עדיין זמין לרכישה?" : book.mode==="lend" ? "אפשר לשאול אותו?" : book.mode==="swap" ? "תרצה להחליף?" : "הוא עדיין זמין למסירה?");
  const chip = (ic, text) => <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 11px",borderRadius:99,background:C.bg,fontSize:12.5,color:C.ink,whiteSpace:"nowrap"}}><Icon name={ic} size={14} color={C.muted}/>{text}</span>;
  const long = (book.summary||"").length > 220;

  return (
    <div style={{position:"fixed",inset:0,zIndex:500,background:"rgba(14,12,8,.55)",display:"flex",alignItems:"flex-end",direction:"rtl"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div ref={dref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={book.title} style={{outline:"none",width:"100%",maxWidth:560,margin:"0 auto",background:"#fff",borderRadius:"26px 26px 0 0",height:"94vh",display:"flex",flexDirection:"column",overflow:"hidden",animation:"sheetUp .32s cubic-bezier(.2,.9,.3,1)"}}>
        <div ref={scrollRef} style={{flex:1,overflowY:"auto",overscrollBehavior:"contain"}}>
          {/* כריכה */}
          <div style={{position:"relative",padding:"18px 18px 22px",background:src?"#1E2D3D":`linear-gradient(160deg, ${color}, #1E2D3D)`,overflow:"hidden"}}>
            {src && <img src={src} alt="" aria-hidden="true" style={{position:"absolute",inset:-30,width:"calc(100% + 60px)",height:"calc(100% + 60px)",objectFit:"cover",filter:"blur(28px) saturate(1.2)",opacity:.55}}/>}
            <div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom, rgba(0,0,0,.05), rgba(0,0,0,.25))"}}/>
            <div style={{position:"relative",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{width:36,height:4,borderRadius:99,background:"rgba(255,255,255,.5)",position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)"}}/>
              <button onClick={onClose} aria-label="סגירה" style={{width:38,height:38,borderRadius:"50%",border:"none",background:"rgba(255,255,255,.9)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="close" size={18} stroke={2.2}/></button>
              <div style={{display:"flex",gap:8}}>
                <button onClick={share} aria-label="שיתוף" style={{width:38,height:38,borderRadius:"50%",border:"none",background:"rgba(255,255,255,.9)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="share" size={18}/></button>
                {!isOwner && <HeartButton active={fav} onToggle={onFav} size={38} floating/>}
              </div>
            </div>
            <div style={{position:"relative",width:showPhoto?220:150,aspectRatio:showPhoto?"3/4":"2/3",margin:"6px auto 0",borderRadius:12,boxShadow:"0 18px 40px rgba(0,0,0,.45)",filter:book.avail===false?"grayscale(.6)":"none",transition:"width .25s ease"}}>
              <Cover key={showPhoto?"p":"c"} book={showPhoto?{...book,thumbnail:book.photo}:book} radius={12} titleSize={17} eager/>
            </div>
            {book.photo && (
              <div style={{position:"relative",display:"flex",justifyContent:"center",gap:4,marginTop:14}}>
                <div style={{display:"flex",background:"rgba(0,0,0,.35)",borderRadius:99,padding:3,backdropFilter:"blur(6px)"}}>
                  {[[false,"כריכה"],[true,"צילום העותק"]].map(([v,l])=>(
                    <button key={l} onClick={()=>setShowPhoto(v)} aria-pressed={showPhoto===v}
                      style={{padding:"6px 13px",borderRadius:99,border:"none",cursor:"pointer",fontSize:12.5,fontWeight:700,background:showPhoto===v?"#fff":"transparent",color:showPhoto===v?C.ink:"#fff"}}>{l}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{padding:"18px 20px 24px"}}>
            <div style={{textAlign:"center"}}>
              <h1 style={{fontFamily:HEAD,fontSize:27,fontWeight:700,lineHeight:1.15,color:C.ink}}>{book.title}</h1>
              {book.author && <div style={{fontSize:15,color:C.muted,marginTop:6}}>{book.author}</div>}
              {(book.publisher||book.year) && <div style={{fontSize:12.5,color:C.faint,marginTop:3}}>{[book.publisher,book.year].filter(Boolean).join(" · ")}</div>}
              <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:10,marginTop:14}}>
                <ModeBadge mode={book.mode}/>
                {(book.mode==="sell"||book.mode==="give") && <span style={{fontSize:20,fontWeight:800,color:C.ink}}>{priceLine(book)}</span>}
              </div>
            </div>

            {!book.avail && <div style={{marginTop:16,textAlign:"center",padding:"11px",background:C.redL,borderRadius:12,color:C.red,fontWeight:700,fontSize:13}}>הספר כבר לא זמין</div>}

            <div style={{display:"flex",gap:7,flexWrap:"wrap",justifyContent:"center",marginTop:16}}>
              {book.condition && chip("sparkle", book.condition)}
              {book.km!=null&&!isNaN(book.km) && chip("pin", kmLabel(book,user))}
              {book.city && chip("home", book.city)}
              {book.genre && chip((GENRES.find(g=>g[0]===book.genre)||[])[1]||"novel", book.genre)}
              {book.mode==="lend"&&book.lenduntil && chip("loop", `להחזיר עד ${new Date(book.lenduntil).toLocaleDateString("he-IL")}`)}
              {book.mode==="swap"&&book.swapfor && chip("swap", `מחפש: ${book.swapfor}`)}
            </div>

            {book.summary && <div style={{marginTop:20}}>
              <div style={{fontSize:13,fontWeight:700,color:C.muted,marginBottom:6}}>על הספר</div>
              <div className={expanded||!long?"":"clamp4"} style={{fontSize:15,color:"#34404B",lineHeight:1.75}}>{book.summary}</div>
              {long && <button onClick={()=>setExpanded(x=>!x)} style={{background:"none",border:"none",color:C.accent,fontWeight:700,fontSize:13.5,cursor:"pointer",padding:"6px 0"}}>{expanded?"פחות":"קרא עוד"}</button>}
            </div>}

            <button className="press" onClick={()=>book.ownerid&&onViewUser&&onViewUser(book.ownerid)} style={{width:"100%",display:"flex",alignItems:"center",gap:12,background:C.paper,border:`1px solid ${C.border}`,borderRadius:16,padding:"12px 14px",marginTop:20,cursor:book.ownerid?"pointer":"default",textAlign:"right"}}>
              <div style={{width:44,height:44,borderRadius:"50%",background:`linear-gradient(135deg,#6B8F47,#2F4858)`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:18,flexShrink:0}}>
                {book.owneravatar ? <img src={book.owneravatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <Icon name="user" size={24} stroke={1.9}/>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,color:C.muted}}>{isOwner?"זה הספר שלך":"מפרסם/ת"}</div>
                <div className="clamp1" style={{fontSize:15.5,fontWeight:700,color:C.ink}}>{name||"משתמש"}</div>
              </div>
              {book.ownerid && <span style={{display:"flex",alignItems:"center",gap:2,fontSize:13,color:C.accent,fontWeight:600}}>למדף<Icon name="forward" size={16} stroke={2.2}/></span>}
            </button>

            {isOwner && !book.dealstatus && <div style={{marginTop:14}}>
              <div style={{display:"flex",gap:8}}>
                <button className="press" onClick={()=>{onClose();setTimeout(()=>document.dispatchEvent(new CustomEvent("editBook",{detail:book})),100);}} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"12px",borderRadius:13,border:`1px solid ${C.border}`,background:"#fff",fontSize:14,cursor:"pointer",color:C.ink,fontWeight:600}}><Icon name="pencil" size={17}/>עריכה</button>
                {book.avail && <button className="press" onClick={()=>setShowCloseDeal(x=>!x)} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"12px",borderRadius:13,border:"none",background:C.ink,fontSize:14,cursor:"pointer",color:"#fff",fontWeight:600}}><Icon name="check" size={17} stroke={2.3}/>הספר עבר הלאה</button>}
              </div>
              {showCloseDeal && <div style={{marginTop:10,background:C.bg,borderRadius:16,padding:"14px",animation:"fadeUp .2s ease"}}>
                <div style={{fontSize:14,fontWeight:700,color:C.ink,marginBottom:10,textAlign:"center"}}>מה קרה עם הספר?</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {[{s:"sold",ic:"tag",t:"נמכר"},{s:"lent",ic:"loop",t:"הושאל"},{s:"swapped",ic:"swap",t:"הוחלף"},{s:"given",ic:"gift",t:"נמסר"}].map(o=>(
                    <button key={o.s} className="press" onClick={()=>closeDeal(o.s)} disabled={closing} style={{padding:"12px 8px",borderRadius:12,border:`1px solid ${C.border}`,background:"#fff",cursor:"pointer",fontSize:13,fontWeight:700,color:C.ink,display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                      <Icon name={o.ic} size={22}/>{o.t}
                    </button>
                  ))}
                </div>
              </div>}
            </div>}

            {more.length>0 && <>
              <SectionHead title={`עוד מהמדף של ${name||"המפרסם"}`}/>
              <Rail books={more} onOpen={onOpenBook} user={user} w={112}/>
            </>}
            {isOwner && book.hidden && <div role="status" style={{marginTop:18,background:C.redL,color:C.red,borderRadius:12,padding:"12px 14px",fontSize:13,lineHeight:1.6}}>
              המודעה הוסתרה מהאתר בעקבות דיווחים. אם לדעתך זו טעות, אפשר לפנות אלינו דרך "צור קשר" בתפריט.
            </div>}
            {!isOwner && <div style={{textAlign:"center",marginTop:22}}>
              <button onClick={()=> (isGuest||!user?.id) ? onGuest() : setReporting(true)} style={{display:"inline-flex",alignItems:"center",gap:6,background:"none",border:"none",color:C.muted,fontSize:13,cursor:"pointer",padding:"8px 10px",textDecoration:"underline",textUnderlineOffset:3}}>
                <Icon name="flag" size={15}/>דיווח על מודעה לא הולמת
              </button>
            </div>}
          </div>
        </div>
        {reporting && <ReportSheet book={book} onClose={()=>setReporting(false)} toast_={toast_}/>}

        {/* פעולה ראשית */}
        {book.avail && !isOwner && (
          <div style={{padding:"12px 16px calc(12px + env(safe-area-inset-bottom))",borderTop:`1px solid ${C.border}`,background:"#fff",display:"flex",gap:10}}>
            {isGuest || !user?.id
              ? <Btn variant="accent" onClick={onGuest} style={{flex:1,padding:"15px",fontSize:15,borderRadius:14}}>הירשמו כדי לפנות למפרסם</Btn>
              : phone === null
                ? <div className="skel" style={{flex:1,height:50,borderRadius:14}}/>
                : phone
                  ? <>
                      <a href={`https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}`} target="_blank" rel="noreferrer" onClick={()=>recordContact("whatsapp")} className="press"
                        style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:9,padding:"14px",borderRadius:14,background:"#15803D",color:"#fff",textDecoration:"none",fontSize:15.5,fontWeight:700,boxShadow:"0 6px 16px rgba(34,179,94,.3)"}}>
                        <WhatsAppGlyph size={20}/>הודעה בוואטסאפ
                      </a>
                      <a href={`tel:${phone}`} aria-label="שיחת טלפון" onClick={()=>recordContact("phone")} className="press"
                        style={{width:54,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:14,background:C.bg,color:C.ink,border:`1px solid ${C.border}`}}>
                        <Icon name="phone" size={21}/>
                      </a>
                    </>
                  : <div style={{flex:1,textAlign:"center",padding:"14px",background:C.bg,borderRadius:14,color:C.muted,fontSize:13}}>אין למפרסם מספר טלפון זמין כרגע</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function kmLabel(book, user) {
  if (String(book.ownerid) === String(user?.id)) return "הספר שלך";
  if (book.km <= 0.5) return "פחות מק\"מ ממך";
  return `${book.km} ק"מ ממך`;
}

// ── עריכה/מחיקה ────────────────────────────────────────────
function EditDrawer({ book, onSave, onDelete, onCancel, toast_ }) {
  const [f, setF] = useState({
    title:book.title||"", author:book.author||"", publisher:book.publisher||"",
    year:book.year||"", summary:book.summary||"", condition:book.condition||"",
    mode:book.mode||"sell", price:book.price||"", avail:book.avail!==false,
    lendUntil:book.lenduntil||"", swapFor:book.swapfor||""
  });
  const [del, setDel] = useState(false);
  const [locStatus, setLocStatus] = useState(null);
  const upd = k => e => setF(p=>({...p,[k]:e.target.value}));

  const updateLocation = () => {
    if (!navigator.geolocation) return;
    setLocStatus("searching");
    navigator.geolocation.getCurrentPosition(
      pos => {
        setF(p=>({...p, lat: pos.coords.latitude, lng: pos.coords.longitude}));
        setLocStatus("done");
      },
      () => setLocStatus("error"),
      { enableHighAccuracy: false, timeout: 10000 }
    );
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:400,background:"rgba(14,12,8,.65)",display:"flex",alignItems:"flex-end",direction:"rtl"}} onClick={e=>e.target===e.currentTarget&&onCancel()}>
      <div style={{width:"100%",maxWidth:480,margin:"0 auto",background:C.white,borderRadius:"22px 22px 0 0",maxHeight:"92vh",overflowY:"auto",animation:"sheetUp .28s cubic-bezier(.33,1,.68,1)"}}>
        <div style={{padding:"12px 0 4px",display:"flex",justifyContent:"center"}}><div style={{width:32,height:4,borderRadius:99,background:C.border}}/></div>
        <div style={{padding:"4px 17px 30px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontSize:15,fontWeight:800,color:C.ink}}>✏️ עריכת ספר</div>
            <button onClick={onCancel} style={{background:C.bg,border:"none",borderRadius:9,width:30,height:30,cursor:"pointer",fontSize:16}}>✕</button>
          </div>
          <Inp label="שם הספר" value={f.title} onChange={upd("title")} icon="novel"/>
          <Inp label="מחבר" value={f.author} onChange={upd("author")} icon="quill"/>
          <div style={{display:"flex",gap:9}}>
            <div style={{flex:2}}><Inp label="הוצאה" value={f.publisher} onChange={upd("publisher")}/></div>
            <div style={{flex:1}}><Inp label="שנה" value={f.year} onChange={upd("year")}/></div>
          </div>
          <TA label="תקציר" value={f.summary} onChange={upd("summary")}/>
          <Inp label="מצב" value={f.condition} onChange={upd("condition")} icon="sparkle"/>
          <button onClick={updateLocation} style={{width:"100%",padding:"11px",borderRadius:11,border:`1px solid ${C.border}`,background:C.bg,fontSize:13,cursor:"pointer",color:locStatus==="done"?C.green:locStatus==="error"?C.red:C.muted,marginBottom:13,fontWeight:600,textAlign:"right"}}>
            {locStatus==="searching"?"⏳ מאתר מיקום...":locStatus==="done"?"✅ המיקום עודכן בהצלחה":locStatus==="error"?"❌ לא ניתן לאתר מיקום":"📍 עדכון מיקום הספר למיקומך הנוכחי"}
          </button>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",background:C.bg,borderRadius:10,marginBottom:13}}>
            <span style={{fontSize:13,fontWeight:600}}>זמין</span>
            <div onClick={()=>setF(p=>({...p,avail:!p.avail}))} style={{width:42,height:22,borderRadius:99,background:f.avail?C.teal:C.border,position:"relative",cursor:"pointer",transition:"background .18s"}}>
              <div style={{position:"absolute",top:3,left:f.avail?21:3,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left .18s"}}/>
            </div>
          </div>
          <div style={{display:"flex",gap:7,marginBottom:13}}>
            {Object.entries(MODES).map(([k,m])=>(
              <button key={k} onClick={()=>setF(p=>({...p,mode:k}))} style={{flex:1,padding:"9px 3px",borderRadius:10,border:`2px solid ${f.mode===k?m.fg:C.border}`,background:f.mode===k?m.bg:C.bg,color:f.mode===k?m.fg:C.muted,fontSize:11,fontWeight:800,cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"center",marginBottom:3}}><Icon name={m.icon} size={20}/></div>{m.label}
              </button>
            ))}
          </div>
          {f.mode==="sell"&&<Inp label="מחיר (₪)" type="number" value={f.price} onChange={upd("price")} icon="tag"/>}
          {f.mode==="lend"&&<div style={{marginBottom:13}}>
            <div style={{fontSize:13,fontWeight:600,color:C.muted,marginBottom:6}}>תאריך החזרה</div>
            <input type="date" value={f.lendUntil||""} onChange={e=>setF(p=>({...p,lendUntil:e.target.value}))} min={new Date().toISOString().split("T")[0]} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1px solid ${C.border}`,fontSize:15,background:C.bg}}/>
          </div>}
          {f.mode==="swap"&&<Inp label="איזה ספר מחפש?" value={f.swapFor||""} onChange={e=>setF(p=>({...p,swapFor:e.target.value}))} placeholder="שם ספר / נושא / סוגה" icon="search"/>}
          {f.mode==="give"&&<div style={{padding:"10px 12px",background:"#f0fdf4",borderRadius:10,fontSize:13,color:"#15803d",fontWeight:600,marginBottom:13}}>🎁 הספר יסומן כמסירה חינם</div>}
          <div style={{display:"flex",gap:9,marginTop:5}}>
            <Btn variant="outline" onClick={onCancel} style={{flex:1,padding:"11px"}}>ביטול</Btn>
            <Btn onClick={()=>onSave(book.id,{...f,price:f.mode==="sell"?Number(f.price):null})} disabled={!f.title.trim()} style={{flex:2,padding:"11px"}}>✓ שמור</Btn>
          </div>
          <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
            {!del
              ? <button onClick={()=>setDel(true)} style={{width:"100%",padding:"10px",background:C.bg,border:`1px solid ${C.border}`,borderRadius:11,color:C.red,fontSize:13,fontWeight:700,cursor:"pointer"}}>🗑️ מחק ספר</button>
              : <div style={{background:C.redL,borderRadius:11,padding:"12px"}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.red,marginBottom:10,textAlign:"center"}}>למחוק לצמיתות?</div>
                  <div style={{display:"flex",gap:9}}>
                    <Btn variant="outline" onClick={()=>setDel(false)} style={{flex:1,padding:"10px"}}>ביטול</Btn>
                    <Btn variant="red" onClick={()=>onDelete(book.id)} style={{flex:1,padding:"10px"}}>✓ מחק</Btn>
                  </div>
                </div>
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// Sun May 24 18:49:04 IDT 2026
// TEST Thu May 28 23:01:06 IDT 2026
// Mon Jun  1 11:38:11 IDT 2026
