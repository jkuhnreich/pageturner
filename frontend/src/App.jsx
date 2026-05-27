const BASE = import.meta.env.VITE_API_URL || "";
// frontend/src/App.jsx
import { useState, useRef, useEffect, useCallback } from "react";

// ── כל קריאות ה-API עוברות דרך /api (proxy ל-3001) ─────────
const api = {
  async get(path) {
    const r = await fetch(BASE + path);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  },
  async upload(path, formData) {
    const r = await fetch(BASE + path, { method: "POST", body: formData });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  },
};

// ── עיצוב בסיסי ────────────────────────────────────────────
const C = {
  bg: "#f5f0e8", white: "#fff", ink: "#0e0c08", muted: "#8a8070",
  border: "#e8e2d8", accent: "#b5390e", gold: "#c4841a",
  teal: "#0f766e", tealL: "#f0fdf9", indigo: "#4338ca", indigoL: "#eef2ff",
  green: "#15803d", greenL: "#f0fdf4", red: "#dc2626", redL: "#fef2f2",
};
const HDR = "linear-gradient(150deg,#0e0c08,#1e1a10)";
const SPINES = ["#c0392b","#2980b9","#8e44ad","#16a085","#e67e22","#d35400","#27ae60","#7f3fbf"];
const MODES = {
  sell:  { label:"מכירה",  icon:"₪",  bg:"#fef8ec", fg:"#c4841a" },
  lend:  { label:"השאלה",  icon:"↩",  bg:"#eef2ff", fg:"#4338ca" },
  swap:  { label:"החלפה",  icon:"⇄",  bg:"#f0fdf9", fg:"#0f766e" },
  give:  { label:"מסירה",  icon:"🎁", bg:"#f0fdf4", fg:"#15803d" },
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Rubik:wght@400;500;600;700;800&display=swap');
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
`;

// ── קומפוננטים קטנים ────────────────────────────────────────
function Spinner() {
  return <span style={{display:"inline-block",fontSize:20,animation:"spin 1s linear infinite"}}>⏳</span>;
}

function Toast({ t }) {
  if (!t) return null;
  const bg = { ok: C.teal, warn: C.gold, err: C.accent }[t.type] || C.teal;
  return (
    <div style={{position:"fixed",bottom:90,left:"50%",transform:"translateX(-50%)",background:bg,color:"#fff",padding:"10px 20px",borderRadius:99,fontSize:13,fontWeight:700,zIndex:9999,whiteSpace:"nowrap",boxShadow:"0 4px 20px rgba(0,0,0,.25)",animation:"toastIn .28s cubic-bezier(.34,1.56,.64,1)"}}>
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
function AddBook({ user, onDone, toast_, coords }) {
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
  const upd = k => e => setForm(p=>({...p,[k]:e.target.value}));

  const scanFront = async file => {
    setFp(URL.createObjectURL(file));
    setFrontFile(file);
    setFl(true);
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
        thumbnail: d.thumbnail || f.thumbnail,
        genre:     d.genre     || f.genre,
      }));
      const cnt = [d.title, d.author, d.publisher].filter(Boolean).length;
      toast_(`✓ כריכה קדמית — ${cnt} פרטים חולצו`);
    } catch (e) {
      toast_("שגיאה בניתוח כריכה קדמית: " + e.message, "err");
    } finally { setFl(false); }
  };

  const scanBack = async file => {
    setBp(URL.createObjectURL(file));
    setBl(true);
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
      toast_("שגיאה בניתוח כריכה אחורית: " + e.message, "err");
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
      fd.append("ownerName", user.storeName || user?.name);
      fd.append("ownerId", user?.id);
      fd.append("ownerType", user?.type);
      if (location) { fd.append("lat", location.lat); fd.append("lng", location.lng); }
      fd.append("phone", user?.phone);
      if (frontFile) fd.append("frontImage", frontFile);

      const res = await api.upload("/api/books", fd);
      toast_("הספר פורסם! 🎉");
      onDone(res.book);
    } catch (e) {
      toast_("שגיאה בפרסום: " + e.message, "err");
    } finally { setSaving(false); }
  };

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
        ← חזרה
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

      <Btn onClick={save} disabled={!form.title.trim()||!form.author.trim()||saving} style={{width:"100%",padding:"13px",borderRadius:13,marginBottom:24}}>
        {saving ? <><Spinner/> מפרסם...</> : "פרסם ספר ✨"}
      </Btn>
    </div>
  );
}

function Login({ onBack, onDone }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState("email");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const sendOtp = async () => {
    if (!email.trim()) return setErr("הכנס אימייל");
    setLoading(true); setErr("");
    try {
      await api.post("/api/auth/send-otp", { email });
      setStep("code");
    } catch(e) { setErr(e.message); }
    setLoading(false);
  };

  const verifyOtp = async () => {
    if (!code.trim()) return setErr("הכנס קוד");
    setLoading(true); setErr("");
    try {
      const res = await api.post("/api/auth/verify-otp", { email, code });
      if (res.isNew) return setErr("משתמש לא נמצא — אנא הירשם");
      onDone(res.user);
    } catch(e) { setErr(e.message); }
    setLoading(false);
  };

  return (
    <div style={{minHeight:"100vh",background:HDR,display:"flex",alignItems:"center",justifyContent:"center",padding:24,direction:"rtl"}}>
      <div style={{background:C.paper,borderRadius:20,padding:28,width:"100%",maxWidth:380}}>
        <button onClick={step==="code"?()=>setStep("email"):onBack} style={{background:"none",border:"none",fontSize:16,color:C.muted,cursor:"pointer",marginBottom:20}}>← חזרה</button>
        <h2 style={{fontFamily:"'Playfair Display',serif",marginBottom:8}}>התחבר</h2>
        {step==="email" ? <>
          <p style={{fontSize:13,color:C.muted,marginBottom:20}}>נשלח לך קוד כניסה למייל</p>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="כתובת מייל" style={{width:"100%",padding:"16px",borderRadius:12,border:`1px solid ${C.border}`,marginBottom:14,fontSize:17}} />
          {err && <div style={{color:C.red,fontSize:13,marginBottom:10}}>⚠️ {err}</div>}
          <Btn onClick={sendOtp} disabled={loading} style={{width:"100%",padding:"17px",borderRadius:14}}>{loading?"שולח...":"שלח קוד →"}</Btn>
        </> : <>
          <p style={{fontSize:13,color:C.muted,marginBottom:20}}>הכנס את הקוד שנשלח ל-{email}</p>
          <input type="number" value={code} onChange={e=>setCode(e.target.value)} placeholder="קוד בן 6 ספרות" style={{width:"100%",padding:"16px",borderRadius:12,border:`1px solid ${C.border}`,marginBottom:14,fontSize:22,textAlign:"center",letterSpacing:8}} />
          {err && <div style={{color:C.red,fontSize:13,marginBottom:10}}>⚠️ {err}</div>}
          <Btn onClick={verifyOtp} disabled={loading} style={{width:"100%",padding:"17px",borderRadius:14}}>{loading?"מאמת...":"כניסה →"}</Btn>
          <button onClick={sendOtp} style={{width:"100%",marginTop:10,background:"none",border:"none",color:C.muted,fontSize:13,cursor:"pointer"}}>לא קיבלת? שלח שוב</button>
        </>}
      </div>
    </div>
  );
}

// ── מסך הרשמה ──────────────────────────────────────────────
function Register({ onBack, onDone }) {
  const [type, setType] = useState(null);
  const [form, setForm] = useState({ name:"", phone:"", email:"", storeName:"", address:"" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const upd = k => e => setForm(p=>({...p,[k]:e.target.value}));
  const valid = form.name && form.phone && form.email && (type!=="store" || (form.storeName && form.address));

  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState("");
  const [pendingUser, setPendingUser] = useState(null);

  const submit = async () => {
    setLoading(true); setErr("");
    try {
      const res = await api.post("/api/users/register", { ...form, type });
      await api.post("/api/auth/send-otp", { email: form.email });
      setPendingUser(res.user);
      setOtpStep(true);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const verifyOtp = async () => {
    if (!otp.trim()) return setErr("הכנס קוד");
    setLoading(true); setErr("");
    try {
      await api.post("/api/auth/verify-otp", { email: form.email, code: otp });
      onDone(pendingUser);
    } catch(e) { setErr(e.message); }
    setLoading(false);
  };

  const quotes = [
    "\"ספר טוב הוא חבר לכל החיים\" 📚",
    "\"מי שקורא חי אלף חיים\" ✨",
    "\"הכל מתחיל בפרק הבא...\" 📖",
  ];
  const q = quotes[Math.floor(Date.now()/1000) % 3];

  return (
    <div style={{minHeight:"100vh",background:C.bg,direction:"rtl"}}>
      <div style={{background:HDR,padding:"22px 17px 20px"}}>
        {onBack && <button onClick={onBack} style={{background:"rgba(255,255,255,.1)",border:"none",borderRadius:9,padding:"6px 12px",color:"rgba(255,255,255,.7)",fontSize:14,cursor:"pointer",marginBottom:12}}>← חזרה</button>}
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:24,fontWeight:900,color:"#fff"}}>
          {type ? "הרשמה" : "מדפדפים לפרק הבא 📖"}
        </div>
        {!type && <div style={{fontSize:13,color:"rgba(255,255,255,.5)",marginTop:4,fontStyle:"italic"}}>{q}</div>}
      </div>

      <div style={{padding:"18px 15px"}}>
        {!type
          ? <>
              <div style={{fontSize:13,color:C.muted,marginBottom:18,lineHeight:1.7,textAlign:"center"}}>
                רק שם, טלפון ומייל — ואנחנו בפרק הבא! 🙂
              </div>
              <div style={{display:"flex",gap:12}}>
                {[
                  {t:"private",i:"👤",tl:"אדם פרטי",   d:"שתף ספרים עם שכנים"},
                  {t:"store",  i:"🏪",tl:"חנות ספרים", d:"נהל מלאי וקבל התראות"},
                ].map(o=>(
                  <div key={o.t} onClick={()=>setType(o.t)}
                    style={{flex:1,background:C.white,borderRadius:18,border:`2px solid ${C.border}`,padding:"20px 12px",cursor:"pointer",textAlign:"center",boxShadow:"0 2px 9px rgba(0,0,0,.06)"}}>
                    <div style={{fontSize:38,marginBottom:10}}>{o.i}</div>
                    <div style={{fontSize:13,fontWeight:800,color:C.ink,marginBottom:5}}>{o.tl}</div>
                    <div style={{fontSize:11,color:C.muted,lineHeight:1.5}}>{o.d}</div>
                  </div>
                ))}
              </div>
            </>
          : <>
              <button onClick={()=>setType(null)} style={{background:C.bg,border:"none",borderRadius:9,padding:"6px 13px",cursor:"pointer",fontSize:13,marginBottom:14}}>← חזרה</button>
              <div style={{background:C.white,borderRadius:18,border:`1px solid ${C.border}`,padding:"16px",marginBottom:12}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:14}}>שדות עם * הם חובה</div>
                <Inp label="שם" required value={form.name}  onChange={upd("name")}  placeholder="השם שלך" icon="👤"/>
                <Inp label="טלפון" required value={form.phone} onChange={upd("phone")} placeholder="050-0000000" inputMode="tel" icon="📞"/>
                <Inp label="אימייל" required value={form.email} onChange={upd("email")} placeholder="email@example.com" type="email" icon="✉️"/>
                {type === "store" && <>
                  <div style={{height:1,background:C.border,margin:"12px 0"}}/>
                  <Inp label="שם החנות" required value={form.storeName} onChange={upd("storeName")} placeholder="שם החנות" icon="🏪"/>
                  <Inp label="כתובת החנות" required value={form.address} onChange={upd("address")} placeholder="רחוב, מספר, עיר" icon="📍"/>
                </>}
              </div>
              {err && <div style={{background:C.redL,borderRadius:10,padding:"10px 14px",fontSize:13,color:C.red,marginBottom:12}}>⚠️ {err}</div>}
              {otpStep ? <>
            <p style={{fontSize:13,color:C.muted,marginBottom:12}}>הכנס את הקוד שנשלח ל-{form.email}</p>
            <input type="number" value={otp} onChange={e=>setOtp(e.target.value)} placeholder="קוד בן 6 ספרות" style={{width:"100%",padding:"16px",borderRadius:12,border:`1px solid ${C.border}`,marginBottom:14,fontSize:22,textAlign:"center",letterSpacing:8}} />
            <Btn onClick={verifyOtp} disabled={loading} style={{width:"100%",padding:"14px",borderRadius:13}}>{loading?"מאמת...":"אמת וכנס →"}</Btn>
          </> : <Btn onClick={submit} disabled={!valid||loading} style={{width:"100%",padding:"14px",borderRadius:13}}>
            {loading ? <><Spinner/> שולח קוד...</> : type==="store" ? "🏪 פתח חנות" : "📖 מדפדפים →"}
          </Btn>}
            </>
        }
      </div>
    </div>
  );
}

// ── מסך פתיחה ──────────────────────────────────────────────
function Splash({ onReg, onGuest, onLogin }) {
  return (
    <div style={{minHeight:"100vh",background:HDR,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:28,direction:"rtl"}}>
      <div style={{display:"flex",gap:5,marginBottom:34}}>
        {SPINES.map((c,i)=>(
          <div key={i} style={{width:14,height:52+Math.sin(i*.9)*9,borderRadius:"3px 5px 5px 3px",background:c,boxShadow:`2px 2px 10px ${c}66`,animation:`spineRise .5s ${i*.07}s both ease`}}/>
        ))}
      </div>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:32,fontWeight:900,color:"#fff",textAlign:"center",lineHeight:1.15,marginBottom:9}}>ספרייה<br/>שכונתית</div>
      <div style={{color:"rgba(255,255,255,.4)",fontSize:14,marginBottom:44}}>השאל · קנה · החלף · גלה</div>
      <div style={{width:"100%",maxWidth:320,display:"flex",flexDirection:"column",gap:10}}>
        <Btn variant="accent" onClick={onReg} style={{width:"100%",padding:"14px",fontSize:15,borderRadius:13}}>הרשמה →</Btn>
              <Btn onClick={onLogin} style={{width:"100%",padding:"14px",fontSize:15,borderRadius:13,background:"rgba(255,255,255,.15)"}}>התחבר →</Btn>
        <button onClick={onGuest} style={{width:"100%",padding:"13px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.18)",borderRadius:13,color:"rgba(255,255,255,.75)",fontSize:14,cursor:"pointer"}}>כניסה כאורח 👀</button>
      </div>
    </div>
  );
}

// ── App ראשי ────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState(() => {
    try { return localStorage.getItem("pt_screen") || "splash"; } catch { return "splash"; }
  });
  const [user, setUser] = useState(() => {
    try { const u = localStorage.getItem("pt_user"); return u ? JSON.parse(u) : null; } catch { return null; }
  });
  const [books, setBooks] = useState([]);
  const [myBooks, setMyBooks] = useState([]);
  const [tab, setTab] = useState("search");
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("all");
  const [genreFilter, setGenreFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [editBook, setEditBook] = useState(null);
  const [viewBook, setViewBook] = useState(null);

  const toast_ = useCallback((msg, type="ok") => {
    setToast({msg, type});
    setTimeout(()=>setToast(null), 3000);
  }, []);

  const isGuest = user?.type === "guest";
  const onGuestAction = useCallback(() => setScreen("register"), []);

  // טען ספרים מהשרת
  const [userCoords, setUserCoords] = useState(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: false, timeout: 10000 }
      );
    }
  }, []);

  const loadMyBooks = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await api.get(`/api/books?ownerId=${user?.id}&all=true`);
      setMyBooks(data);
    } catch(e) {}
  }, [user?.id]);

  useEffect(() => {
    if (tab === "profile") loadMyBooks();
  }, [tab, loadMyBooks]);

  const loadBooks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (modeFilter !== "all") params.set("mode", modeFilter);
      if (genreFilter !== "all") params.set("genre", genreFilter);
      if (userCoords) { params.set("lat", userCoords.lat); params.set("lng", userCoords.lng); }
      const data = await api.get(`/api/books?${params}`);
      setBooks(data);
    } catch(e) {
      toast_("שגיאה בטעינת ספרים: " + e.message, "err");
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

  useEffect(() => {
    if (!user?.id || isGuest) return;
    const checkPending = async () => {
      try {
        const r = await fetch(BASE + `/api/contacts/pending/${user?.id}`);
        const d = await r.json();
        if (d) setPendingContact(d);
        // בדוק גם שאלות למפרסם
        const r2 = await fetch(BASE + `/api/contacts/owner-pending/${user?.id}`);
        const d2 = await r2.json();
        if (d2) setOwnerPending(d2);
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
      await fetch(BASE + `/api/contacts/${pendingContact.id}`, {
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ status: answer, dealStatus, bookId: pendingContact.bookid, markAsked })
      });
    } catch {}
    setPendingContact(null);
    setAskDealMode(false);
    if (answer === "done") { loadBooks(); loadMyBooks(); }
  };

  const recordContactApp = async (book, type) => {
    if (!user?.id || String(book.ownerid)===String(user?.id)) return;
    try {
      await fetch(BASE + "/api/contacts", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ bookId:book.id, bookTitle:book.title, fromUserId:user?.id, toUserId:book.ownerid, type })
      });
      // בדוק pending אחרי 3 שניות
      setTimeout(async () => {
        try {
          const r = await fetch(BASE + `/api/contacts/pending/${user?.id}`);
          const d = await r.json();
          if (d) setPendingContact(d);
        } catch {}
      }, 3000);
    } catch {}
  };

  const handleOwnerAnswer = async (answer, dealStatus) => {
    if (!ownerPending) return;
    try {
      await fetch(BASE + `/api/contacts/${ownerPending.id}`, {
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ 
          status: answer === "confirmed" ? "done" : "no",
          dealStatus, 
          bookId: ownerPending.bookid,
          confirmedByOwner: answer === "confirmed",
          markAsked: true
        })
      });
      if (answer === "confirmed") {
        toast_("✅ הספר ירד מזמינות — תודה על העדכון!");
        loadBooks();
        loadMyBooks();
      }
    } catch {}
    setOwnerPending(null);
    setOwnerAskDeal(false);
  };

  const handleReg = u => { setUser(u); setScreen("app"); toast_("ברוך הבא! 📖"); try { localStorage.setItem("pt_user", JSON.stringify(u)); localStorage.setItem("pt_screen", "app"); } catch {} };
  const handleGuest = () => { setUser({name:"אורח",type:"guest"}); setScreen("app"); };

  const saveEdit = async (id, fields) => {
    try {

      const r = await fetch(BASE + `/api/books/${id}`, {
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({...fields, userId: user?.id})
      });
      if (!r.ok) throw new Error("שגיאה בעדכון");
      setEditBook(null);
      toast_("✓ הספר עודכן");
      loadBooks();
      loadMyBooks();
    } catch(e) { toast_("שגיאה: " + e.message, "err"); }
  };

  const deleteBook = async id => {
    try {
      const r = await fetch(BASE + `/api/books/${id}?userId=${user?.id}`, {method:"DELETE"});
      if (!r.ok) throw new Error("שגיאה במחיקה");
      setBooks(p => p.filter(b => b.id!==id));
      setEditBook(null);
      toast_("🗑️ הספר נמחק", "warn");
    } catch(e) { toast_("שגיאה: " + e.message, "err"); }
  };

  // ── screens ──────────────────────────────────────────────
  if (screen === "splash") return <><style>{CSS}</style><Splash onReg={()=>setScreen("register")} onGuest={handleGuest} onLogin={()=>setScreen("login")}/></>;
  if (screen === "login") return <><style>{CSS}</style><Login onBack={()=>setScreen("splash")} onDone={(u)=>{setUser(u);setScreen("app");try{localStorage.setItem("pt_user",JSON.stringify(u));localStorage.setItem("pt_screen","app");}catch{}}}/></>; 
  if (screen === "register") return <><style>{CSS}</style><Register onBack={()=>setScreen(user?"app":"splash")} onDone={handleReg}/></>;

  const TABS = [
    ["search","🔍","חיפוש"],
    ["add",   "➕","הוסף"],
    ["profile","👤","פרופיל"],
  ];

  return (
    <div style={{maxWidth:480,margin:"0 auto",minHeight:"100vh",display:"flex",flexDirection:"column",direction:"rtl",background:C.bg,position:"relative"}}>
      <style>{CSS}</style>

      {/* Edit drawer */}
      {editBook && <EditDrawer book={editBook} onSave={saveEdit} onDelete={deleteBook} onCancel={()=>setEditBook(null)} toast_={toast_}/>}
      {viewBook && <BookPage book={viewBook} onClose={()=>setViewBook(null)} isGuest={isGuest} onGuest={onGuestAction} user={user} onBookUpdated={()=>{loadBooks();loadMyBooks();}} onContactMade={()=>{setTimeout(async()=>{try{const r=await fetch(BASE+`/api/contacts/pending/${user?.id}`);const d=await r.json();if(d)setPendingContact(d);}catch{}},3000);}}/>}

      {/* Header */}
      <div style={{background:HDR,flexShrink:0}}>
        <div style={{padding:"14px 17px 0"}}>
          <div style={{display:"flex",gap:3,marginBottom:10,opacity:.25}}>
            {SPINES.map((c,i)=><div key={i} style={{flex:1,height:3,borderRadius:3,background:c}}/>)}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <button onClick={()=>{setTab("search");setSearch("");setModeFilter("all");loadBooks();}} style={{background:"none",border:"none",cursor:"pointer",textAlign:"right",padding:0}}>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:900,color:"#fff"}}>ספרייה שכונתית</div>
            </button>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {!isGuest && <div style={{fontSize:11,color:"rgba(255,255,255,.5)",marginTop:1}}>{(()=>{const h=new Date().getHours();return h>=4&&h<12?"☀️ בוקר טוב":h<18?"🌤️ צהריים טובים":h<22?"🌆 ערב טוב":"🌙 לילה טוב";})()} {user?.name||""}</div>}
              {isGuest && <button onClick={onGuestAction} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.25)",borderRadius:9,padding:"5px 11px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>הצטרף →</button>}
              <button onClick={()=>setMenuOpen(true)} style={{background:"none",border:"none",cursor:"pointer",padding:"4px 6px",color:"#fff",fontSize:20,lineHeight:1}}>☰</button>
            </div>
          </div>
        </div>

        {tab === "search" && (
          <div style={{padding:"10px 15px 12px"}}>
            <div style={{position:"relative"}}>
              <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:15,opacity:.4,pointerEvents:"none"}}>🔍</span>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="חפש שם ספר, מחבר..."
                style={{width:"100%",padding:"10px 42px 10px 13px",background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.18)",borderRadius:11,color:"#fff",fontSize:14,outline:"none"}}
                onFocus={e=>e.target.style.background="rgba(255,255,255,.16)"}
                onBlur={e=>e.target.style.background="rgba(255,255,255,.1)"}
              />
            </div>
          </div>
        )}
      </div>

      {/* Top nav */}
      <div style={{background:C.white,borderBottom:`1px solid ${C.border}`,display:"flex",flexShrink:0}}>
        {TABS.map(([id,ic,lb])=>{
          const a = tab===id;
          return (
            <button key={id} onClick={()=>{
              setTab(id);
              if (id === "add" && navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  pos => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                  () => {},
                  { enableHighAccuracy: false, timeout: 10000 }
                );
              }
            }}
              style={{flex:1,padding:"8px 3px 7px",border:"none",background:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,borderBottom:a?`2px solid ${C.ink}`:"2px solid transparent",transition:"border .12s"}}>
              <span style={{fontSize:a?18:16}}>{ic}</span>
              <span style={{fontSize:13,fontWeight:a?700:400,color:a?C.ink:C.muted}}>{lb}</span>
            </button>
          );
        })}
      </div>

      {/* Filter chips */}
      {tab === "search" && (
        <div style={{display:"flex",gap:6,padding:"8px 13px",background:C.white,borderBottom:`1px solid ${C.border}`,overflowX:"auto",flexShrink:0}}>
          {[["all","הכל","📚"],["sell","מכירה","₪"],["lend","השאלה","↩"],["swap","החלפה","⇄"]].map(([k,l,ic])=>(
            <button key={k} onClick={()=>setModeFilter(k)}
              style={{padding:"5px 11px",borderRadius:99,fontSize:12,fontWeight:modeFilter===k?700:500,border:"none",cursor:"pointer",background:modeFilter===k?C.ink:C.bg,color:modeFilter===k?"#fff":C.muted,display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap"}}>
              {ic} {l}
            </button>
          ))}
        </div>
      )}

      {tab === "search" && (
        <div style={{display:"flex",gap:6,padding:"7px 13px",background:C.white,borderBottom:`1px solid ${C.border}`,overflowX:"auto",flexShrink:0,scrollbarWidth:"none"}}>
          <button onClick={()=>setGenreFilter("all")} style={{padding:"5px 11px",borderRadius:99,fontSize:12,fontWeight:genreFilter==="all"?700:500,border:"none",cursor:"pointer",background:genreFilter==="all"?C.teal:C.bg,color:genreFilter==="all"?"#fff":C.muted,whiteSpace:"nowrap",flexShrink:0}}>כל הסוגות</button>
          {["ספרות ורומנים","מתח","מדע בדיוני ופנטזיה","אהבה ורומנטיקה","היסטוריה","ביוגרפיה","מדע ופילוסופיה","פיתוח אישי","עסקים וכלכלה","ילדים ונוער","בישול ואפייה","שירה","יהדות ורוחניות","אחר"].map(g=>(
            <button key={g} onClick={()=>setGenreFilter(g)} style={{padding:"5px 11px",borderRadius:99,fontSize:12,fontWeight:genreFilter===g?700:500,border:"none",cursor:"pointer",background:genreFilter===g?C.teal:C.bg,color:genreFilter===g?"#fff":C.muted,whiteSpace:"nowrap",flexShrink:0}}>{g}</button>
          ))}
        </div>
      )}

      {/* Content */}
      <div style={{flex:1,overflowY:"auto",padding:"12px 12px 4px"}}>

        {/* חיפוש */}
        {tab === "search" && (
          loading
            ? <div style={{textAlign:"center",padding:"40px",color:C.muted}}><Spinner/><div style={{marginTop:10}}>טוען ספרים...</div></div>
            : books.length === 0
              ? <div style={{textAlign:"center",padding:"60px 20px",color:C.muted}}>
                  <div style={{fontSize:48,marginBottom:12}}>📭</div>
                  <div style={{fontSize:15,fontWeight:700,color:C.ink}}>לא נמצאו ספרים</div>
                </div>
              : books.map(b => <BookCard key={b.id} book={b} onEdit={String(b.ownerid)===String(user?.id)?setEditBook:null} isGuest={isGuest} onGuest={onGuestAction} user={user} onView={setViewBook} onContact={recordContactApp}/>)
        )}

        {/* הוספה */}
        {tab === "add" && (
          isGuest
            ? <div style={{textAlign:"center",padding:"56px 20px"}}>
                <div style={{fontSize:48,marginBottom:12}}>📚</div>
                <div style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:7}}>להוסיף ספרים נדרש חשבון</div>
                <Btn onClick={onGuestAction} style={{padding:"11px 26px"}}>הצטרף עכשיו →</Btn>
              </div>
            : <AddBook user={user} onDone={b=>{setBooks(p=>[b,...p]);setTab("search");}} toast_={toast_} coords={userCoords}/>
        )}

        {/* פרופיל */}
        {tab === "profile" && (
          isGuest
            ? <div style={{textAlign:"center",padding:"56px 20px"}}>
                <div style={{fontSize:48,marginBottom:12}}>👀</div>
                <div style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:7}}>כניסה כאורח — צפייה בלבד</div>
                <Btn onClick={onGuestAction} style={{padding:"11px 26px"}}>הצטרף →</Btn>
              </div>
            : <div style={{animation:"fadeUp .2s ease"}}>
                <div style={{background:C.white,borderRadius:18,border:`1px solid ${C.border}`,padding:"22px 16px",marginBottom:12,textAlign:"center"}}>
                  <div style={{width:68,height:68,borderRadius:"50%",background:HDR,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 12px"}}>
                    {user?.type==="store"?"🏪":"👤"}
                  </div>
                  <div style={{fontSize:18,fontWeight:800,color:C.ink,marginBottom:3}}>{user?.storeName||user?.name}</div>
                  <div style={{fontSize:12,color:C.muted,marginBottom:10}}>{user?.email}</div>
                  {user?.phone&&<div style={{fontSize:13,color:C.muted}}>📞 {user?.phone}</div>}
                  {user?.address&&<div style={{fontSize:13,color:C.muted,marginTop:3}}>📍 {user.address}</div>}
                </div>
                {myBooks.length>0&&<>
                  <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>הספרים שלי</div>
                  {myBooks.map(b=>(
                    <div key={b.id} onClick={()=>setViewBook(b)} style={{background:C.white,borderRadius:14,border:`1px solid ${C.border}`,padding:"11px 13px",marginBottom:8,display:"flex",alignItems:"center",gap:11,cursor:"pointer"}}>
                      <div style={{width:38,height:55,borderRadius:"3px 7px 7px 3px",background:SPINES[parseInt(b.id)%SPINES.length]||"#888",flexShrink:0,overflow:"hidden"}}>{(b.thumbnail||b.frontimg)?<img src={b.thumbnail||b.frontimg} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",fontSize:18}}>📖</div>}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.title}</div>
                        <div style={{fontSize:11,color:C.muted}}>{b.author}</div>
                      </div>
                      <button onClick={e=>{e.stopPropagation();setEditBook(b);}} style={{padding:"7px 11px",background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",color:C.muted}}>✏️ ערוך</button>
                    </div>
                  ))}
                </>}
                <Btn variant="outline" onClick={()=>{setUser(null);setScreen("splash");try{localStorage.removeItem("pt_user");localStorage.removeItem("pt_screen");}catch{}}} style={{width:"100%",marginTop:4}}>יציאה</Btn>
              </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{display:"flex",background:C.white,borderTop:`1px solid ${C.border}`,boxShadow:"0 -2px 12px rgba(0,0,0,.07)",flexShrink:0}}>
        {TABS.map(([id,ic,lb])=>{
          const a = tab===id;
          return (
            <button key={id} onClick={()=>setTab(id)}
              style={{flex:1,padding:"10px 3px 8px",border:"none",background:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,borderTop:a?`2px solid ${C.ink}`:"2px solid transparent",transition:"border .12s"}}>
              <span style={{fontSize:a?24:21}}>{ic}</span>
              <span style={{fontSize:13,fontWeight:a?700:400,color:a?C.ink:C.muted}}>{lb}</span>
            </button>
          );
        })}
      </div>

      <Toast t={toast}/>

      {/* תפריט המבורגר */}
      {menuOpen && (
        <div style={{position:"fixed",inset:0,zIndex:700,direction:"rtl"}} onClick={()=>setMenuOpen(false)}>
          <div style={{position:"absolute",top:0,right:0,width:260,height:"100%",background:C.white,boxShadow:"-4px 0 24px rgba(0,0,0,.15)",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
            <div style={{background:HDR,padding:"32px 20px 20px"}}>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:900,color:"#fff"}}>ספרייה שכונתית</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,.5)",marginTop:4}}>Pageturner</div>
            </div>
            <div style={{flex:1,padding:"12px 0"}}>
              {[
                {ic:"🔍",lb:"חיפוש",ac:()=>{setTab("search");setMenuOpen(false);}},
                {ic:"➕",lb:"הוסף ספר",ac:()=>{setTab("add");setMenuOpen(false);}},
                {ic:"👤",lb:"פרופיל",ac:()=>{setTab("profile");setMenuOpen(false);}},
                {ic:"📖",lb:"אודות",ac:()=>{setShowAbout(true);setMenuOpen(false);}},
              ].map((item,i)=>(
                <button key={i} onClick={item.ac} style={{width:"100%",padding:"14px 20px",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:12,fontSize:15,fontWeight:600,color:C.ink,textAlign:"right"}}>
                  <span style={{fontSize:20}}>{item.ic}</span>{item.lb}
                </button>
              ))}
            </div>
            {!isGuest && <button onClick={()=>{setUser(null);setScreen("splash");setMenuOpen(false);try{localStorage.removeItem("pt_user");localStorage.removeItem("pt_screen");}catch{}}} style={{padding:"16px 20px",background:"none",border:"none",borderTop:`1px solid ${C.border}`,cursor:"pointer",display:"flex",alignItems:"center",gap:12,fontSize:14,fontWeight:600,color:C.red,textAlign:"right"}}>
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
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:900,color:C.ink,marginBottom:6}}>ספרייה שכונתית | Pageturner</div>
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

function BookPage({ book, onClose, isGuest, onGuest, user, onBookUpdated, onContactMade }) {

  const [showCloseDeal, setShowCloseDeal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [contactId, setContactId] = useState(null);
  const [askDeal, setAskDeal] = useState(false);

  const recordContact = async (type) => {
    if (!user?.id || String(book.ownerid)===String(user?.id)) return;
    try {
      const r = await fetch(BASE + "/api/contacts", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ bookId:book.id, bookTitle:book.title, fromUserId:user?.id, toUserId:book.ownerid, type })
      });
      const d = await r.json();
      if (d.contact) setContactId(d.contact.id);
      // בדוק pending אחרי 3 שניות בלי רענון
      if (onContactMade) onContactMade();
    } catch {}
  };

  const closeDeal = async (status) => {
    setClosing(true);
    try {
      const r = await fetch(BASE + `/api/books/${book.id}`, {
        method: "PUT",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ userId: user?.id, avail: false, dealStatus: status })
      });
      if (!r.ok) throw new Error("שגיאה");
      onBookUpdated && onBookUpdated();
      onClose();
    } catch(e) {}
    setClosing(false);
  };
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
            <button onClick={onClose} style={{background:C.bg,border:"none",borderRadius:9,width:30,height:30,cursor:"pointer",fontSize:16}}>✕</button>
          </div>
          <div style={{display:"flex",gap:14,marginBottom:18}}>
            <div style={{width:70,height:100,borderRadius:"4px 10px 10px 4px",flexShrink:0,background:color,overflow:"hidden",boxShadow:`4px 4px 14px ${color}44`}}>
              {(book.thumbnail||book.frontimg)
                ? <img src={book.thumbnail||book.frontimg} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                : <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",fontSize:28}}>📖</div>}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:16,fontWeight:800,color:C.ink,marginBottom:4}}>{book.title}</div>
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
            {book.km!=null&&!isNaN(book.km)&&!isGuest&&<div style={{background:C.bg,borderRadius:99,padding:"5px 12px",fontSize:12,color:C.muted}}>{book.km<0.1?(String(book.ownerid)===String(user?.id)?"אצלך":"פחות מ-100 מטר"):`${book.km} ק"מ`}</div>}
          </div>
          <div style={{background:C.bg,borderRadius:12,padding:"12px 14px",marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:4}}>המפרסם</div>
            <div style={{fontSize:14,fontWeight:700,color:C.ink}}>{book.ownername||"משתמש"}</div>
          </div>
          {book.avail&&(
            isGuest
              ? <Btn onClick={onGuest} style={{width:"100%",padding:"14px",fontSize:15}}>הצטרף לפנייה 📱</Btn>
              : book.ownerid!==user?.id&&<div style={{display:"flex",gap:10}}>
                <a href={`https://wa.me/972${(book.phone||"").replace(/^0/,"")}?text=${encodeURIComponent(waMsg)}`} target="_blank" rel="noreferrer" style={{flex:1,textDecoration:"none"}} onClick={()=>recordContact("whatsapp")}>
                  <Btn style={{width:"100%",padding:"14px",fontSize:15,background:"#25D366",color:"#fff"}}>📱 וואטסאפ</Btn>
                </a>
                {book.phone&&<a href={`tel:${book.phone}`} style={{textDecoration:"none"}} onClick={()=>recordContact("phone")}>
                  <Btn style={{padding:"14px 18px",fontSize:18,background:C.bg,color:C.ink,border:`1px solid ${C.border}`}}>📞</Btn>
                </a>}
              </div>
          )}
          {!book.avail&&<div style={{textAlign:"center",padding:"12px",background:"#fef2f2",borderRadius:12,color:C.red,fontWeight:700,fontSize:13}}>⛔ הספר אינו זמין כרגע</div>}
          {String(book.ownerid)===String(user?.id) && <>
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

function BookCard({ book, onEdit, isGuest, onGuest, user, onView, onContact }) {
  const [exp, setExp] = useState(false);
  const color = SPINES[parseInt(book.id) % SPINES.length] || "#888";
  const m = MODES[book.mode] || MODES.sell;

  return (
    <div onClick={()=>onView&&onView(book)} style={{background:C.white,borderRadius:18,border:"1px solid #ede8de",padding:"15px",marginBottom:9,position:"relative",overflow:"hidden",boxShadow:"0 2px 9px rgba(0,0,0,.05)",cursor:"pointer"}}>
      <div style={{position:"absolute",top:0,right:0,width:4,height:"100%",background:color,opacity:.8}}/>
      <div style={{marginRight:11}}>
        <div style={{display:"flex",gap:11,marginBottom:10}}>
          {/* ספר thumbnail */}
          <div style={{width:50,height:72,borderRadius:"3px 8px 8px 3px",flexShrink:0,background:book.frontImg?undefined:color,overflow:"hidden",position:"relative",boxShadow:`3px 3px 10px ${color}44`}}>
            {(book.thumbnail||book.frontimg)
              ? <img src={book.thumbnail||book.frontimg} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
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
              <span style={{fontSize:12,color:book.avail?C.green:C.red}}>● {book.avail?"זמין":"לא זמין"}</span>
              {book.mode==="sell"&&book.price&&<span style={{fontSize:12,fontWeight:800,color:C.gold}}>₪{book.price}</span>}
            </div>
          </div>
        </div>

        {book.summary && (
          <>
            <div style={{fontSize:12,color:"#3d3830",background:C.bg,borderRadius:9,padding:"8px 11px",lineHeight:1.6,fontStyle:"italic",maxHeight:exp?"none":"3.2em",overflow:"hidden",WebkitMaskImage:exp?"none":"linear-gradient(to bottom,black 55%,transparent 100%)"}}>
              "{book.summary}"
            </div>
            <button onClick={e=>{e.stopPropagation();setExp(p=>!p)}} style={{fontSize:11,color:C.indigo,fontWeight:700,background:"none",border:"none",cursor:"pointer",padding:"3px 11px 0"}}>
              {exp?"פחות ▲":"קרא עוד ▼"}
            </button>
          </>
        )}

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:9,borderTop:`1px solid ${C.border}`,marginTop:9}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:color,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:11}}>{(book.ownername||book.ownerName||"?")[0]}</div>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:C.ink}}>{book.ownername||book.ownerName}</div>
              <div style={{fontSize:12,color:C.muted}}>📍 {!isGuest&&book.km!=null&&!isNaN(book.km)?(book.km<0.1?(String(book.ownerid)===String(user?.id)?"אצלך":"פחות מ-100 מטר"):`${book.km} ק"מ`):book.city||"מרחק לא ידוע"}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {onEdit
              ? <div style={{display:"flex",gap:5}}>
                  <button onClick={e=>{e.stopPropagation();onEdit(book);}} style={{padding:"6px 10px",background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",color:C.muted}}>✏️</button>
                </div>
              : book.avail && <>
              <a href={`tel:${book.phone}`} onClick={e=>{e.stopPropagation();if(isGuest){e.preventDefault();onGuest();}else{onContact&&onContact(book,"phone");}}} style={{padding:"7px 10px",background:C.tealL,border:`1px solid ${C.teal}30`,borderRadius:9,color:C.teal,fontSize:12,fontWeight:700,textDecoration:"none"}}>📞</a>
              {book.phone && <a
                href={`https://wa.me/972${(book.phone||"").replace(/^0/,"").replace(/-/g,"")}?text=${encodeURIComponent(
                  book.mode==="sell"?`היי ${book.ownername||""}, פניתי דרך Pageturner לגבי "${book.title}". האם הוא זמין לרכישה?`:
                  book.mode==="lend"?`היי ${book.ownername||""}, פניתי דרך Pageturner לגבי "${book.title}". האם הוא זמין להשאלה?`:
                  book.mode==="swap"?`היי ${book.ownername||""}, פניתי דרך Pageturner לגבי "${book.title}". האם תהיה מעוניין להחליף?`:
                  `היי ${book.ownername||""}, פניתי דרך Pageturner לגבי "${book.title}". האם הוא זמין למסירה?`
                )}`}
                onClick={e=>{e.stopPropagation();if(isGuest){e.preventDefault();onGuest();}else{onContact&&onContact(book,"whatsapp");}}}
                target="_blank"
                style={{padding:"7px 10px",background:"#dcfce7",border:"1px solid #16a34a30",borderRadius:9,color:"#16a34a",fontSize:12,fontWeight:700,textDecoration:"none"}}><svg viewBox="0 0 24 24" width="16" height="16" fill="#16a34a"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.528 5.855L.057 23.882l6.186-1.438A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.891 0-3.658-.511-5.18-1.401l-.36-.214-3.795.881.925-3.701-.236-.375A9.932 9.932 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg></a>}
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
