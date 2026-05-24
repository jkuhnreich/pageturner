export async function analyzeText(text) {
  const response = await fetch("http://10.133.110.206:3001/api/analyze/text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  const data = await response.json();

  // שולף רק את הטקסט מהתגובה של קלוד
  return data.content?.[0]?.text || "No response";
}
