import React, { useState } from "react";
import { Session } from "@heroiclabs/nakama-js";
import client from "../utils/nakamaClient";

interface Props {
  onLogin: (session: Session) => void;
}

// Generate a unique 8-char player ID
const generatePlayerId = (): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "TTT-";
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
};

// Resolve a username to ALL matching Player IDs via unauthenticated RPC
const resolveUsername = async (username: string): Promise<{ playerIds?: string[]; error?: string }> => {
  const host = process.env.REACT_APP_NAKAMA_HOST || "localhost";
  const port = process.env.REACT_APP_NAKAMA_PORT || "7350";
  const resp = await fetch(
    `http://${host}:${port}/v2/rpc/find_user_by_name?http_key=defaulthttpkey`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(JSON.stringify({ username }))
    }
  );
  if (!resp.ok) {
    const errText = await resp.text();
    console.error("RPC error:", errText);
    return { error: "Failed to look up username. Try using your Player ID." };
  }
  const json = await resp.json();
  const data = json.payload ? JSON.parse(json.payload) : json;
  if (data.error) return { error: data.message };
  // Support both new array format and old single-value format
  const playerIds = data.playerIds || (data.playerId ? [data.playerId] : []);
  if (playerIds.length === 0) return { error: "No account found with that name." };
  return { playerIds };
};

