export async function analyzeText(text) {
  try {
    const response = await fetch("http://localhost:3001/api/analyze/text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text })
    });

    const data = await response.json();
    return data.result || "No response";
  } catch (err) {
    console.error(err);
    return "Error connecting to server";
  }
}

export async function analyzeImage(file) {
  try {
    const formData = new FormData();
    formData.append("image", file);

    const response = await fetch("http://localhost:3001/api/analyze/front", {
      method: "POST",
      body: formData
    });

    const data = await response.json();
    return data.result || "No response";
  } catch (err) {
    console.error(err);
    return "Error connecting to server";
  }
}
