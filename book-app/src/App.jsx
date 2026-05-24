import { useState } from "react";
import { analyzeText, analyzeImage } from "./api";

export default function App() {
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [imageFile, setImageFile] = useState(null);

  const sendText = async () => {
    const response = await analyzeText(text);
    setResult(response);
  };

  const sendImage = async () => {
    if (!imageFile) {
      setResult("לא נבחרה תמונה");
      return;
    }

    setResult("מנתח תמונה...");
    const response = await analyzeImage(imageFile);
    setResult(response);
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Book Finder 🔎</h1>

      <h3>טקסט</h3>
      <textarea
        placeholder="Paste text here..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: "100%", height: 150 }}
      />

      <br /><br />
      <button onClick={sendText}>Analyze Text</button>

      <hr style={{ margin: "24px 0" }} />

      <h3>תמונה</h3>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setImageFile(e.target.files[0])}
      />

      <br /><br />
      <button onClick={sendImage}>Analyze Image</button>

      <hr style={{ margin: "24px 0" }} />

      <h3>תוצאה</h3>
      <pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
    </div>
  );
}
