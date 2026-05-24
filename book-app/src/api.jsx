export async function analyzeText(text) {
  try {
    const res = await fetch("http://10.133.110.206:3001/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    const data = await res.json();
    return data.response;
  } catch (err) {
    console.error(err);
    return "Error connecting to server";
  }

