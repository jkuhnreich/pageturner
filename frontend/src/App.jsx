// frontend/src/App.jsx
import { useState, useRef, useEffect, useCallback } from "react";
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
  bg: "#f5f0e8", white: "#fff", ink: "#1E2D3D", muted: "#7a8a7a",
  border: "#dde5d8", accent: "#6B8F47", gold: "#6B8F47",
  teal: "#6B8F47", tealL: "#f0f4ec", indigo: "#1E2D3D", indigoL: "#eef2ff",
  green: "#6B8F47", greenL: "#f0f4ec", red: "#dc2626", redL: "#fef2f2",
};
const HDR = "#1E2D3D";
const SPINES = ["#c0392b","#2980b9","#8e44ad","#16a085","#e67e22","#d35400","#27ae60","#7f3fbf"];
const MODES = {
  sell:  { label:"מכירה",  icon:"₪",  bg:"#fef8ec", fg:"#c4841a" },
  lend:  { label:"השאלה",  icon:"↩",  bg:"#eef2ff", fg:"#4338ca" },
  swap:  { label:"החלפה",  icon:"⇄",  bg:"#f0fdf9", fg:"#0f766e" },
  give:  { label:"מסירה",  icon:"🎁", bg:"#f0fdf4", fg:"#15803d" },
};

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f5f0e8;font-family:'Rubik',sans-serif;direction:rtl}
input,textarea,button{font-family:'Rubik',sans-serif}
input::placeholder,textarea::placeholder{color:#9a9080}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#ccc;border-radius:3px}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes spineRise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes toastIn{from{opacity:0;transform:translate(-50%,12px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid #6B8F47;outline-offset:2px}
img{max-width:100%}
`;

// ── קומפוננטים קטנים ────────────────────────────────────────

const IconSearch = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="4" width="14" height="18" rx="2" fill="#1E2D3D" opacity="0.15"/>
    <rect x="2" y="4" width="14" height="18" rx="2" stroke="#1E2D3D" strokeWidth="1.5"/>
    <path d="M6 8h6M6 11h4" stroke="#1E2D3D" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="17" cy="17" r="4" fill="#6B8F47" opacity="0.9"/>
    <path d="M20 20l2 2" stroke="#6B8F47" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="17" cy="17" r="2" fill="none" stroke="white" strokeWidth="1.2"/>
  </svg>
);

const IconAdd = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="4" width="14" height="18" rx="2" fill="#1E2D3D" opacity="0.15"/>
    <rect x="2" y="4" width="14" height="18" rx="2" stroke="#1E2D3D" strokeWidth="1.5"/>
    <circle cx="17" cy="17" r="5" fill="#6B8F47"/>
    <path d="M17 14v6M14 17h6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const IconProfile = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="4" width="14" height="18" rx="2" fill="#1E2D3D" opacity="0.15"/>
    <rect x="2" y="4" width="14" height="18" rx="2" stroke="#1E2D3D" strokeWidth="1.5"/>
    <circle cx="17" cy="13" r="5" fill="#6B8F47"/>
    <circle cx="17" cy="12" r="2" fill="white"/>
    <path d="M13 19c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

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
  const bg = { ok: C.teal, warn: "#b7791f", err: C.red }[t.type] || C.teal;
  return (
    <div style={{position:"fixed",bottom:90,left:"50%",transform:"translateX(-50%)",background:bg,color:"#fff",padding:"10px 20px",borderRadius:16,fontSize:13,fontWeight:700,zIndex:9999,maxWidth:"calc(100vw - 32px)",textAlign:"center",lineHeight:1.5,boxShadow:"0 4px 20px rgba(0,0,0,.25)",animation:"toastIn .28s cubic-bezier(.34,1.56,.64,1)"}}>
      {t.msg}
    </div>
  );
}

function Inp({ label, required: req, icon, ...rest }) {
  const [f, setF] = useState(false);
  return (
    <div style={{marginBottom:13}}>
      {label && <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".5px",textTransform:"uppercase",marginBottom:4}}>
        {label}{req && <span style={{color:C.accent,marginRight:3}}>*</span>}
      </div>}
      <div style={{position:"relative"}}>
        {icon && <span style={{position:"absolute",right:11,top:"50%",transform:"translateY(-50%)",fontSize:14,opacity:.4,pointerEvents:"none"}}>{icon}</span>}
        <input {...rest}
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
  return (
    <div style={{marginBottom:13}}>
      {label && <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".5px",textTransform:"uppercase",marginBottom:4}}>{label}</div>}
      <textarea {...rest}
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
function CoverSlot({ label, sub, icon, preview, loading, onFile }) {
  const camRef = useRef(), galRef = useRef();
  const handle = e => { if (e.target.files[0]) { onFile(e.target.files[0]); e.target.value = ""; } };
  return (
    <div style={{flex:1,border:`2px dashed ${preview?C.teal:C.border}`,borderRadius:14,minHeight:140,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:preview?C.tealL:loading?"#f9f8f5":C.white,overflow:"hidden",position:"relative"}}>
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handle}/>
      <input ref={galRef} type="file" accept="image/*" style={{display:"none"}} onChange={handle}/>
      {loading
        ? <div style={{textAlign:"center"}}><Spinner/><div style={{fontSize:12,color:C.muted,marginTop:8,fontWeight:600}}>המערכת מנתחת את התמונה...</div></div>
        : preview
          ? <>
              <img src={preview} alt="" style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover"}}/>
              <div style={{position:"absolute",inset:0,background:"rgba(15,118,110,.52)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                <div style={{color:"#fff",fontSize:26,marginBottom:4}}>✓</div>
                <div style={{fontSize:11,color:"#fff",fontWeight:700,marginBottom:8}}>נותח</div>
                <div style={{display:"flex",gap:6}}>
                  <span onClick={()=>camRef.current.click()} style={{fontSize:10,color:"rgba(255,255,255,.9)",background:"rgba(0,0,0,.35)",padding:"3px 8px",borderRadius:7,cursor:"pointer"}}>📷 מחדש</span>
                  <span onClick={()=>galRef.current.click()} style={{fontSize:10,color:"rgba(255,255,255,.9)",background:"rgba(0,0,0,.35)",padding:"3px 8px",borderRadius:7,cursor:"pointer"}}>🖼️ גלריה</span>
                </div>
              </div>
            </>
          : <div style={{textAlign:"center",padding:"0 10px"}}>
              <div style={{fontSize:28,marginBottom:5}}>{icon}</div>
              <div style={{fontSize:12,fontWeight:700,color:C.ink,marginBottom:2}}>{label}</div>
              <div style={{fontSize:10,color:C.muted,marginBottom:10}}>{sub}</div>
              <div style={{display:"flex",gap:6,justifyContent:"center"}}>
                <span onClick={()=>camRef.current.click()} style={{fontSize:11,fontWeight:700,color:C.indigo,background:C.indigoL,padding:"5px 10px",borderRadius:8,cursor:"pointer"}}>📷 צלם</span>
                <span onClick={()=>galRef.current.click()} style={{fontSize:11,fontWeight:700,color:"#6d28d9",background:"#f5f3ff",padding:"5px 10px",borderRadius:8,cursor:"pointer"}}>🖼️ גלריה</span>
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
  const upd = k => e => setForm(p=>({...p,[k]:e.target.value}));

  const scanFront = async raw => {
    setFp(URL.createObjectURL(raw));
    setFl(true);
    const file = await compressImage(raw);
    setFrontFile(file);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await api.upload("/api/analyze/front", fd);
      const d = res.data;
      setForm(f => ({
        ...f,
        title:     d.title     || f.title,
        author:    d.author    || f.author,
        publisher: d.publisher || f.publisher,
        year:      d.year      || f.year,
        thumbnail: d.thumbnail || res.croppedImage || f.thumbnail,
        genre:     d.genre     || f.genre,
      }));
      const cnt = [d.title, d.author, d.publisher].filter(Boolean).length;
      toast_(`✓ כריכה קדמית — ${cnt} פרטים חולצו`);
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
      if (Object.keys(updates).length) {
        setForm(f => ({ ...f, ...updates }));
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
    } finally { setSaving(false); }
  };

  if (preview) return (
    <div style={{padding:"20px 16px",direction:"rtl",animation:"fadeUp .2s ease"}}>
      <div style={{fontSize:18,fontWeight:800,color:"#1E2D3D",marginBottom:16,textAlign:"center"}}>תצוגה מקדימה</div>
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #dde5d8",overflow:"hidden",marginBottom:16}}>
        {(form.thumbnail||fp) && <img src={form.thumbnail||fp} alt="" style={{width:"100%",maxHeight:200,objectFit:"contain",background:"#f5f0e8"}}/>}
        <div style={{padding:"16px"}}>
          <div style={{fontSize:18,fontWeight:800,color:"#1E2D3D",marginBottom:4}}>{form.title}</div>
          <div style={{fontSize:14,color:"#7a8a7a",marginBottom:8}}>{form.author}{form.publisher?` · ${form.publisher}`:""}{form.year?` (${form.year})`:""}</div>
          {form.summary && <div style={{fontSize:13,color:"#7a8a7a",marginBottom:8,fontStyle:"italic"}}>"{form.summary}"</div>}
          <div style={{fontSize:13,fontWeight:600,color:"#6B8F47"}}>{MODES[form.mode]?.icon} {MODES[form.mode]?.label}</div>
        </div>
      </div>
      {/* אפשרות להחליף תמונה */}
      <label style={{display:"block",textAlign:"center",marginBottom:12,cursor:"pointer",color:"#6B8F47",fontSize:14,fontWeight:600}}>
        📷 החלף תמונה
        <input type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{
          const file = e.target.files[0];
          if(!file) return;
          setFp(URL.createObjectURL(file));
          setFrontFile(await compressImage(file));
          setForm(f=>({...f,thumbnail:""}));
        }}/>
      </label>
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={save} disabled={saving} style={{flex:1,padding:"13px",borderRadius:13}}>
          {saving ? <><Spinner/> מפרסם...</> : "פרסם ✨"}
        </Btn>
        <Btn variant="outline" onClick={()=>setPreview(false)} style={{flex:1,padding:"13px",borderRadius:13}}>
          → עריכה
        </Btn>
      </div>
    </div>
  );

  if (step === "gps") return (
    <div style={{animation:"fadeUp .2s ease",textAlign:"center",padding:"24px 16px"}}>
      <div style={{fontSize:52,marginBottom:16}}>📍</div>
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
      <div style={{textAlign:"center",padding:"4px 0 16px",fontSize:14,color:C.muted}}>כיצד להוסיף ספר?</div>
      <div style={{display:"flex",gap:10,marginBottom:12}}>
        {[
          {id:"camera", ic:"📸", t:"סריקת כריכה",  d:"צלם קדימה + אחורה → פרטים אוטומטיים"},
          {id:"manual", ic:"✏️", t:"הזנה ידנית",   d:"מלא פרטים בעצמך"},
        ].map(o=>(
          <div key={o.id} onClick={()=>setStep(o.id)}
            style={{flex:1,background:C.white,borderRadius:16,border:`2px solid ${C.border}`,padding:"16px 10px",cursor:"pointer",textAlign:"center",boxShadow:"0 2px 8px rgba(0,0,0,.05)"}}>
            <div style={{fontSize:28,marginBottom:6}}>{o.ic}</div>
            <div style={{fontSize:12,fontWeight:800,color:C.ink,marginBottom:3}}>{o.t}</div>
            <div style={{fontSize:10,color:C.muted,lineHeight:1.5}}>{o.d}</div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{animation:"fadeUp .2s ease"}}>
      <button onClick={()=>setStep("choose")} style={{background:C.bg,border:"none",borderRadius:9,padding:"6px 12px",cursor:"pointer",fontSize:13,marginBottom:14}}>
        → חזרה
      </button>

      {step === "camera" && (
        <div style={{background:C.white,borderRadius:18,border:`1px solid ${C.border}`,padding:"16px",marginBottom:12}}>
          <div style={{fontSize:14,fontWeight:700,color:C.ink,marginBottom:4}}>📸 צלם את שתי הכריכות</div>
          <div style={{fontSize:12,color:C.muted,marginBottom:12}}>המערכת תחלץ את הפרטים ותזין לטופס אוטומטית</div>
          <div style={{display:"flex",gap:10,marginBottom:10}}>
            <CoverSlot label="קדמית" sub="שם · מחבר · הוצאה" icon="📖" preview={fp} loading={fl} onFile={scanFront}/>
            <CoverSlot label="אחורית" sub="תקציר · ISBN" icon="📝" preview={bp} loading={bl} onFile={scanBack}/>
          </div>
          {(fp||bp) && !fl && !bl && (
            <div style={{background:C.tealL,borderRadius:10,padding:"9px 12px",fontSize:12,color:C.teal,fontWeight:600}}>
              ✓ פרטים הוזנו לטופס למטה — בדוק ועדכן לפי הצורך
            </div>
          )}
        </div>
      )}

      {/* טופס פרטי ספר */}
      <div style={{background:C.white,borderRadius:18,border:`1px solid ${C.border}`,padding:"16px",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,color:C.ink,marginBottom:14}}>📖 פרטי הספר</div>
        <Inp label="שם הספר" required value={form.title} onChange={upd("title")} placeholder="שם הספר" icon="📚"/>
        <Inp label="מחבר" value={form.author} onChange={upd("author")} placeholder="שם המחבר" icon="✍️"/>
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:2}}><Inp label="הוצאה" value={form.publisher} onChange={upd("publisher")} placeholder="שם ההוצאה"/></div>
          <div style={{flex:1}}><Inp label="שנה" value={form.year} onChange={upd("year")} placeholder="2024"/></div>
        </div>
        <TA label="תקציר" value={form.summary} onChange={upd("summary")} placeholder="תקציר הסיפור..."/>
        <Inp label="מצב" value={form.condition} onChange={upd("condition")} placeholder="כמו חדש / טוב / שימוש רב" icon="⭐"/>
        <div style={{marginBottom:13}}>
          <div style={{fontSize:13,fontWeight:600,color:C.muted,marginBottom:6}}>סוגה</div>
          <select value={form.genre} onChange={e=>setForm(f=>({...f,genre:e.target.value}))} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1px solid ${C.border}`,fontSize:14,background:C.bg,direction:"rtl"}}>
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
        <div style={{fontSize:14,fontWeight:700,color:C.ink,marginBottom:12}}>💡 מה לעשות?</div>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          {Object.entries(MODES).map(([k,m])=>(
            <button key={k} onClick={()=>setForm(f=>({...f,mode:k}))}
              style={{flex:1,padding:"10px 3px",borderRadius:12,border:`2px solid ${form.mode===k?m.fg:C.border}`,background:form.mode===k?m.bg:C.bg,color:form.mode===k?m.fg:C.muted,fontSize:12,fontWeight:800,cursor:"pointer"}}>
              <div style={{fontSize:18,marginBottom:2}}>{m.icon}</div>{m.label}
            </button>
          ))}
        </div>
        {form.mode === "sell" && (
          <Inp label="מחיר (₪)" type="number" value={form.price} onChange={upd("price")} placeholder="0" icon="₪"/>
        )}
        {form.mode === "lend" && (
          <div>
            <div style={{fontSize:13,fontWeight:600,color:C.muted,marginBottom:6}}>תאריך החזרה</div>
            <input type="date" value={form.lendUntil||""} onChange={e=>setForm(f=>({...f,lendUntil:e.target.value}))} min={new Date().toISOString().split("T")[0]} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1px solid ${C.border}`,fontSize:15,background:C.bg}}/>
          </div>
        )}
        {form.mode === "swap" && (
          <Inp label="איזה ספר מחפש?" value={form.swapFor||""} onChange={e=>setForm(f=>({...f,swapFor:e.target.value}))} placeholder="שם ספר / נושא / סוגה" icon="🔍"/>
        )}
        {form.mode === "give" && (
          <div style={{padding:"10px 12px",background:"#f0fdf4",borderRadius:10,fontSize:13,color:"#15803d",fontWeight:600}}>🎁 הספר יסומן כמסירה חינם — כל אחד יכול לבוא לקחת!</div>
        )}
      </div>

      <Btn onClick={()=>{if(!form.title.trim()||!form.author.trim())return toast_("שם ספר ומחבר הם שדות חובה","warn");setPreview(true);}} style={{width:"100%",padding:"13px",borderRadius:13,marginBottom:24}}>
        לתצוגה מקדימה ←
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
        <h2 style={{fontFamily:"'Frank Ruhl Libre',serif",fontSize:26,color:C.ink,marginBottom:6}}>{step==="email"?"התחברות":"הקוד שלך"}</h2>
        {step==="email" ? <>
          <p style={{fontSize:14,color:C.muted,marginBottom:20,lineHeight:1.6}}>בלי סיסמאות. נשלח לך קוד כניסה למייל.</p>
          <input type="email" inputMode="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendOtp()} placeholder="כתובת מייל" autoFocus
            style={{width:"100%",padding:"15px 16px",borderRadius:12,border:`1.5px solid ${C.border}`,marginBottom:14,fontSize:17,background:C.bg,color:C.ink,outline:"none",direction:"ltr",textAlign:"right"}} />
          {err && <div style={{color:C.red,fontSize:13,marginBottom:10}}>{err}</div>}
          <Btn onClick={sendOtp} disabled={loading} style={{width:"100%",padding:"16px",borderRadius:14,fontSize:16}}>{loading?"שולח...":"שלחו לי קוד"}</Btn>
        </> : <>
          <p style={{fontSize:14,color:C.muted,marginBottom:16,lineHeight:1.6}}>שלחנו קוד בן 6 ספרות אל <b style={{color:C.ink,direction:"ltr",display:"inline-block"}}>{email}</b></p>
          <CodeInput value={code} onChange={setCode} onEnter={verifyOtp}/>
          {err && <div style={{color:C.red,fontSize:13,marginBottom:10}}>{err}</div>}
          {!err && info && <div style={{color:C.muted,fontSize:12,marginBottom:10}}>{info}</div>}
          <Btn onClick={verifyOtp} disabled={loading||code.length!==6} style={{width:"100%",padding:"16px",borderRadius:14,fontSize:16}}>{loading?"מאמת...":"כניסה"}</Btn>
          <button onClick={sendOtp} disabled={loading} style={{width:"100%",marginTop:12,background:"none",border:"none",color:C.accent,fontSize:13,fontWeight:600,cursor:"pointer"}}>לא הגיע? שלחו שוב</button>
        </>}
      </div>
    </div>
  );
}

// ── מסך הרשמה: פרטים ← קוד במייל ← סיום ─────────────────────
function Register({ onBack, onDone, prefill, onShowLegal }) {
  const [type, setType] = useState(prefill ? "private" : null);
  const [form, setForm] = useState({ name:"", phone:"", email: prefill?.email || "", storeName:"", address:"" });
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
        <div style={{fontFamily:"'Frank Ruhl Libre',serif",fontSize:26,fontWeight:900,color:"#fff"}}>
          {otpStep ? "כמעט שם" : type ? "הרשמה" : "מדפדפים לפרק הבא"}
        </div>
        {!type && <div style={{fontSize:13,color:"rgba(255,255,255,.55)",marginTop:6,fontStyle:"italic"}}>{q}</div>}
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
                {err && <div style={{color:C.red,fontSize:13,marginBottom:10}}>{err}</div>}
                <Btn onClick={verifyOtp} disabled={loading||otp.length!==6} style={{width:"100%",padding:"15px",borderRadius:13,fontSize:15}}>{loading?"מאמת...":"אמת והיכנס"}</Btn>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:12}}>
                  <button onClick={()=>{setOtpStep(false);setErr("");}} style={{background:"none",border:"none",color:C.muted,fontSize:13,cursor:"pointer"}}>תיקון פרטים</button>
                  <button onClick={submit} disabled={loading} style={{background:"none",border:"none",color:C.accent,fontSize:13,fontWeight:600,cursor:"pointer"}}>שלחו קוד שוב</button>
                </div>
              </div>
            </>
          : <>
              {!prefill && <button onClick={()=>setType(null)} style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:9,padding:"6px 13px",cursor:"pointer",fontSize:13,marginBottom:14,color:C.muted}}>→ סוג חשבון</button>}
              <div style={{background:C.white,borderRadius:18,border:`1px solid ${C.border}`,padding:"16px",marginBottom:12}}>
                <div style={{fontSize:12,color:C.muted,marginBottom:14}}>שדות עם * הם חובה</div>
                <Inp label="שם" required value={form.name}  onChange={upd("name")}  placeholder="השם שלך" icon="👤" autoComplete="name"/>
                <Inp label="טלפון" required value={form.phone} onChange={upd("phone")} placeholder="050-0000000" inputMode="tel" type="tel" icon="📞" autoComplete="tel"/>
                <div style={{fontSize:11,color:C.muted,marginTop:-8,marginBottom:12}}>מוצג רק למשתמשים רשומים שפונים אליך לגבי ספר</div>
                <Inp label="אימייל" required value={form.email} onChange={upd("email")} placeholder="email@example.com" type="email" inputMode="email" icon="✉️" autoComplete="email" disabled={!!prefill}/>
                {type === "store" && <>
                  <div style={{height:1,background:C.border,margin:"12px 0"}}/>
                  <Inp label="שם החנות" required value={form.storeName} onChange={upd("storeName")} placeholder="שם החנות" icon="🏪"/>
                  <Inp label="כתובת החנות" required value={form.address} onChange={upd("address")} placeholder="רחוב, מספר, עיר" icon="📍"/>
                </>}
                <label style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:13,color:C.ink,lineHeight:1.5,cursor:"pointer",marginTop:4}}>
                  <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} style={{marginTop:3,width:18,height:18,accentColor:C.accent,flexShrink:0}}/>
                  <span>אשמח לקבל עדכונים על ספרים חדשים בשכונה (אפשר להסיר בכל רגע)</span>
                </label>
              </div>
              {err && <div style={{background:C.redL,borderRadius:10,padding:"10px 14px",fontSize:13,color:C.red,marginBottom:12}}>{err}</div>}
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
      <h1 style={{fontFamily:"'Frank Ruhl Libre',serif",fontSize:36,fontWeight:900,color:"#fff",textAlign:"center",lineHeight:1.12,marginBottom:12}}>ספרייה<br/>שכונתית</h1>
      <div style={{color:"rgba(255,255,255,.7)",fontSize:15,marginBottom:10,textAlign:"center",lineHeight:1.6,maxWidth:300}}>הספרים שכבר קראת, אצל השכנים שמחפשים אותם</div>
      <div style={{color:"rgba(255,255,255,.4)",fontSize:13,marginBottom:40,letterSpacing:".5px"}}>השאלה · מכירה · החלפה · מסירה</div>
      <div style={{width:"100%",maxWidth:320,display:"flex",flexDirection:"column",gap:10}}>
        <Btn variant="accent" onClick={onReg} style={{width:"100%",padding:"15px",fontSize:16,borderRadius:14,boxShadow:"0 6px 20px rgba(107,143,71,.35)"}}>הצטרפות חינם</Btn>
        <Btn onClick={onLogin} style={{width:"100%",padding:"15px",fontSize:15,borderRadius:14,background:"rgba(255,255,255,.14)"}}>יש לי חשבון</Btn>
        <button onClick={onGuest} style={{width:"100%",padding:"13px",background:"none",border:"none",color:"rgba(255,255,255,.7)",fontSize:14,cursor:"pointer",textDecoration:"underline",textUnderlineOffset:4}}>להציץ בספרים בלי להירשם</button>
      </div>
      <div style={{marginTop:36,fontSize:12,color:"rgba(255,255,255,.35)",display:"flex",gap:14}}>
        <button onClick={()=>onShowLegal("terms")} style={{...linkBtn,color:"rgba(255,255,255,.45)",textDecoration:"none"}}>תנאי שימוש</button>
        <span>·</span>
        <button onClick={()=>onShowLegal("privacy")} style={{...linkBtn,color:"rgba(255,255,255,.45)",textDecoration:"none"}}>פרטיות</button>
      </div>
    </div>
  );
}

// ── מדיניות פרטיות ותנאי שימוש ──────────────────────────────
const LEGAL_UPDATED = "24.10.2026";
const LEGAL = {
  privacy: { title: "מדיניות פרטיות", sections: [
    ["מי אנחנו", "Pageturner (\"ספרייה שכונתית\", pageturner.co.il) היא פלטפורמה ישראלית שמחברת בין שכנים שרוצים למכור, להשאיל, להחליף או למסור ספרים. לכל שאלה או בקשה בנוגע למידע שלכם אפשר לפנות אלינו דרך \"צור קשר\" בתפריט האתר."],
    ["איזה מידע אנחנו אוספים", "שם, מספר טלפון וכתובת מייל שמסרתם בהרשמה. פרטי הספרים שפרסמתם ותמונות שצילמתם. מיקום משוער של הספר, רק אם אישרתם גישה למיקום. תמונת פרופיל ומשפט על עצמכם, אם הוספתם. נתוני שימוש בסיסיים: חיפושים, צפייה בספרים ופניות למפרסמים, כדי לשפר את השירות."],
    ["מה רואים משתמשים אחרים", "כל מי שנכנס לאתר רואה את פרטי הספר, את השם שלכם ואת העיר. המרחק מוצג בעיגול, כך שאי אפשר לדעת את הכתובת המדויקת. מספר הטלפון מוצג רק למשתמש רשום שפותח את דף הספר כדי לפנות אליכם. כתובת המייל לא מוצגת לאף אחד."],
    ["צילומי כריכה", "כשאתם מצלמים כריכה לזיהוי אוטומטי, התמונה נשלחת לשירות בינה מלאכותית חיצוני (Anthropic) רק כדי לחלץ את פרטי הספר. אנחנו לא שולחים איתה שום פרט מזהה עליכם."],
    ["ספקים שעובדים איתנו", "אחסון השרת ומסד הנתונים (Railway), אחסון האתר (Vercel), שליחת מיילים (Resend), זיהוי ספרים מתמונה (Anthropic), חיפוש פרטי ספרים (Google Books, Open Library) ותרגום מיקום לשם עיר (OpenStreetMap). חלק מהספקים פועלים מחוץ לישראל. אנחנו לא מוכרים מידע אישי לאף אחד."],
    ["מיילים", "נשלח לכם קודי כניסה, ועדכון כשספר שביקשתם להתעדכן עליו מתפרסם. עדכונים שיווקיים יישלחו רק אם הסכמתם לכך בהרשמה, ואפשר לבטל בכל רגע בהגדרות הפרופיל."],
    ["הזכויות שלכם", "אפשר לעיין במידע שלכם ולתקן אותו בפרופיל. אפשר למחוק את החשבון בכל רגע מתוך הפרופיל: החשבון, הספרים והמשאלות נמחקים מיד, ונתוני השימוש נשמרים ללא זיהוי. לבקשות נוספות אפשר לפנות אלינו דרך \"צור קשר\" בתפריט."],
    ["אבטחה", "הכניסה לאתר נעשית בקוד חד-פעמי שנשלח למייל, בלי סיסמאות. החיבור לאתר מוצפן, והגישה לפעולות בחשבון מחייבת זיהוי. שום מערכת אינה חסינה לחלוטין, ואנחנו פועלים כדי לצמצם סיכונים."],
  ]},
  terms: { title: "תנאי שימוש", sections: [
    ["השירות", "Pageturner מאפשרת לפרסם ספרים ולמצוא ספרים אצל אנשים בסביבה. אנחנו לוח מודעות שמחבר בין אנשים, ולא צד לעסקאות. התשלום, המסירה וההחזרה של ספרים נעשים ישירות בין המשתמשים."],
    ["פרסום ספרים", "מפרסמים רק ספרים שבבעלותכם, עם פרטים נכונים ומצב אמיתי של הספר. אסור לפרסם תוכן פוגעני, מטעה, או כזה שמפר זכויות של אחרים. אנחנו רשאים להסיר מודעות או לחסום משתמשים שמפרים את התנאים."],
    ["עסקאות בין משתמשים", "בדקו את הספר לפני תשלום, ותאמו מפגש במקום ציבורי כשאפשר. האחריות על העסקה, על מצב הספר ועל החזרת ספרים מושאלים היא של המשתמשים עצמם."],
    ["פניות", "השתמשו בפרטי הקשר של משתמשים אחרים רק כדי לפנות לגבי הספר שפרסמו. אסור לשלוח ספאם, לאסוף פרטים או להטריד."],
    ["אחריות", "השירות ניתן כמו שהוא. אנחנו עושים מאמץ שיפעל כראוי, אבל לא מתחייבים לזמינות רציפה או לדיוק של מידע שמשתמשים פרסמו או שזוהה אוטומטית מתמונה."],
    ["שינויים", "ייתכן שנעדכן את התנאים מעת לעת. נעדכן כאן את תאריך העדכון האחרון, ושימוש בשירות לאחר עדכון מהווה הסכמה לתנאים המעודכנים. על התנאים חל הדין הישראלי."],
  ]},
};

function LegalSheet({ kind, onClose }) {
  const doc = LEGAL[kind];
  if (!doc) return null;
  return (
    <div style={{position:"fixed",inset:0,zIndex:900,background:"rgba(14,12,8,.7)",display:"flex",alignItems:"flex-end",direction:"rtl"}} onClick={onClose}>
      <div role="dialog" aria-label={doc.title} style={{width:"100%",maxWidth:560,margin:"0 auto",background:C.white,borderRadius:"22px 22px 0 0",maxHeight:"88vh",overflowY:"auto",padding:"22px 20px 32px",animation:"sheetUp .28s cubic-bezier(.33,1,.68,1)"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:32,height:4,borderRadius:99,background:C.border,margin:"0 auto 18px"}}/>
        <div style={{fontFamily:"'Frank Ruhl Libre',serif",fontSize:24,fontWeight:900,color:C.ink}}>{doc.title}</div>
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
  const [legal, setLegal] = useState(null);
  const [regPrefill, setRegPrefill] = useState(null);
  const [showContact, setShowContact] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [wishMatches, setWishMatches] = useState([]);
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

  const lastSearch = useRef("");
  const loadBooks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (modeFilter !== "all") params.set("mode", modeFilter);
      if (genreFilter !== "all") params.set("genre", genreFilter);
      if (userCoords) { params.set("lat", userCoords.lat); params.set("lng", userCoords.lng); }
      const data = await api.get(`/api/books?${params}`);
      setBooks(Array.isArray(data) ? data : []);
      if (search && search !== lastSearch.current) {
        lastSearch.current = search;
        api.track("search", { q: search });
      }
    } catch(e) {
      toast_(e.message, "err");
    } finally { setLoading(false); }
  }, [search, modeFilter, genreFilter, toast_, userCoords]);

  useEffect(() => {
    if (screen === "app") {
      const t = setTimeout(loadBooks, 200);
      return () => clearTimeout(t);
    }
  }, [screen, search, modeFilter, genreFilter, loadBooks, userCoords]);

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
  const legalSheet = legal && <LegalSheet kind={legal} onClose={()=>setLegal(null)}/>;
  if (screen === "admin") return <><style>{CSS}</style><AdminPage onBack={()=>{navigate("/");setScreen(user?"app":"splash");}}/></>
  if (screen === "splash") return <><style>{CSS}</style><Splash onReg={()=>setScreen("register")} onGuest={handleGuest} onLogin={()=>setScreen("login")} onShowLegal={setLegal}/>{legalSheet}<Toast t={toast}/></>;
  if (screen === "login") return <><style>{CSS}</style><Login onBack={()=>setScreen("splash")} onDone={(u,t)=>handleAuth(u,t,false)} onRegister={pf=>{setRegPrefill(pf);setScreen("register");}}/><Toast t={toast}/></>;
  if (screen === "register") return <><style>{CSS}</style><Register key={regPrefill?.email||"new"} prefill={regPrefill} onBack={()=>{setRegPrefill(null);setScreen(user?"app":"splash");}} onDone={(u,t)=>handleAuth(u,t,true)} onShowLegal={setLegal}/>{legalSheet}</>;

  const TABS = [
    ["search", <IconSearch/>, "חיפוש"],
    ["add",    <IconAdd/>,    "הוסף"],
    ["profile",<IconProfile/>,"פרופיל"],
  ];

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",direction:"rtl",background:C.bg,position:"relative",overflow:(viewUserId||viewBook)?"hidden":"visible",height:(viewUserId||viewBook)?"100vh":"auto"}}>
      <style>{CSS}</style>

      {/* Edit drawer */}
      {editBook && <EditDrawer book={editBook} onSave={saveEdit} onDelete={deleteBook} onCancel={()=>setEditBook(null)} toast_={toast_}/>}
      {viewUserId && <UserPage userId={viewUserId} onClose={()=>{setViewUserId(null);navigate("/");}} onViewBook={b=>{setViewUserId(null);setViewBook(b);}} HDR={HDR} SPINES={SPINES}/>}
      {viewBook && <BookPage book={viewBook} onClose={()=>setViewBook(null)} isGuest={isGuest} onGuest={onGuestAction} user={user} toast_={toast_} onBookUpdated={()=>{loadBooks();loadMyBooks();}} onContactMade={checkPendingSoon} onViewUser={id=>{setViewBook(null);setViewUserId(id);navigate(`?user=${id}`);}}/>}

      {/* Header */}
      <div style={{background:HDR,flexShrink:0,position:"sticky",top:0,zIndex:60,paddingTop:"env(safe-area-inset-top)"}}>
        <div style={{padding:"14px 17px 0"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <button onClick={()=>{setTab("search");setSearch("");setModeFilter("all");loadBooks();}} style={{background:"none",border:"none",cursor:"pointer",textAlign:"right",padding:0}}>
              <div style={{fontFamily:"'Frank Ruhl Libre',serif",fontSize:21,fontWeight:900,color:"#fff"}}>ספרייה שכונתית</div>
            </button>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {!isGuest && <button onClick={()=>setTab("profile")} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><div style={{fontSize:11,color:"rgba(255,255,255,.5)",marginTop:1}}>{(()=>{const h=new Date().getHours();return h>=4&&h<12?"☀️ בוקר טוב":h<18?"🌤️ צהריים טובים":h<22?"🌆 ערב טוב":"🌙 לילה טוב";})()} {user?.name||""}</div></button>}
              {isGuest && <button onClick={onGuestAction} style={{background:"#6B8F47",border:"none",borderRadius:9,padding:"5px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",marginBottom:6}}>הצטרף →</button>}
              <button onClick={()=>setMenuOpen(true)} aria-label="תפריט" style={{background:"rgba(255,255,255,.1)",border:"none",borderRadius:10,cursor:"pointer",width:38,height:38,color:"#fff",fontSize:19,lineHeight:1}}>☰</button>
            </div>
          </div>
        </div>

        {tab === "search" && (
          <div style={{padding:"10px 15px 12px"}}>
            <div style={{position:"relative"}}>
              <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:15,opacity:.4,pointerEvents:"none"}}>🔍</span>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="חיפוש ספר, מחבר או מפרסם" type="search" enterKeyHint="search"
                style={{width:"100%",padding:"12px 42px 12px 13px",background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.18)",borderRadius:12,color:"#fff",fontSize:16,outline:"none"}}
                onFocus={e=>e.target.style.background="rgba(255,255,255,.16)"}
                onBlur={e=>e.target.style.background="rgba(255,255,255,.1)"}
              />
            </div>
          </div>
        )}
      </div>

      {/* Filter chips */}
      {tab === "search" && (
        <div style={{display:"flex",gap:6,padding:"8px 13px",background:C.white,borderBottom:`1px solid ${C.border}`,overflowX:"auto",flexShrink:0}}>
          {[["all","הכל","📚"],["sell","מכירה","₪"],["lend","השאלה","↩"],["swap","החלפה","⇄"],["give","מסירה","🎁"]].map(([k,l,ic])=>(
            <button key={k} onClick={()=>setModeFilter(k)} aria-pressed={modeFilter===k}
              style={{padding:"7px 13px",borderRadius:99,fontSize:13,fontWeight:modeFilter===k?700:500,border:"none",cursor:"pointer",background:modeFilter===k?C.ink:C.bg,color:modeFilter===k?"#fff":C.muted,display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap",flexShrink:0}}>
              {ic} {l}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <main style={{flex:1,padding:"12px 12px 16px",width:"100%",maxWidth:640,margin:"0 auto"}}>

        {/* חיפוש */}
        {tab === "search" && (
          loading
            ? <div style={{textAlign:"center",padding:"40px",color:C.muted}}><Spinner/><div style={{marginTop:10}}>טוען ספרים...</div></div>
            : books.length === 0
              ? <div style={{textAlign:"center",padding:"60px 20px",color:C.muted}}>
                  <div style={{fontSize:48,marginBottom:12}}>📭</div>
                  <div style={{fontSize:16,fontWeight:700,color:C.ink,marginBottom:8}}>{search.trim()||modeFilter!=="all"?"לא נמצאו ספרים":"עוד אין כאן ספרים"}</div>
                  {search.trim()&&<div style={{fontSize:13,marginBottom:14,lineHeight:1.6}}>אף אחד בסביבה עוד לא פרסם את "{search}"</div>}
                  {search.trim()&&(isGuest
                    ? <button onClick={onGuestAction} style={{padding:"11px 20px",background:C.accent,color:"#fff",border:"none",borderRadius:11,fontSize:14,fontWeight:700,cursor:"pointer"}}>הירשמו ונודיע לכם כשיגיע</button>
                    : user&&<button onClick={async()=>{setWishQuery(search);setShowWishModal(true);setWishLoading(true);setWishResults([]);try{const d=await api.get("/api/books/search-google?q="+encodeURIComponent(search));setWishResults(Array.isArray(d)?d:[]);}catch{}setWishLoading(false);}} style={{padding:"11px 20px",background:C.accent,color:"#fff",border:"none",borderRadius:11,fontSize:14,fontWeight:700,cursor:"pointer"}}>🔔 עדכנו אותי כשיתווסף</button>)}
                  {!search.trim()&&modeFilter==="all"&&!isGuest&&<button onClick={()=>setTab("add")} style={{padding:"11px 20px",background:C.ink,color:"#fff",border:"none",borderRadius:11,fontSize:14,fontWeight:700,cursor:"pointer"}}>פרסמו את הספר הראשון בשכונה</button>}
                </div>
              : books.map(b => <BookCard key={b.id} book={b} onEdit={String(b.ownerid)===String(user?.id)&&!b.dealstatus?setEditBook:null} isGuest={isGuest} onGuest={onGuestAction} user={user} onView={b=>{setViewBook(b);api.track("book_view",{bookId:b.id,title:b.title});}} onViewUser={id=>{setViewUserId(id);navigate(`?user=${id}`);}}/>)
        )}

        {/* הוספה */}
        {tab === "add" && (
          isGuest
            ? <div style={{textAlign:"center",padding:"56px 20px"}}>
                <div style={{fontSize:48,marginBottom:12}}>📚</div>
                <div style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:7}}>להוסיף ספרים נדרש חשבון</div>
                <Btn onClick={onGuestAction} style={{padding:"11px 26px"}}>הצטרף עכשיו →</Btn>
              </div>
            : <AddBook user={user} onDone={b=>{setBooks(p=>[b,...p]);setMyBooks(p=>[b,...p]);setTab("search");}} toast_={toast_} coords={userCoords} onNeedPhone={()=>setShowSettings(true)}/>
        )}

        {/* פרופיל */}
        {tab === "profile" && (
          isGuest
            ? <div style={{textAlign:"center",padding:"56px 20px"}}>
                <div style={{fontSize:48,marginBottom:12}}>👀</div>
                <div style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:7}}>כניסה כאורח — צפייה בלבד</div>
                <Btn onClick={onGuestAction} style={{padding:"11px 26px"}}>הצטרף →</Btn>
              </div>
            : <div key="profile-content" style={{animation:"fadeUp .2s ease"}}>
                <div style={{background:C.white,borderRadius:18,border:`1px solid ${C.border}`,padding:"22px 16px",marginBottom:12,textAlign:"center"}}>
                  <div style={{position:"relative",width:68,height:68,margin:"0 auto 12px"}}>
                    <div style={{width:68,height:68,borderRadius:"50%",background:HDR,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,overflow:"hidden"}}>
                      {user?.avatar ? <img src={user.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : (user?.type==="store"?"🏪":"👤")}
                    </div>
                    <label style={{position:"absolute",bottom:0,right:0,width:22,height:22,borderRadius:"50%",background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:12,boxShadow:"0 1px 4px rgba(0,0,0,.2)"}}>
                      📷
                      <input type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{
                        const file = e.target.files[0];
                        if (!file) return;
                        const canvas = document.createElement("canvas");
                        const img = new Image();
                        const objectUrl = URL.createObjectURL(file);
                        img.onload = async () => {
                          const MAX = 300;
                          const ratio = Math.min(MAX/img.width, MAX/img.height, 1);
                          canvas.width = img.width * ratio;
                          canvas.height = img.height * ratio;
                          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                          const avatar = canvas.toDataURL("image/jpeg", 0.8);
                          URL.revokeObjectURL(objectUrl);
                          try {
                            const d = await api.post("/api/users/"+user.id+"/avatar", {avatar});
                            const nu = {...user, avatar: d.avatar}; setUser(nu); session.saveUser(nu);
                            toast_("התמונה עודכנה ✓");
                          } catch(err) { toast_(err.message, "err"); }
                        };
                        img.src = objectUrl;
                      }}/>
                    </label>
                  </div>
                  <div style={{fontSize:18,fontWeight:800,color:C.ink,marginBottom:3}}>{user?.storeName||user?.name}</div>
                  {user?.bio
                    ? <div onClick={()=>{setBioText(user.bio);setEditBio(true);}} style={{fontSize:13,color:C.muted,fontStyle:"italic",marginBottom:6,cursor:"pointer"}}>"{user.bio}"</div>
                    : <button onClick={()=>{setBioText("");setEditBio(true);}} style={{fontSize:11,color:C.indigo,background:"none",border:"none",cursor:"pointer",padding:"2px 0 6px",fontStyle:"italic"}}>✏️ כמה מילים עלי</button>}
                  <div style={{fontSize:12,color:C.muted,marginBottom:6,direction:"ltr"}}>{user?.email}</div>
                  {user?.phone ? <div style={{fontSize:13,color:C.muted,direction:"ltr"}}>📞 {user?.phone}</div>
                    : <button onClick={()=>setShowSettings(true)} style={{fontSize:13,color:C.red,background:C.redL,border:"none",borderRadius:9,padding:"6px 12px",cursor:"pointer",fontWeight:600}}>הוסיפו טלפון כדי לפרסם ספרים</button>}
                  {user?.address&&<div style={{fontSize:13,color:C.muted,marginTop:3}}>📍 {user.address}</div>}
                  <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:14}}>
                    <button onClick={()=>setShowSettings(true)} style={{padding:"8px 14px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,fontSize:13,fontWeight:600,color:C.ink,cursor:"pointer"}}>⚙️ פרטים והגדרות</button>
                    <button onClick={()=>setViewUserId(user.id)} style={{padding:"8px 14px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,fontSize:13,fontWeight:600,color:C.ink,cursor:"pointer"}}>👁️ איך אחרים רואים אותי</button>
                  </div>
                </div>
                {myBooks.length===0&&<div style={{textAlign:"center",padding:"28px 16px",background:C.white,borderRadius:18,border:`1px dashed ${C.border}`,marginBottom:12}}>
                  <div style={{fontSize:36,marginBottom:8}}>📚</div>
                  <div style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:6}}>המדף שלך עוד ריק</div>
                  <div style={{fontSize:13,color:C.muted,marginBottom:14}}>צלמו כריכה והפרטים יתמלאו לבד</div>
                  <Btn onClick={()=>setTab("add")} style={{padding:"11px 22px"}}>הוספת ספר</Btn>
                </div>}
                {myBooks.filter(b=>b.avail).length>0&&<>
                  <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>על המדף</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:16}}>
                    {myBooks.filter(b=>b.avail).map(b=>(
                      <div key={b.id} style={{position:"relative"}}>
                        <div onClick={()=>setViewBook(b)} style={{aspectRatio:"2/3",borderRadius:8,overflow:"hidden",background:SPINES[parseInt(b.id)%SPINES.length]||"#888",cursor:"pointer"}}>
                          {(b.thumbnail||b.frontimg)?<img src={b.thumbnail||b.frontimg} alt="" loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{if(b.frontimg&&e.target.src!==b.frontimg)e.target.src=b.frontimg;else e.target.style.display="none";}}/>:<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",fontSize:28}}>📖</div>}
                        </div>
                        <button onClick={e=>{e.stopPropagation();setEditBook(b);}} style={{position:"absolute",top:4,left:4,background:"rgba(0,0,0,.5)",border:"none",borderRadius:6,padding:"3px 6px",fontSize:10,color:"#fff",cursor:"pointer"}}>✏️</button>
                      </div>
                    ))}
                  </div>
                </>}
                {myBooks.filter(b=>!b.avail&&b.dealstatus&&b.dealstatus!==null).length>0&&<>
                  <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>עבר לספרייה אחרת</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:16}}>
                    {myBooks.filter(b=>!b.avail&&b.dealstatus&&b.dealstatus!==null).map(b=>(
                      <div key={b.id} onClick={()=>setViewBook(b)} style={{aspectRatio:"2/3",borderRadius:8,overflow:"hidden",background:SPINES[parseInt(b.id)%SPINES.length]||"#888",cursor:"pointer",filter:"grayscale(100%)",opacity:0.7}}>
                        {(b.thumbnail||b.frontimg)?<img src={b.thumbnail||b.frontimg} alt="" loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{if(b.frontimg&&e.target.src!==b.frontimg)e.target.src=b.frontimg;else e.target.style.display="none";}}/>:<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",fontSize:28}}>📖</div>}
                      </div>
                    ))}
                  </div>
                </>}
                {myBooks.filter(b=>!b.avail&&(!b.dealstatus||b.dealstatus===null)).length>0&&<>
                  <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>הורד מהמדף</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:16}}>
                    {myBooks.filter(b=>!b.avail&&(!b.dealstatus||b.dealstatus===null)).map(b=>(
                      <div key={b.id} style={{position:"relative"}}>
                        <div onClick={()=>setViewBook(b)} style={{aspectRatio:"2/3",borderRadius:8,overflow:"hidden",background:SPINES[parseInt(b.id)%SPINES.length]||"#888",cursor:"pointer",opacity:0.6}}>
                          {(b.thumbnail||b.frontimg)?<img src={b.thumbnail||b.frontimg} alt="" loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{if(b.frontimg&&e.target.src!==b.frontimg)e.target.src=b.frontimg;else e.target.style.display="none";}}/>:<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",fontSize:28}}>📖</div>}
                        </div>
                        <button onClick={e=>{e.stopPropagation();setEditBook(b);}} style={{position:"absolute",top:4,left:4,background:"rgba(0,0,0,.5)",border:"none",borderRadius:6,padding:"3px 6px",fontSize:10,color:"#fff",cursor:"pointer"}}>✏️</button>
                      </div>
                    ))}
                  </div>
                </>}
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
            <textarea value={bioText} onChange={e=>setBioText(e.target.value.slice(0,150))} placeholder="" style={{width:"100%",minHeight:80,borderRadius:10,border:`1px solid ${C.border}`,padding:"10px 12px",fontSize:13,fontFamily:"inherit",resize:"none",direction:"rtl",boxSizing:"border-box"}}/>
            <div style={{fontSize:11,color:C.muted,textAlign:"left",marginBottom:12}}>{bioText.length}/150</div>
            <div style={{display:"flex",gap:10}}>
              <Btn onClick={async()=>{try{await api.put("/api/users/"+user.id+"/profile",{bio:bioText});const nu={...user,bio:bioText};setUser(nu);session.saveUser(nu);toast_("הפרופיל עודכן ✓");setEditBio(false);}catch(e){toast_(e.message,"err");}}} style={{flex:1}}>שמור</Btn>
              <Btn variant="outline" onClick={()=>setEditBio(false)} style={{flex:1}}>ביטול</Btn>
            </div>
          </div>
        </div>
          }

      {/* Bottom nav */}
      <nav aria-label="ניווט ראשי" style={{display:"flex",background:C.white,borderTop:`1px solid ${C.border}`,boxShadow:"0 -2px 12px rgba(0,0,0,.07)",flexShrink:0,position:"sticky",bottom:0,zIndex:60,paddingBottom:"env(safe-area-inset-bottom)"}}>
        {TABS.map(([id,ic,lb])=>{
          const a = tab===id;
          return (
            <button key={id} aria-current={a?"page":undefined} onClick={()=>{
              setTab(id); navigate(`?tab=${id}`); window.scrollTo(0,0);
              if (id === "add" && navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  pos => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                  () => {},
                  { enableHighAccuracy: false, timeout: 10000 }
                );
              }
            }}
              style={{flex:1,padding:"10px 3px 8px",border:"none",background:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,borderTop:a?`2px solid ${C.ink}`:"2px solid transparent",transition:"border .12s"}}>
              {id==="profile"
                ? (user?.avatar
                    ? <div style={{width:a?26:22,height:a?26:22,borderRadius:"50%",overflow:"hidden",border:a?`2px solid ${C.ink}`:"2px solid #ccc"}}><img src={user.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/></div>
                    : <span style={{fontSize:a?24:21}}><IconProfile/></span>)
                : <span style={{fontSize:a?24:21}}>{ic}</span>}
              <span style={{fontSize:13,fontWeight:a?700:400,color:a?C.ink:C.muted}}>{lb}</span>
            </button>
          );
        })}
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
        <div style={{position:"fixed",inset:0,zIndex:700,direction:"rtl"}} onClick={()=>setMenuOpen(false)}>
          <div style={{position:"absolute",top:0,right:0,width:270,height:"100%",background:C.white,boxShadow:"-4px 0 24px rgba(0,0,0,.15)",display:"flex",flexDirection:"column",overflowY:"auto",animation:"slideIn .22s ease"}} onClick={e=>e.stopPropagation()}>
            <div style={{background:HDR,padding:"32px 20px 20px"}}>
              <div style={{fontFamily:"'Frank Ruhl Libre',serif",fontSize:19,fontWeight:900,color:"#fff"}}>ספרייה שכונתית</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.55)",marginTop:4}}>{isGuest?"Pageturner":`שלום, ${user?.name||""}`}</div>
            </div>
            <div style={{flex:1,padding:"12px 0"}}>
              {[
                {ic:"🔍",lb:"חיפוש",ac:()=>{setTab("search");setMenuOpen(false);}},
                {ic:"➕",lb:"הוסף ספר",ac:()=>{setTab("add");setMenuOpen(false);}},
                {ic:"👤",lb:"פרופיל",ac:()=>{setTab("profile");setMenuOpen(false);}},
                {ic:"📖",lb:"אודות",ac:()=>{setShowAbout(true);setMenuOpen(false);}},
                {ic:"✉️",lb:"צור קשר",ac:()=>{setShowContact(true);setMenuOpen(false);}},
                {ic:"🔒",lb:"מדיניות פרטיות",ac:()=>{setLegal("privacy");setMenuOpen(false);}},
                {ic:"📄",lb:"תנאי שימוש",ac:()=>{setLegal("terms");setMenuOpen(false);}},
              ].map((item,i)=>(
                <button key={i} onClick={item.ac} style={{width:"100%",padding:"14px 20px",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:12,fontSize:15,fontWeight:600,color:C.ink,textAlign:"right"}}>
                  <span style={{fontSize:20}}>{item.ic}</span>{item.lb}
                </button>
              ))}
            </div>
            {isGuest && <button onClick={()=>{setMenuOpen(false);session.clear();setUser(null);setScreen("splash");}} style={{padding:"16px 20px",background:"none",border:"none",borderTop:`1px solid ${C.border}`,cursor:"pointer",display:"flex",alignItems:"center",gap:12,fontSize:14,fontWeight:600,color:C.ink,textAlign:"right"}}><span style={{fontSize:18}}>👋</span>הרשמה / כניסה</button>}
            {!isGuest && <button onClick={logout} style={{padding:"16px 20px",background:"none",border:"none",borderTop:`1px solid ${C.border}`,cursor:"pointer",display:"flex",alignItems:"center",gap:12,fontSize:14,fontWeight:600,color:C.red,textAlign:"right"}}>
              <span style={{fontSize:18}}>🚪</span>יציאה
            </button>}
          </div>
        </div>
      )}

      {/* דף אודות */}
      {showAbout && (
        <div style={{position:"fixed",inset:0,zIndex:700,background:"rgba(14,12,8,.7)",display:"flex",alignItems:"flex-end",direction:"rtl"}} onClick={()=>setShowAbout(false)}>
          <div style={{width:"100%",maxWidth:480,margin:"0 auto",background:C.white,borderRadius:"22px 22px 0 0",maxHeight:"85vh",overflowY:"auto",padding:"24px 20px 40px"}} onClick={e=>e.stopPropagation()}>
            <div style={{width:32,height:4,borderRadius:99,background:C.border,margin:"0 auto 20px"}}/>
            <div style={{fontFamily:"'Frank Ruhl Libre',serif",fontSize:22,fontWeight:900,color:C.ink,marginBottom:6}}>ספרייה שכונתית | Pageturner</div>
            <div style={{fontSize:16,fontWeight:700,color:C.ink,marginTop:20,marginBottom:8}}>הסיפור התחיל עם ספר אחד</div>
            <div style={{fontSize:14,color:C.muted,lineHeight:1.8,marginBottom:16}}>חיפשתי ספר. ידעתי שהוא קיים, ראיתי שיש אותו אצל אנשים, אבל מצוא לא מצאתי. יצרתי קשר, שלחתי הודעות, ואפילו נסעתי רק כדי לגלות שהוא כבר עבר הלאה. המסע הזה עדיין לא נגמר, אבל משהו אחר כן התחיל.</div>
            <div style={{fontSize:16,fontWeight:700,color:C.ink,marginBottom:8}}>מה זה Pageturner?</div>
            <div style={{fontSize:14,color:C.muted,lineHeight:1.8,marginBottom:16}}>Page Turner באנגלית זה ספר שאי אפשר להפסיק לקרוא, כזה שאתה הופך דף אחרי דף בלי לעצור. זה גם מה שאנחנו רוצים שתרגיש כאן.</div>
            <div style={{fontSize:16,fontWeight:700,color:C.ink,marginBottom:8}}>הספרייה השכונתית</div>
            <div style={{fontSize:14,color:C.muted,lineHeight:1.8,marginBottom:24}}>כולנו מחזיקים ספרים שסיימנו, ספרים שכנראה לא נקרא, וספרים שמישהו אחר ממש עכשיו מחפש. הספרייה השכונתית הופכת את המדפים הביתיים של השכונה למדף אחד משותף, מקום למכור, להחליף, להשאיל או לתת ספרים לשכנים שלך. ואולי גם להכיר אנשים חדשים בדרך.</div>
            <button onClick={()=>setShowAbout(false)} style={{width:"100%",padding:"13px",borderRadius:12,background:C.ink,color:"#fff",border:"none",fontSize:15,fontWeight:700,cursor:"pointer"}}>סגור</button>
          </div>
        </div>
      )}
      {pendingContact && !pendingContact.askdeal && (
        <div style={{position:"fixed",bottom:80,left:0,right:0,zIndex:600,padding:"0 16px",direction:"rtl"}}>
          <div style={{background:C.white,borderRadius:16,padding:"16px",boxShadow:"0 4px 24px rgba(0,0,0,.15)",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:13,fontWeight:700,color:C.ink,marginBottom:12}}>
              יצרת קשר לגבי "{pendingContact.booktitle||pendingContact.bookid}" — האם סיכמתם משהו?
            </div>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <button onClick={()=>setAskDealMode(true)} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:C.teal,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>✅ כן, סיכמנו</button>
              <button onClick={()=>handleContactAnswer("no")} style={{flex:1,padding:"10px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,fontSize:13,fontWeight:600,cursor:"pointer",color:C.muted}}>❌ לא</button>
            </div>
            <button onClick={()=>handleContactAnswer("skip")} style={{width:"100%",padding:"7px",borderRadius:9,border:"none",background:"none",color:C.muted,fontSize:12,cursor:"pointer"}}>🔕 אל תשאל אותי שוב על זה</button>
          </div>
        </div>
      )}
      {pendingContact && askDealMode && (
        <div style={{position:"fixed",bottom:80,left:0,right:0,zIndex:600,padding:"0 16px",direction:"rtl"}}>
          <div style={{background:C.white,borderRadius:16,padding:"16px",boxShadow:"0 4px 24px rgba(0,0,0,.15)",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:13,fontWeight:700,color:C.ink,marginBottom:12,textAlign:"center"}}>מה סיכמתם?</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{s:"sold",ic:"🤝",t:"מכירה"},{s:"lent",ic:"📚",t:"השאלה"},{s:"swapped",ic:"🔄",t:"החלפה"},{s:"given",ic:"🎁",t:"מסירה"}].map(o=>(
                <button key={o.s} onClick={()=>{handleContactAnswer("done",o.s);setAskDealMode(false);}} style={{padding:"12px 8px",borderRadius:11,border:`1px solid ${C.border}`,background:C.white,cursor:"pointer",fontSize:12,fontWeight:700,color:C.ink}}>
                  <div style={{fontSize:22,marginBottom:4}}>{o.ic}</div>{o.t}
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
              <button onClick={()=>setOwnerAskDeal(true)} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:C.teal,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>✅ כן, סיכמנו</button>
              <button onClick={()=>handleOwnerAnswer("no")} style={{flex:1,padding:"10px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,fontSize:13,fontWeight:600,cursor:"pointer",color:C.muted}}>❌ לא</button>
            </div>
          </div>
        </div>
      )}
      {ownerPending && ownerAskDeal && (
        <div style={{position:"fixed",bottom:80,left:0,right:0,zIndex:600,padding:"0 16px",direction:"rtl"}}>
          <div style={{background:C.white,borderRadius:16,padding:"16px",boxShadow:"0 4px 24px rgba(0,0,0,.15)",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:13,fontWeight:700,color:C.ink,marginBottom:12,textAlign:"center"}}>מה סיכמתם?</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{s:"sold",ic:"🤝",t:"מכירה"},{s:"lent",ic:"📚",t:"השאלה"},{s:"swapped",ic:"🔄",t:"החלפה"},{s:"given",ic:"🎁",t:"מסירה"}].map(o=>(
                <button key={o.s} onClick={()=>handleOwnerAnswer("confirmed", o.s)} style={{padding:"12px 8px",borderRadius:11,border:`1px solid ${C.border}`,background:C.white,cursor:"pointer",fontSize:12,fontWeight:700,color:C.ink}}>
                  <div style={{fontSize:22,marginBottom:4}}>{o.ic}</div>{o.t}
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
  return (
    <div style={{position:"fixed",inset:0,zIndex:850,background:"rgba(14,12,8,.6)",display:"flex",alignItems:"flex-end",direction:"rtl"}} onClick={onClose}>
      <div role="dialog" aria-label={title} style={{width:"100%",maxWidth:520,margin:"0 auto",background:C.white,borderRadius:"22px 22px 0 0",maxHeight:"90vh",overflowY:"auto",padding:"20px 18px 28px",animation:"sheetUp .28s cubic-bezier(.33,1,.68,1)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:18,fontWeight:800,color:C.ink}}>{title}</div>
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
      <div style={{fontSize:13,color:C.muted,marginBottom:14,lineHeight:1.6}}>שאלה, הצעה, בעיה באתר או בקשה לגבי המידע שלך. נחזור אליך במייל{!isGuest&&user?.email?` (${user.email})`:""}.</div>
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
      <Inp label="שם" value={name} onChange={e=>setName(e.target.value)} icon="👤" autoComplete="name"/>
      <Inp label="טלפון" value={phone} onChange={e=>setPhone(e.target.value)} icon="📞" type="tel" inputMode="tel" placeholder="050-0000000" autoComplete="tel"/>
      <div style={{fontSize:11,color:C.muted,marginTop:-8,marginBottom:12}}>מוצג רק למשתמשים רשומים שפונים אליך לגבי ספר</div>
      <label style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:13,color:C.ink,lineHeight:1.5,cursor:"pointer",marginBottom:16}}>
        <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} style={{marginTop:3,width:18,height:18,accentColor:C.accent,flexShrink:0}}/>
        <span>לקבל עדכונים על ספרים חדשים בשכונה</span>
      </label>
      <Btn onClick={save} disabled={saving||!name.trim()} style={{width:"100%",padding:"14px"}}>{saving?"שומר...":"שמירה"}</Btn>
      <div style={{fontSize:12,color:C.muted,textAlign:"center",marginTop:12}}>
        <button onClick={()=>onShowLegal("privacy")} style={linkBtn}>מדיניות פרטיות</button> · <button onClick={()=>onShowLegal("terms")} style={linkBtn}>תנאי שימוש</button>
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
      <div style={{fontFamily:"'Frank Ruhl Libre',serif",fontSize:24,fontWeight:900,marginBottom:20}}>📊 Admin Panel</div>
      
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

function UserPage({ userId, onClose, onViewBook, HDR, SPINES }) {
  const [profile, setProfile] = useState(null);
  const [allBooks, setAllBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAllAvail, setShowAllAvail] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);

  useEffect(() => {
    setLoading(true);
    setProfile(null);
    setAllBooks([]);
    Promise.all([
      api.get("/api/users/"+encodeURIComponent(userId)).catch(()=>null),
      api.get("/api/books?ownerId="+encodeURIComponent(userId)+"&all=true").catch(()=>[])
    ]).then(([u,b])=>{
      setProfile(u||{});
      setAllBooks(Array.isArray(b)?b:[]);
      setLoading(false);
    });
  }, [userId]);

  const availBooks = allBooks.filter(b=>b.avail);
  const pastBooks = allBooks.filter(b=>!b.avail&&b.dealstatus&&b.dealstatus!==null);

  const city = allBooks.reduce((acc,b)=>{
    if(b.city){acc[b.city]=(acc[b.city]||0)+1;}
    return acc;
  }, {});
  const topCity = Object.keys(city).sort((a,b)=>city[b]-city[a])[0] || null;

  const BookGrid = ({books, showAll, onShowAll, isPast}) => (
    <>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
        {(showAll?books:books.slice(0,3)).map(b=>(
          <div key={b.id} onClick={()=>onViewBook(b)} style={{aspectRatio:"2/3",borderRadius:8,overflow:"hidden",background:SPINES[parseInt(b.id)%SPINES.length]||"#888",cursor:"pointer",position:"relative",filter:isPast?"grayscale(100%)":"none",opacity:isPast?0.7:1}}>
            {(b.thumbnail||b.frontimg)
              ? <img src={b.thumbnail||b.frontimg} alt="" loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{if(b.frontimg&&e.target.src!==b.frontimg)e.target.src=b.frontimg;else e.target.style.display="none";}}/>
              : <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",fontSize:28}}>📖</div>}
          </div>
        ))}
      </div>
      {!showAll && books.length>3 && (
        <button onClick={onShowAll} style={{width:"100%",marginTop:10,padding:"10px",background:"none",border:"1px solid #ede8de",borderRadius:10,fontSize:13,fontWeight:600,cursor:"pointer",color:"#2c2416"}}>
          עוד {books.length-3} ספרים
        </button>
      )}
    </>
  );

  return (
    <div style={{position:"fixed",inset:0,zIndex:550,background:"#f5f0e8",overflowY:"auto",direction:"rtl"}}>
      {/* Header */}
      <div style={{background:HDR,padding:"0 0 24px"}}>
        <div style={{padding:"14px 16px 0",display:"flex",alignItems:"center"}}>
          <button onClick={onClose} style={{background:"rgba(255,255,255,.15)",border:"none",cursor:"pointer",color:"#fff",padding:"6px 14px",borderRadius:20,fontSize:14,fontWeight:600}}>→ חזרה</button>
        </div>
        <div style={{textAlign:"center",padding:"16px 16px 0"}}>
          <div style={{width:90,height:90,borderRadius:"50%",background:"rgba(255,255,255,.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,margin:"0 auto 12px",overflow:"hidden",border:"3px solid rgba(255,255,255,.4)"}}>
            {loading
              ? <div style={{width:"100%",height:"100%",background:"rgba(255,255,255,.15)"}}/>
              : profile?.avatar
              ? <img src={profile.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              : <span>{profile?.type==="store"?"🏪":"👤"}</span>}
          </div>
          {loading
            ? <div style={{width:120,height:22,background:"rgba(255,255,255,.2)",borderRadius:6,margin:"0 auto 8px"}}/>
            : <div style={{fontSize:20,fontWeight:800,color:"#fff",marginBottom:4}}>{profile?.storeName||profile?.name||"משתמש"}</div>}
          {!loading && profile?.bio && <div style={{fontSize:13,color:"rgba(255,255,255,.7)",fontStyle:"italic",marginBottom:6,padding:"0 24px"}}>"{profile.bio}"</div>}
          {!loading && topCity && <div style={{fontSize:12,color:"rgba(255,255,255,.5)",marginBottom:8}}>📍 {topCity}</div>}
          {!loading && <div style={{display:"flex",justifyContent:"center",gap:24,marginTop:8}}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:18,fontWeight:800,color:"#fff"}}>{availBooks.length}</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,.5)"}}>זמינים</div>
            </div>
            {pastBooks.length>0 && <div style={{textAlign:"center"}}>
              <div style={{fontSize:18,fontWeight:800,color:"rgba(255,255,255,.6)"}}>{pastBooks.length}</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>עברו דרכי</div>
            </div>}
          </div>}
        </div>
      </div>

      {/* Content */}
      <div style={{padding:"16px"}}>
        {loading ? (
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
            {[1,2,3].map(i=>(
              <div key={i} style={{aspectRatio:"2/3",borderRadius:8,background:"#e0ddd8",animation:"pulse 1.5s ease-in-out infinite"}}/>
            ))}
          </div>
        ) : (
          <>
            {availBooks.length>0 && (
              <div style={{marginBottom:24}}>
                <div style={{fontSize:12,fontWeight:700,color:"#9c8f7a",marginBottom:10,letterSpacing:".5px",textTransform:"uppercase"}}>על המדף</div>
                <BookGrid books={availBooks} showAll={showAllAvail} onShowAll={()=>setShowAllAvail(true)} isPast={false}/>
              </div>
            )}
            {pastBooks.length>0 && (
              <div>
                <div style={{fontSize:12,fontWeight:700,color:"#9c8f7a",marginBottom:10,letterSpacing:".5px",textTransform:"uppercase"}}>עבר לספרייה אחרת</div>
                <BookGrid books={pastBooks} showAll={showAllPast} onShowAll={()=>setShowAllPast(true)} isPast={true}/>
              </div>
            )}
            {availBooks.length===0 && pastBooks.length===0 && (
              <div style={{textAlign:"center",padding:"40px 20px",color:"#9c8f7a"}}>
                <div style={{fontSize:40,marginBottom:8}}>📚</div>
                <div style={{fontSize:14}}>אין ספרים עדיין</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BookPage({ book, onClose, isGuest, onGuest, user, onBookUpdated, onContactMade, onViewUser, toast_ }) {

  const [showCloseDeal, setShowCloseDeal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [phone, setPhone] = useState(null);
  const isOwner = !!user?.id && String(book.ownerid)===String(user?.id);
  const canContact = book.avail && !isGuest && !!user?.id && !isOwner;

  // מספר הטלפון נטען רק למשתמש מחובר שפתח את דף הספר
  useEffect(() => {
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
  const color = SPINES[parseInt(book.id) % SPINES.length] || "#888";
  const m = MODES[book.mode] || MODES.sell;
  const waMsg = book.mode==="sell"
    ? `היי ${book.ownername||""}, פניתי דרך Pageturner לגבי "${book.title}". האם הוא זמין לרכישה?`
    : book.mode==="lend"
    ? `היי ${book.ownername||""}, פניתי דרך Pageturner לגבי "${book.title}". האם הוא זמין להשאלה?`
    : book.mode==="swap"
    ? `היי ${book.ownername||""}, פניתי דרך Pageturner לגבי "${book.title}". האם תרצה להחליף?`
    : `היי ${book.ownername||""}, פניתי דרך Pageturner לגבי "${book.title}". האם הוא עדיין זמין למסירה?`;

  return (
    <div style={{position:"fixed",inset:0,zIndex:500,background:"rgba(14,12,8,.7)",display:"flex",alignItems:"flex-end",direction:"rtl"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:"100%",maxWidth:480,margin:"0 auto",background:C.white,borderRadius:"22px 22px 0 0",maxHeight:"92vh",overflowY:"auto",animation:"sheetUp .28s cubic-bezier(.33,1,.68,1)"}}>
        <div style={{padding:"12px 0 4px",display:"flex",justifyContent:"center"}}><div style={{width:32,height:4,borderRadius:99,background:C.border}}/></div>
        <div style={{padding:"4px 17px 32px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:15,fontWeight:800,color:C.ink}}>פרטי הספר</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={share} aria-label="שיתוף" style={{background:C.bg,border:"none",borderRadius:9,height:32,padding:"0 12px",cursor:"pointer",fontSize:13,fontWeight:600,color:C.ink}}>↗ שיתוף</button>
              <button onClick={onClose} aria-label="סגירה" style={{background:C.bg,border:"none",borderRadius:9,width:32,height:32,cursor:"pointer",fontSize:16}}>✕</button>
            </div>
          </div>
          <div style={{display:"flex",gap:14,marginBottom:18}}>
            <div style={{width:92,height:132,borderRadius:"4px 10px 10px 4px",flexShrink:0,background:color,overflow:"hidden",boxShadow:`4px 4px 14px ${color}44`}}>
              {(book.thumbnail||book.frontimg)
                ? <img src={book.thumbnail||book.frontimg} alt={book.title} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                : <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",fontSize:28}}>📖</div>}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:18,fontWeight:800,color:C.ink,marginBottom:4,lineHeight:1.3}}>{book.title}</div>
              <div style={{fontSize:13,color:C.muted,marginBottom:4}}>{book.author}</div>
              {book.publisher&&<div style={{fontSize:12,color:C.muted}}>{book.publisher}{book.year?` (${book.year})`:""}</div>}
              <div style={{display:"inline-flex",alignItems:"center",gap:5,marginTop:8,padding:"4px 10px",background:m.bg,borderRadius:99}}>
                <span style={{fontSize:12}}>{m.icon}</span>
                <span style={{fontSize:12,fontWeight:700,color:m.fg}}>{m.label}{book.mode==="sell"&&book.price?` · ₪${book.price}`:""}</span>
              </div>
            </div>
          </div>
          {book.summary&&<div style={{background:C.bg,borderRadius:12,padding:"12px 14px",marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6}}>תקציר</div>
            <div style={{fontSize:13,color:C.ink,lineHeight:1.7}}>{book.summary}</div>
          </div>}
          <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
            {book.condition&&<div style={{background:C.bg,borderRadius:99,padding:"5px 12px",fontSize:12,color:C.muted}}>⭐ {book.condition}</div>}
            {book.city&&<div style={{background:C.bg,borderRadius:99,padding:"5px 12px",fontSize:12,color:C.muted}}>📍 {book.city}</div>}
            {book.km!=null&&!isNaN(book.km)&&<div style={{background:C.bg,borderRadius:99,padding:"5px 12px",fontSize:12,color:C.muted}}>{kmLabel(book,user)}</div>}
            {book.mode==="lend"&&book.lenduntil&&<div style={{background:C.bg,borderRadius:99,padding:"5px 12px",fontSize:12,color:C.muted}}>↩ להחזיר עד {new Date(book.lenduntil).toLocaleDateString("he-IL")}</div>}
            {book.mode==="swap"&&book.swapfor&&<div style={{background:C.bg,borderRadius:99,padding:"5px 12px",fontSize:12,color:C.muted}}>⇄ מחפש: {book.swapfor}</div>}
          </div>
          <button onClick={()=>book.ownerid&&onViewUser&&onViewUser(book.ownerid)} style={{width:"100%",display:"flex",alignItems:"center",gap:10,background:C.bg,border:"none",borderRadius:12,padding:"10px 14px",marginBottom:16,cursor:book.ownerid?"pointer":"default",textAlign:"right"}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:color,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,flexShrink:0}}>
              {book.owneravatar ? <img src={book.owneravatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : (book.ownername||"?")[0]}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted}}>המפרסם</div>
              <div style={{fontSize:14,fontWeight:700,color:C.ink}}>{book.ownername||"משתמש"}</div>
            </div>
            {book.ownerid&&<span style={{fontSize:12,color:C.muted}}>לפרופיל ←</span>}
          </button>
          {book.avail&&!isOwner&&(
            isGuest || !user?.id
              ? <Btn onClick={onGuest} style={{width:"100%",padding:"15px",fontSize:15}}>הירשמו כדי לפנות למפרסם</Btn>
              : phone === null
                ? <div style={{textAlign:"center",padding:"14px",color:C.muted,fontSize:13}}><Spinner/></div>
                : phone
                  ? <div style={{display:"flex",gap:10}}>
                      <a href={`https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}`} target="_blank" rel="noreferrer" style={{flex:1,textDecoration:"none"}} onClick={()=>recordContact("whatsapp")}>
                        <Btn style={{width:"100%",padding:"15px",fontSize:15,background:"#25D366",color:"#fff"}}>וואטסאפ למפרסם</Btn>
                      </a>
                      <a href={`tel:${phone}`} aria-label="שיחת טלפון" style={{textDecoration:"none"}} onClick={()=>recordContact("phone")}>
                        <Btn style={{padding:"15px 18px",fontSize:18,background:C.bg,color:C.ink,border:`1px solid ${C.border}`}}>📞</Btn>
                      </a>
                    </div>
                  : <div style={{textAlign:"center",padding:"12px",background:C.bg,borderRadius:12,color:C.muted,fontSize:13}}>אין למפרסם מספר טלפון זמין כרגע</div>
          )}
          {!book.avail&&<div style={{textAlign:"center",padding:"12px",background:"#fef2f2",borderRadius:12,color:C.red,fontWeight:700,fontSize:13}}>⛔ הספר אינו זמין כרגע</div>}
          {String(book.ownerid)===String(user?.id) && !book.dealstatus && <>
            <div style={{display:"flex",gap:8,marginTop:10}}>
              <button onClick={()=>{onClose();setTimeout(()=>document.dispatchEvent(new CustomEvent("editBook",{detail:book})),100);}} style={{flex:1,padding:"11px",borderRadius:11,border:`1px solid ${C.border}`,background:C.bg,fontSize:13,cursor:"pointer",color:C.muted,fontWeight:600}}>✏️ ערוך</button>
              <button onClick={()=>{onClose();setTimeout(()=>document.dispatchEvent(new CustomEvent("deleteBook",{detail:book})),100);}} style={{flex:1,padding:"11px",borderRadius:11,border:`1px solid ${C.red}30`,background:"#fef2f2",fontSize:13,cursor:"pointer",color:C.red,fontWeight:600}}>🗑️ מחק</button>
            </div>
            {book.avail && <>
            {!showCloseDeal
              ? <button onClick={()=>setShowCloseDeal(true)} style={{width:"100%",marginTop:8,padding:"11px",borderRadius:11,border:`1px solid ${C.border}`,background:C.bg,fontSize:13,cursor:"pointer",color:C.muted,fontWeight:600}}>
                  🤝 סגור עסקה
                </button>
              : <div style={{marginTop:10,background:C.bg,borderRadius:14,padding:"16px"}}>
                  <div style={{fontSize:13,fontWeight:800,color:C.ink,marginBottom:12,textAlign:"center"}}>מה קרה עם הספר?</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    {[
                      {s:"sold",   ic:"🤝", t:"נמכר"},
                      {s:"lent",   ic:"📚", t:"הושאל"},
                      {s:"swapped",ic:"🔄", t:"הוחלף"},
                      {s:"given",  ic:"🎁", t:"נמסר חינם"},
                      
                    ].map(o=>(
                      <button key={o.s} onClick={()=>closeDeal(o.s)} disabled={closing}
                        style={{padding:"12px 8px",borderRadius:11,border:`1px solid ${C.border}`,background:C.white,cursor:"pointer",fontSize:12,fontWeight:700,color:C.ink}}>
                        <div style={{fontSize:22,marginBottom:4}}>{o.ic}</div>{o.t}
                      </button>
                    ))}
                  </div>
                  <button onClick={()=>setShowCloseDeal(false)} style={{width:"100%",marginTop:10,padding:"9px",borderRadius:9,border:"none",background:"none",color:C.muted,fontSize:12,cursor:"pointer"}}>ביטול</button>
                </div>
            }
          </>}
            </>}
        </div>
      </div>
    </div>
  );
}

function kmLabel(book, user) {
  if (String(book.ownerid) === String(user?.id)) return "הספר שלך";
  if (book.km <= 0.5) return "פחות מק\"מ ממך";
  return `${book.km} ק"מ ממך`;
}

