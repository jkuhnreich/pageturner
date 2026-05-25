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
function AddBook({ user, onDone, toast_ }) {
  const [step, setStep] = useState("choose"); // choose | camera | manual
  const [fp, setFp] = useState(null);  // front preview URL
  const [bp, setBp] = useState(null);  // back preview URL
  const [fl, setFl] = useState(false); // front loading
  const [bl, setBl] = useState(false); // back loading
  const [frontFile, setFrontFile] = useState(null);
  const [form, setForm] = useState({
    title:"", author:"", publisher:"", year:"",
    summary:"", condition:"", mode:"sell", price:""
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
      if (d.summary) {
        setForm(f => ({ ...f, summary: d.summary }));
        toast_("✓ תקציר חולץ מהכריכה האחורית");
      } else {
        toast_("כריכה נותחה — תקציר לא זוהה", "warn");
      }
    } catch (e) {
      toast_("שגיאה בניתוח כריכה אחורית: " + e.message, "err");
    } finally { setBl(false); }
  };

  const save = async () => {
    if (!form.title.trim()) return toast_("שם ספר הוא שדה חובה", "warn");
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k,v]) => { if(v) fd.append(k, String(v)); });
      fd.append("ownerName", user.storeName || user.name);
      fd.append("ownerId", user.id);
      fd.append("ownerType", user.type);
      fd.append("phone", user.phone);
      if (frontFile) fd.append("frontImage", frontFile);

      const res = await api.upload("/api/books", fd);
      toast_("הספר פורסם! 🎉");
      onDone(res.book);
    } catch (e) {
      toast_("שגיאה בפרסום: " + e.message, "err");
    } finally { setSaving(false); }
  };

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
      </div>

      <Btn onClick={save} disabled={!form.title.trim()||saving} style={{width:"100%",padding:"13px",borderRadius:13,marginBottom:24}}>
        {saving ? <><Spinner/> מפרסם...</> : "פרסם ספר ✨"}
      </Btn>
    </div>
  );
}