const LoginPage: React.FC<Props> = ({ onLogin }) => {
  const [displayName, setDisplayName] = useState("");
  const [loginInput, setLoginInput] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registeredId, setRegisteredId] = useState<string | null>(null);
  
  // Load saved login input and check for logout reason
  React.useEffect(() => {
    const savedPlayerId = localStorage.getItem("playerId");
    const savedDisplayName = localStorage.getItem("lastDisplayName");
    // Pre-fill with Player ID if available, otherwise display name
    if (savedPlayerId) {
      setLoginInput(savedPlayerId);
    } else if (savedDisplayName) {
      setLoginInput(savedDisplayName);
    }
    if (savedDisplayName) {
      setDisplayName(savedDisplayName);
    }
    const logoutReason = localStorage.getItem("logoutReason");
    if (logoutReason) {
      setError(logoutReason);
      localStorage.removeItem("logoutReason");
    }
  }, []);

  const handleSubmit = async () => {
    setError("");
    
    if (isRegister) {
      // --- REGISTER FLOW ---
      const trimmedName = displayName.trim();
      if (!trimmedName) { setError("Display name cannot be empty"); return; }
      if (trimmedName.length < 3) { setError("Display name must be at least 3 characters"); return; }
      if (trimmedName.length > 30) { setError("Display name must be 30 characters or less"); return; }
      const validNameRegex = /^[a-zA-Z0-9\s_-]+$/;
      if (!validNameRegex.test(trimmedName)) {
        setError("Display name can only contain letters, numbers, spaces, underscores, and hyphens");
        return;
      }
      if (!password) { setError("Password cannot be empty"); return; }
      if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
      if (password !== confirmPassword) { setError("Passwords do not match"); return; }
      
      setLoading(true);
      try {
        const newId = generatePlayerId();
        const email = `${newId.toLowerCase()}@tictactoe.game`;
        
        // Use Player ID as Nakama username (guaranteed unique)
        // Display name is stored separately and can be shared by multiple users
        const session = await client.authenticateEmail(
          email, password, true, newId
        );
        
        // Set the display name on the account (this can be duplicate across users)
        try {
          const host = process.env.REACT_APP_NAKAMA_HOST || "localhost";
          const port = process.env.REACT_APP_NAKAMA_PORT || "7350";
          
          // Update account display name via Nakama REST API
          await fetch(`http://${host}:${port}/v2/account`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${session.token}`
            },
            body: JSON.stringify({ display_name: trimmedName })
          });
        } catch (e) {
          console.error("Failed to set display name:", e);
        }
        
        // Save the Player ID locally
        localStorage.setItem("playerId", newId);
        localStorage.setItem("lastDisplayName", trimmedName);

        // Store username mapping in backend for future lookups (supports multiple users per name)
        try {
          const host = process.env.REACT_APP_NAKAMA_HOST || "localhost";
          const port = process.env.REACT_APP_NAKAMA_PORT || "7350";
          const body = JSON.stringify(JSON.stringify({ username: trimmedName, playerId: newId }));
          await fetch(
            `http://${host}:${port}/v2/rpc/store_username_mapping?http_key=defaulthttpkey`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body }
          );
        } catch (e) {
          console.error("Failed to store username mapping:", e);
        }

        // Show the Player ID to the user before proceeding
        setRegisteredId(newId);
        
        // Auto-proceed after showing ID
        setTimeout(() => {
          onLogin(session);
        }, 5000);
      } catch (e: any) {
        console.error("Register error:", e);
        let msg = "Failed to connect. Please check your internet connection.";
        if (e?.statusCode === 409 || e?.status === 409) {
          msg = "Something went wrong. Please try again.";
        } else if (e instanceof Error) { msg = e.message; }
        setError(msg);
      }
      setLoading(false);
    } else {
      // --- LOGIN FLOW ---
      const trimmedInput = loginInput.trim();
      if (!trimmedInput) { setError("Username or Player ID cannot be empty"); return; }
      if (!password) { setError("Password cannot be empty"); return; }
      
      setLoading(true);
      const host = process.env.REACT_APP_NAKAMA_HOST || "localhost";
      const port = process.env.REACT_APP_NAKAMA_PORT || "7350";
      const isIdLogin = trimmedInput.toUpperCase().startsWith("TTT-");
      
      try {
        // Build list of emails to try authentication with
        let emailsToTry: { email: string; nameForAccount: string }[] = [];
        
        if (isIdLogin) {
          // Direct Player ID login
          emailsToTry.push({
            email: `${trimmedInput.toLowerCase()}@tictactoe.game`,
            nameForAccount: "" // will fetch from account
          });
        } else {
          // Login by display name
          // 1. Try RPC to find matching Player IDs (new accounts)
          try {
            console.log("Login: Calling resolveUsername RPC for", trimmedInput);
            const result = await resolveUsername(trimmedInput);
            console.log("Login: RPC result", result);
            if (result.playerIds && result.playerIds.length > 0) {
              for (const pid of result.playerIds) {
                emailsToTry.push({
                  email: `${pid.toLowerCase()}@tictactoe.game`,
                  nameForAccount: trimmedInput
                });
              }
            } else {
              console.log("Login: RPC returned no playerIds");
            }
          } catch (e) {
            console.log("Login: RPC lookup failed, will try direct auth:", e);
          }
          
          // 2. Also try direct auth with name@tictactoe.game (old accounts)
          emailsToTry.push({
            email: `${trimmedInput.toLowerCase()}@tictactoe.game`,
            nameForAccount: trimmedInput
          });
        }
        
        // Deduplicate emails
        const seen = new Set<string>();
        emailsToTry = emailsToTry.filter(e => {
          if (seen.has(e.email)) return false;
          seen.add(e.email);
          return true;
        });
        
        // Try each email with the password until one works
        let loginSuccess = false;
        console.log("Login: Trying emails", emailsToTry.map(e => e.email));
        for (const attempt of emailsToTry) {
          console.log("Login: Attempting auth with", attempt.email);
          try {
            const session = await client.authenticateEmail(attempt.email, password, false);
            console.log("Login: SUCCESS with", attempt.email);
            
            // Auth succeeded! Now fix up display name
            const resolvedId = attempt.email.replace("@tictactoe.game", "").toUpperCase();
            localStorage.setItem("playerId", resolvedId);
            
            // Fetch current display name from account
            let fetchedDisplayName = "";
            try {
              const accResp = await fetch(`http://${host}:${port}/v2/account`, {
                method: "GET",
                headers: { "Authorization": `Bearer ${session.token}` }
              });
              if (accResp.ok) {
                const accData = await accResp.json();
                fetchedDisplayName = accData?.account?.user?.display_name || "";
              }
            } catch (e) {
              console.error("Failed to fetch account:", e);
            }
            
            // Determine display name: fetched > provided name > existing localStorage
            let finalDisplayName = fetchedDisplayName || attempt.nameForAccount || localStorage.getItem("lastDisplayName") || "";
            
            // If we have a name but the account doesn't, set it retroactively
            if (finalDisplayName && !fetchedDisplayName) {
              try {
                await fetch(`http://${host}:${port}/v2/account`, {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${session.token}`
                  },
                  body: JSON.stringify({ display_name: finalDisplayName })
                });
              } catch (e) { console.error("Failed to set display name:", e); }
            }
            
            // Store display name locally and create mappings
            if (finalDisplayName) {
              localStorage.setItem("lastDisplayName", finalDisplayName);
              try {
                await fetch(
                  `http://${host}:${port}/v2/rpc/store_username_mapping?http_key=defaulthttpkey`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(JSON.stringify({ username: finalDisplayName, playerId: resolvedId }))
                  }
                );
              } catch (e) { console.error("Failed to store mapping:", e); }
            }
            
            loginSuccess = true;
            onLogin(session);
            break;
          } catch (e: any) {
            console.log("Auth failed for " + attempt.email + ", trying next...");
            continue;
          }
        }
        
        if (!loginSuccess) {
          if (isIdLogin) {
            setError("Incorrect password or account not found. Please check your Player ID and password.");
          } else {
            setError("No account found with that name and password. Please check your credentials or register a new account.");
          }
        }
      } catch (e: any) {
        console.error("Login error:", e);
        setError("Failed to connect. Please check your internet connection.");
      }
      setLoading(false);
    }
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
        {/* === REGISTRATION SUCCESS: Show Player ID === */}
        {registeredId ? (
          <div style={{ textAlign: "center" }}>
            <div style={{
              backgroundColor: "rgba(74, 222, 128, 0.1)",
              border: "2px solid rgba(74, 222, 128, 0.5)",
              borderRadius: "16px",
              padding: "24px",
              marginBottom: "20px"
            }}>
              <p style={{ color: "#4ade80", fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>
                Account Created Successfully!
              </p>
              <p style={{ color: "#aaa", fontSize: "13px", marginBottom: "16px" }}>
                Save your Player ID below. You'll need it to log in.
              </p>
              <div style={{
                background: "rgba(0,0,0,0.4)",
                borderRadius: "12px",
                padding: "16px",
                fontFamily: "monospace",
                fontSize: "28px",
                fontWeight: 800,
                color: "#fff",
                letterSpacing: "4px",
                marginBottom: "12px",
                border: "1px solid rgba(255,255,255,0.15)",
                userSelect: "all"
              }}>
                {registeredId}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(registeredId);
                  setError("Player ID copied to clipboard!");
                }}
                style={{
                  background: "rgba(74,222,128,0.15)",
                  border: "1px solid rgba(74,222,128,0.4)",
                  borderRadius: "8px",
                  padding: "10px 20px",
                  color: "#4ade80",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "14px",
                  marginBottom: "12px"
                }}
              >
                Copy Player ID
              </button>
              {error && <p style={{ color: "#4ade80", fontSize: "13px" }}>{error}</p>}
              <p style={{ color: "#888", fontSize: "12px", marginTop: "12px" }}>
                Redirecting to lobby in 5 seconds...
              </p>
              <button
                onClick={() => {
                  const email = `${registeredId!.toLowerCase()}@tictactoe.game`;
                  client.authenticateEmail(email, password, false).then(onLogin);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#7ad3ff",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: 600,
                  textDecoration: "underline",
                  marginTop: "8px"
                }}
              >
                Continue Now
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* === REGISTER FORM === */}
            {isRegister ? (
              <>
                <input
                  type="text"
                  placeholder="Choose a display name"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  style={{
                    width: "100%", padding: "16px", borderRadius: "12px",
                    border: "2px solid rgba(233, 69, 96, 0.3)",
                    backgroundColor: "rgba(15, 52, 96, 0.6)",
                    color: "white", fontSize: "18px", marginBottom: "16px",
                    boxSizing: "border-box", outline: "none", transition: "all 0.3s ease"
                  }}
                  onFocus={e => { e.target.style.borderColor = "#e94560"; e.target.style.boxShadow = "0 0 20px rgba(233,69,96,0.3)"; }}
                  onBlur={e => { e.target.style.borderColor = "rgba(233,69,96,0.3)"; e.target.style.boxShadow = "none"; }}
                />
                <p style={{ color: "#888", fontSize: "12px", margin: "-10px 0 14px 4px" }}>
                  Display names can be the same as other players
                </p>
              </>
            ) : (
              /* === LOGIN FORM: Username or Player ID field === */
              <input
                type="text"
                placeholder="Username or Player ID"
                value={loginInput}
                onChange={e => setLoginInput(e.target.value)}
                style={{
                  width: "100%", padding: "16px", borderRadius: "12px",
                  border: "2px solid rgba(233, 69, 96, 0.3)",
                  backgroundColor: "rgba(15, 52, 96, 0.6)",
                  color: "white", fontSize: "18px", marginBottom: "16px",
                  boxSizing: "border-box", outline: "none", transition: "all 0.3s ease"
                }}
                onFocus={e => { e.target.style.borderColor = "#e94560"; e.target.style.boxShadow = "0 0 20px rgba(233,69,96,0.3)"; }}
                onBlur={e => { e.target.style.borderColor = "rgba(233,69,96,0.3)"; e.target.style.boxShadow = "none"; }}
              />
            )}

            {/* Password field (both modes) */}
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !isRegister && handleSubmit()}
              style={{
                width: "100%", padding: "16px", borderRadius: "12px",
                border: "2px solid rgba(0, 180, 216, 0.3)",
                backgroundColor: "rgba(15, 52, 96, 0.6)",
                color: "white", fontSize: "18px", marginBottom: "16px",
                boxSizing: "border-box", outline: "none", transition: "all 0.3s ease"
              }}
              onFocus={e => { e.target.style.borderColor = "#00b4d8"; e.target.style.boxShadow = "0 0 20px rgba(0,180,216,0.3)"; }}
              onBlur={e => { e.target.style.borderColor = "rgba(0,180,216,0.3)"; e.target.style.boxShadow = "none"; }}
            />

            {/* Confirm password (register only) */}
            {isRegister && (
              <input
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                style={{
                  width: "100%", padding: "16px", borderRadius: "12px",
                  border: "2px solid rgba(0, 180, 216, 0.3)",
                  backgroundColor: "rgba(15, 52, 96, 0.6)",
                  color: "white", fontSize: "18px", marginBottom: "16px",
                  boxSizing: "border-box", outline: "none", transition: "all 0.3s ease"
                }}
                onFocus={e => { e.target.style.borderColor = "#00b4d8"; e.target.style.boxShadow = "0 0 20px rgba(0,180,216,0.3)"; }}
                onBlur={e => { e.target.style.borderColor = "rgba(0,180,216,0.3)"; e.target.style.boxShadow = "none"; }}
              />
            )}

            {/* Error display */}
            {error && (
              <div style={{
                backgroundColor: "rgba(255, 107, 107, 0.1)",
                border: "1px solid rgba(255, 107, 107, 0.5)",
                borderRadius: "8px", padding: "12px", marginBottom: "16px",
                textAlign: "center", color: "#ff6b6b", animation: "shake 0.5s"
              }}>
                {error}
              </div>
            )}

            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={loading}
              style={{
                width: "100%", padding: "18px", borderRadius: "12px", border: "none",
                background: loading ? "#666" : isRegister
                  ? "linear-gradient(135deg, #00b4d8 0%, #0077b6 100%)"
                  : "linear-gradient(135deg, #e94560 0%, #ff6b9d 100%)",
                color: "white", fontSize: "18px",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: "bold",
                boxShadow: loading ? "none" : isRegister
                  ? "0 10px 30px rgba(0, 180, 216, 0.4)"
                  : "0 10px 30px rgba(233, 69, 96, 0.4)",
                transition: "all 0.3s ease",
                transform: loading ? "scale(0.98)" : "scale(1)",
                letterSpacing: "1px"
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.transform = "scale(1.05)"; }}
              onMouseLeave={e => { if (!loading) e.currentTarget.style.transform = "scale(1)"; }}
            >
              {loading ? "Connecting..." : isRegister ? "Create Account" : "Login & Play"}
            </button>

            {/* Toggle register/login */}
            <div style={{ marginTop: "20px", textAlign: "center" }}>
              <button
                onClick={() => {
                  setIsRegister(!isRegister);
                  setError("");
                  setConfirmPassword("");
                }}
                style={{
                  background: "none", border: "none", color: "#7ad3ff",
                  cursor: "pointer", fontSize: "14px", fontWeight: 600,
                  textDecoration: "underline", textUnderlineOffset: "4px"
                }}
              >
                {isRegister ? "Already have an account? Login" : "New player? Create Account"}
              </button>
            </div>

            {/* Info footer */}
            <div style={{ marginTop: "24px", textAlign: "center", color: "#666", fontSize: "13px" }}>
              {isRegister ? (
                <>
                  <p style={{ marginBottom: "8px" }}>You'll receive a unique Player ID after registering</p>
                  <p>Multiple players can use the same display name</p>
                </>
              ) : (
                <>
                  <p style={{ marginBottom: "8px" }}>Login with your username or Player ID</p>
                  <p>If multiple players share your name, use your Player ID</p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
