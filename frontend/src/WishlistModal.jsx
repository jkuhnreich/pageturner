import { useState, useEffect } from "react";
const API = "https://pageturner-production-5baf.up.railway.app";
export default function WishlistModal({ search, userId, onClose, toast_ }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(API+"/api/books/search-google?q="+encodeURIComponent(search))
      .then(r=>r.json()).then(d=>{setResults(Array.isArray(d)?d:[]);setLoading(false);}).catch(()=>setLoading(false));
  }, [search]);
  const save = async (b) => {
    try {
      await fetch(API+"/api/wishlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId,query:b.title,googleId:b.googleId,title:b.title,author:b.author,thumbnail:b.thumbnail})});
      toast_("נודיע לך כש-"+b.title+" יתווסף!");
      onClose();
    } catch { toast_("שגיאה","err"); }
  };
  return (
    <div style={{position:"fixed",inset:0,zIndex:800,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"flex-end"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"20px",width:"100%",maxHeight:"70vh",overflowY:"auto",direction:"rtl"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:16,fontWeight:800,marginBottom:4,color:"#1E2D3D"}}>בחר את הספר שחיפשת</div>
        <div style={{fontSize:12,color:"#7a8a7a",marginBottom:14}}>נודיע לך כשהספר יתווסף לפלטפורמה</div>
        {loading ? <div style={{textAlign:"center",padding:30}}>טוען...</div>
        : results.length===0 ? <div style={{textAlign:"center",padding:30,color:"#7a8a7a"}}>לא נמצאו תוצאות</div>
        : results.map(b=>(
          <div key={b.googleId} onClick={()=>save(b)} style={{display:"flex",gap:12,padding:"10px 0",borderBottom:"1px solid #eee",cursor:"pointer",alignItems:"center"}}>
            {b.thumbnail ? <img src={b.thumbnail} alt="" style={{width:40,height:56,objectFit:"cover",borderRadius:4}}/> : <div style={{width:40,height:56,background:"#e0ddd8",borderRadius:4}}/>}
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#1E2D3D"}}>{b.title}</div>
              <div style={{fontSize:12,color:"#7a8a7a"}}>{b.author}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