function Login({ onBack, onDone }) {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (!email.trim()) return setErr("הכנס אימייל");
    setLoading(true); setErr("");
    try {
      const res = await api.post("/api/users/login", { email });
      onDone(res.user);
    } catch(e) { setErr(e.message); }
    setLoading(false);
  };
  return (
    <div style={{minHeight:"100vh",background:HDR,display:"flex",alignItems:"center",justifyContent:"center",padding:24,direction:"rtl"}}>
      <div style={{background:C.paper,borderRadius:20,padding:28,width:"100%",maxWidth:380}}>
        <button onClick={onBack} style={{background:"none",border:"none",fontSize:16,color:C.muted,cursor:"pointer",marginBottom:20}}>← חזרה</button>
        <h2 style={{fontFamily:"'Playfair Display',serif",marginBottom:20}}>התחבר</h2>
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="אימייל" style={{width:"100%",padding:"16px",borderRadius:12,border:`1px solid ${C.border}`,marginBottom:14,fontSize:17}} />
        {err && <div style={{color:C.red,fontSize:13,marginBottom:10}}>⚠️ {err}</div>}
        <Btn onClick={submit} disabled={loading} style={{width:"100%",padding:"17px",borderRadius:14}}>{loading?"מתחבר...":"התחבר →"}</Btn>
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

  const submit = async () => {
    setLoading(true); setErr("");
    try {
      const res = await api.post("/api/users/register", { ...form, type });
      onDone(res.user);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
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
              <Btn onClick={submit} disabled={!valid||loading} style={{width:"100%",padding:"14px",borderRadius:13}}>
                {loading ? <><Spinner/> נרשם...</> : type==="store" ? "🏪 פתח חנות" : "📖 מדפדפים →"}
              </Btn>
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
  const [tab, setTab] = useState("search");
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [editBook, setEditBook] = useState(null);

  const toast_ = useCallback((msg, type="ok") => {
    setToast({msg, type});
    setTimeout(()=>setToast(null), 3000);
  }, []);

  const isGuest = user?.type === "guest";
  const onGuestAction = useCallback(() => setScreen("register"), []);

  // טען ספרים מהשרת
  const loadBooks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (modeFilter !== "all") params.set("mode", modeFilter);
      const data = await api.get(`/api/books?${params}`);
      setBooks(data);
    } catch(e) {
      toast_("שגיאה בטעינת ספרים: " + e.message, "err");
    } finally { setLoading(false); }
  }, [search, modeFilter, toast_]);

  useEffect(() => {
    if (screen === "app") {
      const t = setTimeout(loadBooks, 200);
      return () => clearTimeout(t);
    }
  }, [screen, search, modeFilter, loadBooks]);

  const handleReg = u => { setUser(u); setScreen("app"); toast_("ברוך הבא! 📖"); try { localStorage.setItem("pt_user", JSON.stringify(u)); localStorage.setItem("pt_screen", "app"); } catch {} };
  const handleGuest = () => { setUser({name:"אורח",type:"guest"}); setScreen("app"); };

  const saveEdit = async (id, fields) => {
    try {
      await api.post(`/api/books/${id}`, fields);  // PUT via api.post workaround — actually use fetch directly
      const r = await fetch(`/api/books/${id}`, {
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(fields)
      });
      if (!r.ok) throw new Error("שגיאה בעדכון");
      setBooks(p => p.map(b => b.id===id ? {...b,...fields} : b));
      setEditBook(null);
      toast_("✓ הספר עודכן");
    } catch(e) { toast_("שגיאה: " + e.message, "err"); }
  };

  const deleteBook = async id => {
    try {
      const r = await fetch(`/api/books/${id}`, {method:"DELETE"});
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
    <div style={{maxWidth:480,margin:"0 auto",minHeight:"100vh",display:"flex",flexDirection:"column",direction:"rtl",background:C.bg}}>
      <style>{CSS}</style>

      {/* Edit drawer */}
      {editBook && <EditDrawer book={editBook} onSave={saveEdit} onDelete={deleteBook} onCancel={()=>setEditBook(null)} toast_={toast_}/>}

      {/* Header */}
      <div style={{background:HDR,flexShrink:0}}>
        <div style={{padding:"14px 17px 0"}}>
          <div style={{display:"flex",gap:3,marginBottom:10,opacity:.25}}>
            {SPINES.map((c,i)=><div key={i} style={{flex:1,height:3,borderRadius:3,background:c}}/>)}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <button onClick={()=>{setTab("search");setSearch("");setModeFilter("all");}} style={{background:"none",border:"none",cursor:"pointer",textAlign:"right",padding:0}}>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:900,color:"#fff"}}>ספרייה שכונתית</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,.35)",marginTop:1}}>{isGuest?"👀 אורח":`👤 ${user?.name||""}`}</div>
            </button>
            {isGuest && <button onClick={onGuestAction} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.25)",borderRadius:9,padding:"5px 11px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>הצטרף →</button>}
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
            <button key={id} onClick={()=>setTab(id)}
              style={{flex:1,padding:"8px 3px 7px",border:"none",background:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,borderBottom:a?`2px solid ${C.ink}`:"2px solid transparent",transition:"border .12s"}}>
              <span style={{fontSize:a?18:16}}>{ic}</span>
              <span style={{fontSize:10,fontWeight:a?700:400,color:a?C.ink:C.muted}}>{lb}</span>
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
              : books.map(b => <BookCard key={b.id} book={b} onEdit={b.ownerid===user?.id?setEditBook:null} isGuest={isGuest} onGuest={onGuestAction}/>)
        )}

        {/* הוספה */}
        {tab === "add" && (
          isGuest
            ? <div style={{textAlign:"center",padding:"56px 20px"}}>
                <div style={{fontSize:48,marginBottom:12}}>📚</div>
                <div style={{fontSize:15,fontWeight:700,color:C.ink,marginBottom:7}}>להוסיף ספרים נדרש חשבון</div>
                <Btn onClick={onGuestAction} style={{padding:"11px 26px"}}>הצטרף עכשיו →</Btn>
              </div>
            : <AddBook user={user} onDone={b=>{setBooks(p=>[b,...p]);setTab("search");}} toast_={toast_}/>
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
                  {user?.phone&&<div style={{fontSize:13,color:C.muted}}>📞 {user.phone}</div>}
                  {user?.address&&<div style={{fontSize:13,color:C.muted,marginTop:3}}>📍 {user.address}</div>}
                </div>
                {books.filter(b=>b.ownerid===user?.id).length>0&&<>
                  <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>הספרים שלי</div>
                  {books.filter(b=>b.ownerid===user?.id).map(b=>(
                    <div key={b.id} style={{background:C.white,borderRadius:14,border:`1px solid ${C.border}`,padding:"11px 13px",marginBottom:8,display:"flex",alignItems:"center",gap:11}}>
                      <div style={{width:38,height:55,borderRadius:"3px 7px 7px 3px",background:SPINES[parseInt(b.id)%SPINES.length]||"#888",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>📖</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.title}</div>
                        <div style={{fontSize:11,color:C.muted}}>{b.author}</div>
                      </div>
                      <button onClick={()=>setEditBook(b)} style={{padding:"7px 11px",background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",color:C.muted}}>✏️ ערוך</button>
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
              <span style={{fontSize:a?21:18}}>{ic}</span>
              <span style={{fontSize:10,fontWeight:a?700:400,color:a?C.ink:C.muted}}>{lb}</span>
            </button>
          );
        })}
      </div>

      <Toast t={toast}/>
    </div>
  );
}

// ── כרטיס ספר ──────────────────────────────────────────────
function BookCard({ book, onEdit, isGuest, onGuest }) {
  const [exp, setExp] = useState(false);
  const color = SPINES[parseInt(book.id) % SPINES.length] || "#888";
  const m = MODES[book.mode] || MODES.sell;

  return (
    <div style={{background:C.white,borderRadius:18,border:"1px solid #ede8de",padding:"15px",marginBottom:9,position:"relative",overflow:"hidden",boxShadow:"0 2px 9px rgba(0,0,0,.05)"}}>
      <div style={{position:"absolute",top:0,right:0,width:4,height:"100%",background:color,opacity:.8}}/>
      <div style={{marginRight:11}}>
        <div style={{display:"flex",gap:11,marginBottom:10}}>
          {/* ספר thumbnail */}
          <div style={{width:50,height:72,borderRadius:"3px 8px 8px 3px",flexShrink:0,background:book.frontImg?undefined:color,overflow:"hidden",position:"relative",boxShadow:`3px 3px 10px ${color}44`}}>
            {(book.frontimg||book.thumbnail)
              ? <img src={book.frontimg||book.thumbnail} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              : <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>📖</div>
            }
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:800,lineHeight:1.3,marginBottom:2,color:C.ink}}>{book.title}</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:7}}>
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
            <button onClick={()=>setExp(p=>!p)} style={{fontSize:11,color:C.indigo,fontWeight:700,background:"none",border:"none",cursor:"pointer",padding:"3px 11px 0"}}>
              {exp?"פחות ▲":"קרא עוד ▼"}
            </button>
          </>
        )}

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:9,borderTop:`1px solid ${C.border}`,marginTop:9}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:color,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:11}}>{(book.ownerName||"?")[0]}</div>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:C.ink}}>{book.ownerName}</div>
              <div style={{fontSize:11,color:C.muted}}>📍 {book.km===0?"אצלך":`${book.km} ק"מ`}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {onEdit && <button onClick={()=>onEdit(book)} style={{padding:"6px 10px",background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",color:C.muted}}>✏️</button>}
            {book.avail && !book.mine && <>
              <a href={`tel:${book.phone}`} onClick={e=>{if(isGuest){e.preventDefault();onGuest();}}} style={{padding:"7px 10px",background:C.tealL,border:`1px solid ${C.teal}30`,borderRadius:9,color:C.teal,fontSize:12,fontWeight:700,textDecoration:"none"}}>📞</a>
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
    mode:book.mode||"sell", price:book.price||"", avail:book.avail!==false
  });
  const [del, setDel] = useState(false);
  const upd = k => e => setF(p=>({...p,[k]:e.target.value}));

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
