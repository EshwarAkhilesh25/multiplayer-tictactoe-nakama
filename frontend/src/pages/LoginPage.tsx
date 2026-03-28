import React, { useState } from "react";
import { Session } from "@heroiclabs/nakama-js";
import client from "../utils/nakamaClient";

interface Props {
  onLogin: (session: Session) => void;
}

const LoginPage: React.FC<Props> = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!username.trim()) {
      setError("Please enter a username");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const trimmedUsername = username.trim();
      // Nakama requires custom ID to be 6-128 bytes, pad if needed
      const customId = trimmedUsername.padEnd(6, "_");
      const session = await client.authenticateCustom(customId, true, trimmedUsername);
      localStorage.setItem("lastUsername", trimmedUsername);
      onLogin(session);
    } catch (e: any) {
      console.error("Login error:", e);
      let msg = "Failed to connect. Is the server running?";
      if (e?.status) {
        try { msg = `Server error ${e.status}: ${await e.text()}`; } catch { msg = `Server error ${e.status}`; }
      } else if (e instanceof Error) {
        msg = e.message;
      }
      setError(msg);
    }
    setLoading(false);
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100vh", padding: "20px",
      background: "linear-gradient(135deg, #0a0e27 0%, #1a1a2e 30%, #16213e 60%, #0f3460 100%)",
      position: "relative",
      overflow: "hidden"
    }}>
      {/* Animated geometric shapes background */}
      <div style={{
        position: "absolute",
        top: "-10%",
        left: "-5%",
        width: "300px",
        height: "300px",
        background: "radial-gradient(circle, rgba(233, 69, 96, 0.3) 0%, transparent 70%)",
        borderRadius: "50%",
        filter: "blur(60px)",
        animation: "float 8s ease-in-out infinite"
      }}></div>
      <div style={{
        position: "absolute",
        top: "20%",
        right: "-10%",
        width: "400px",
        height: "400px",
        background: "radial-gradient(circle, rgba(0, 180, 216, 0.25) 0%, transparent 70%)",
        borderRadius: "50%",
        filter: "blur(80px)",
        animation: "float 10s ease-in-out infinite reverse"
      }}></div>
      <div style={{
        position: "absolute",
        bottom: "10%",
        left: "15%",
        width: "350px",
        height: "350px",
        background: "radial-gradient(circle, rgba(168, 85, 247, 0.2) 0%, transparent 70%)",
        borderRadius: "50%",
        filter: "blur(70px)",
        animation: "float 12s ease-in-out infinite"
      }}></div>
      <div style={{
        position: "absolute",
        bottom: "-5%",
        right: "20%",
        width: "250px",
        height: "250px",
        background: "radial-gradient(circle, rgba(250, 187, 36, 0.15) 0%, transparent 70%)",
        borderRadius: "50%",
        filter: "blur(60px)",
        animation: "float 9s ease-in-out infinite reverse"
      }}></div>
      
      {/* Floating X and O symbols */}
      <div style={{
        position: "absolute",
        top: "10%",
        left: "10%",
        fontSize: "120px",
        opacity: 0.08,
        color: "#e94560",
        animation: "float 6s ease-in-out infinite",
        textShadow: "0 0 30px rgba(233, 69, 96, 0.5)"
      }}>✕</div>
      <div style={{
        position: "absolute",
        bottom: "15%",
        right: "15%",
        fontSize: "120px",
        opacity: 0.08,
        color: "#00b4d8",
        animation: "float 8s ease-in-out infinite",
        textShadow: "0 0 30px rgba(0, 180, 216, 0.5)"
      }}>○</div>
      <div style={{
        position: "absolute",
        top: "40%",
        right: "5%",
        fontSize: "80px",
        opacity: 0.05,
        color: "#a855f7",
        animation: "float 7s ease-in-out infinite reverse"
      }}>✕</div>
      <div style={{
        position: "absolute",
        bottom: "40%",
        left: "8%",
        fontSize: "90px",
        opacity: 0.06,
        color: "#fbbf24",
        animation: "float 9s ease-in-out infinite"
      }}>○</div>
      <div style={{
        backgroundColor: "rgba(22, 33, 62, 0.85)",
        borderRadius: "24px",
        padding: "50px",
        width: "100%",
        maxWidth: "450px",
        boxShadow: "0 30px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.1), inset 0 1px 0 rgba(255,255,255,0.1)",
        backdropFilter: "blur(20px) saturate(180%)",
        animation: "fadeIn 0.6s ease-out",
        position: "relative",
        zIndex: 1,
        border: "1px solid rgba(255, 255, 255, 0.05)"
      }}>
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <h1 style={{
            fontSize: "48px",
            marginBottom: "12px",
            background: "linear-gradient(135deg, #e94560 0%, #00b4d8 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            fontWeight: "bold",
            letterSpacing: "2px"
          }}>
            ✕ TIC-TAC-TOE ○
          </h1>
          <p style={{
            color: "#aaa",
            fontSize: "18px",
            marginBottom: "8px",
            fontWeight: "500"
          }}>
            Multiplayer Battle Arena
          </p>
          <div style={{
            display: "flex",
            justifyContent: "center",
            gap: "20px",
            marginTop: "20px",
            flexWrap: "wrap"
          }}>
            <div style={{
              backgroundColor: "rgba(233, 69, 96, 0.1)",
              padding: "8px 16px",
              borderRadius: "20px",
              border: "1px solid rgba(233, 69, 96, 0.3)",
              fontSize: "12px",
              color: "#e94560"
            }}>
              🎮 Classic Mode
            </div>
            <div style={{
              backgroundColor: "rgba(0, 180, 216, 0.1)",
              padding: "8px 16px",
              borderRadius: "20px",
              border: "1px solid rgba(0, 180, 216, 0.3)",
              fontSize: "12px",
              color: "#00b4d8"
            }}>
              ⏱️ Timed Mode
            </div>
            <div style={{
              backgroundColor: "rgba(250, 187, 36, 0.1)",
              padding: "8px 16px",
              borderRadius: "20px",
              border: "1px solid rgba(250, 187, 36, 0.3)",
              fontSize: "12px",
              color: "#fbbf24"
            }}>
              📊 Leaderboards
            </div>
          </div>
        </div>
        <input
          type="text"
          placeholder="Enter your username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()}
          style={{
            width: "100%",
            padding: "16px",
            borderRadius: "12px",
            border: "2px solid rgba(233, 69, 96, 0.3)",
            backgroundColor: "rgba(15, 52, 96, 0.6)",
            color: "white",
            fontSize: "18px",
            marginBottom: "16px",
            boxSizing: "border-box",
            outline: "none",
            transition: "all 0.3s ease"
          }}
          onFocus={(e) => {
            e.target.style.borderColor = "#e94560";
            e.target.style.boxShadow = "0 0 20px rgba(233, 69, 96, 0.3)";
          }}
          onBlur={(e) => {
            e.target.style.borderColor = "rgba(233, 69, 96, 0.3)";
            e.target.style.boxShadow = "none";
          }}
        />
        {error && (
          <div style={{
            backgroundColor: "rgba(255, 107, 107, 0.1)",
            border: "1px solid rgba(255, 107, 107, 0.5)",
            borderRadius: "8px",
            padding: "12px",
            marginBottom: "16px",
            textAlign: "center",
            color: "#ff6b6b",
            animation: "shake 0.5s"
          }}>
            ⚠️ {error}
          </div>
        )}
        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width: "100%",
            padding: "18px",
            borderRadius: "12px",
            border: "none",
            background: loading ? "#666" : "linear-gradient(135deg, #e94560 0%, #ff6b9d 100%)",
            color: "white",
            fontSize: "18px",
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: "bold",
            boxShadow: loading ? "none" : "0 10px 30px rgba(233, 69, 96, 0.4)",
            transition: "all 0.3s ease",
            transform: loading ? "scale(0.98)" : "scale(1)",
            letterSpacing: "1px"
          }}
          onMouseEnter={(e) => {
            if (!loading) {
              e.currentTarget.style.transform = "scale(1.05)";
              e.currentTarget.style.boxShadow = "0 15px 40px rgba(233, 69, 96, 0.6)";
            }
          }}
          onMouseLeave={(e) => {
            if (!loading) {
              e.currentTarget.style.transform = "scale(1)";
              e.currentTarget.style.boxShadow = "0 10px 30px rgba(233, 69, 96, 0.4)";
            }
          }}
        >
          {loading ? "🔄 Connecting..." : "🎮 Play Now"}
        </button>
        
        <div style={{
          marginTop: "30px",
          textAlign: "center",
          color: "#666",
          fontSize: "13px"
        }}>
          <p style={{ marginBottom: "8px" }}>🏆 Compete with players worldwide</p>
          <p>💯 Track your stats and climb the leaderboard</p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
