import { Component } from "react";

// אם משהו נשבר — במקום מסך לבן, הודעה עם כפתור רענון
export default class ErrorBoundary extends Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error) { console.error("App crashed:", error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", background: "#1E2D3D", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, textAlign: "center", direction: "rtl", fontFamily: "Rubik, sans-serif" }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>📚</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>משהו השתבש</div>
        <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 24, maxWidth: 300, lineHeight: 1.6 }}>ריענון קטן בדרך כלל פותר את זה</div>
        <button onClick={() => { location.href = "/"; }} style={{ padding: "13px 28px", borderRadius: 12, border: "none", background: "#6B8F47", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>רענון</button>
      </div>
    );
  }
}