function BookCard({ book, onEdit, isGuest, onGuest, user, onView, onViewUser }) {
  const [exp, setExp] = useState(false);
  const color = SPINES[parseInt(book.id) % SPINES.length] || "#888";
  const m = MODES[book.mode] || MODES.sell;

  return (
    <div onClick={()=>onView&&onView(book)} style={{background:C.white,borderRadius:18,border:"1px solid #ede8de",padding:"15px",marginBottom:9,position:"relative",overflow:"hidden",boxShadow:"0 2px 9px rgba(0,0,0,.05)",cursor:"pointer"}}>
      <div style={{position:"absolute",top:0,right:0,width:4,height:"100%",background:color,opacity:.8}}/>
      <div style={{marginRight:11}}>
        <div style={{display:"flex",gap:11,marginBottom:10}}>
          {/* ספר thumbnail */}
          <div style={{width:58,height:84,borderRadius:"3px 8px 8px 3px",flexShrink:0,background:color,overflow:"hidden",position:"relative",boxShadow:`3px 3px 10px ${color}44`}}>
            {(book.thumbnail||book.frontimg)
              ? <img src={book.thumbnail||book.frontimg} alt="" loading="lazy" decoding="async" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              : <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>📖</div>
            }
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:17,fontWeight:800,lineHeight:1.3,marginBottom:2,color:C.ink}}>{book.title}</div>
            <div style={{fontSize:14,color:C.muted,marginBottom:7}}>
              {book.author}{book.publisher?` · ${book.publisher}`:""}{book.year?` (${book.year})`:""}
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5,alignItems:"center"}}>
              <span style={{display:"inline-flex",alignItems:"center",gap:3,padding:"3px 9px",borderRadius:99,fontSize:11,fontWeight:700,background:m.bg,color:m.fg}}>{m.icon} {m.label}</span>
{!book.avail&&<span style={{fontSize:12,color:C.red}}>● לא זמין</span>}
              {book.mode==="sell"&&book.price&&<span style={{fontSize:12,fontWeight:800,color:C.gold}}>₪{book.price}</span>}
            </div>
          </div>
        </div>

        {book.summary && (
          <>
            <div style={{fontSize:12,color:"#3d3830",background:C.bg,borderRadius:9,padding:"8px 11px",lineHeight:1.6,fontStyle:"italic",maxHeight:exp||book.summary.length<=110?"none":"3.2em",overflow:"hidden",WebkitMaskImage:exp||book.summary.length<=110?"none":"linear-gradient(to bottom,black 55%,transparent 100%)"}}>
              "{book.summary}"
            </div>
            {book.summary.length > 110 && <button onClick={e=>{e.stopPropagation();setExp(p=>!p)}} style={{fontSize:11,color:C.indigo,fontWeight:700,background:"none",border:"none",cursor:"pointer",padding:"3px 11px 0"}}>
              {exp?"פחות ▲":"קרא עוד ▼"}
            </button>}
          </>
        )}

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:9,borderTop:`1px solid ${C.border}`,marginTop:9}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div onClick={e=>{e.stopPropagation();if(book.ownerid&&onViewUser)onViewUser(book.ownerid);}} style={{width:28,height:28,borderRadius:"50%",background:color,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:11,overflow:"hidden",cursor:"pointer"}}>{book.owneravatar ? <img src={book.owneravatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover",pointerEvents:"none"}}/> : (book.ownername||book.ownerName||"?")[0]}</div>
            <div>
              <div onClick={e=>{e.stopPropagation();if(book.ownerid&&onViewUser)onViewUser(book.ownerid);}} style={{fontSize:12,fontWeight:700,color:C.ink,cursor:"pointer"}}>{book.ownername||book.ownerName}</div>
              <div style={{fontSize:12,color:C.muted}}>📍 {book.km!=null&&!isNaN(book.km)?kmLabel(book,user):book.city||"מיקום לא צוין"}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {onEdit
              ? <button onClick={e=>{e.stopPropagation();onEdit(book);}} aria-label="עריכה" style={{padding:"7px 12px",background:C.bg,border:`1px solid ${C.border}`,borderRadius:9,fontSize:12,fontWeight:700,cursor:"pointer",color:C.muted}}>✏️ עריכה</button>
              : book.avail && <>
              <span style={{padding:"7px 12px",background:"#dcfce7",borderRadius:9,color:"#15803d",fontSize:12,fontWeight:700}}>יצירת קשר ←</span>
            </>}
          </div>
        </div>
      </div>
    </div>
  );
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
          <Inp label="שם הספר" value={f.title} onChange={upd("title")} icon="📚"/>
          <Inp label="מחבר" value={f.author} onChange={upd("author")} icon="✍️"/>
          <div style={{display:"flex",gap:9}}>
            <div style={{flex:2}}><Inp label="הוצאה" value={f.publisher} onChange={upd("publisher")}/></div>
            <div style={{flex:1}}><Inp label="שנה" value={f.year} onChange={upd("year")}/></div>
          </div>
          <TA label="תקציר" value={f.summary} onChange={upd("summary")}/>
          <Inp label="מצב" value={f.condition} onChange={upd("condition")} icon="⭐"/>
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
                <div style={{fontSize:16,marginBottom:2}}>{m.icon}</div>{m.label}
              </button>
            ))}
          </div>
          {f.mode==="sell"&&<Inp label="מחיר (₪)" type="number" value={f.price} onChange={upd("price")} icon="₪"/>}
          {f.mode==="lend"&&<div style={{marginBottom:13}}>
            <div style={{fontSize:13,fontWeight:600,color:C.muted,marginBottom:6}}>תאריך החזרה</div>
            <input type="date" value={f.lendUntil||""} onChange={e=>setF(p=>({...p,lendUntil:e.target.value}))} min={new Date().toISOString().split("T")[0]} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1px solid ${C.border}`,fontSize:15,background:C.bg}}/>
          </div>}
          {f.mode==="swap"&&<Inp label="איזה ספר מחפש?" value={f.swapFor||""} onChange={e=>setF(p=>({...p,swapFor:e.target.value}))} placeholder="שם ספר / נושא / סוגה" icon="🔍"/>}
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
