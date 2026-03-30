import React, { useState } from "react";
import { Session } from "@heroiclabs/nakama-js";
import LoginPage from "./pages/LoginPage";
import LobbyPage from "./pages/LobbyPage";
import GamePage from "./pages/GamePage";
import client from "./utils/nakamaClient";

type Page = "login" | "lobby" | "game";

function App() {
  const [page, setPage] = useState<Page>("login");
  const [session, setSession] = useState<Session | null>(null);
  const [matchId, setMatchId] = useState<string>("");
  const [checkingReconnect, setCheckingReconnect] = useState(false);

  const handleLogin = async (newSession: Session) => {
    setSession(newSession);
    setCheckingReconnect(true);
    
    // CRITICAL: Check for active matches before going to lobby
    try {
      // Get user's active matches from Nakama
      const socket = client.createSocket();
      await socket.connect(newSession, true);
      
      // Store match ID in localStorage for reconnection
      const storedMatchId = localStorage.getItem(`activeMatch_${newSession.user_id}`);
      
      if (storedMatchId) {
        console.log("Found active match, attempting to reconnect:", storedMatchId);
        
        // Try to rejoin the match
        try {
          const match = await socket.joinMatch(storedMatchId);
          if (match && match.match_id) {
            console.log("Successfully reconnected to match:", match.match_id);
            setMatchId(storedMatchId);
            setPage("game");
            setCheckingReconnect(false);
            return;
          }
        } catch (e) {
          console.log("Could not rejoin match (may have ended):", e);
          localStorage.removeItem(`activeMatch_${newSession.user_id}`);
        }
      }
      
      socket.disconnect(true);
    } catch (e) {
      console.error("Error checking for active matches:", e);
    }
    
    setCheckingReconnect(false);
    setPage("lobby");
  };

  const handleJoinMatch = (id: string) => {
    setMatchId(id);
    // Store active match for reconnection
    if (session) {
      localStorage.setItem(`activeMatch_${session.user_id}`, id);
    }
    setPage("game");
  };

  const handleBackToLobby = () => {
    // Clear active match when leaving
    if (session) {
      localStorage.removeItem(`activeMatch_${session.user_id}`);
    }
    setMatchId("");
    setPage("lobby");
  };

  const handleLogout = (reason?: string) => {
    setSession(null);
    setMatchId("");
    setPage("login");
    if (reason) {
      // Store reason so LoginPage can show it
      localStorage.setItem("logoutReason", reason);
    }
  };

  return (
    <div
      style={{ minHeight: "100vh", backgroundColor: "#1a1a2e", color: "white" }}
    >
      {page === "login" && <LoginPage onLogin={handleLogin} />}
      {checkingReconnect && (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          gap: "20px"
        }}>
          <div style={{
            fontSize: "24px",
            fontWeight: "600",
            color: "#00b4d8"
          }}>Checking for active matches...</div>
          <div style={{
            width: "50px",
            height: "50px",
            border: "4px solid rgba(0, 180, 216, 0.2)",
            borderTop: "4px solid #00b4d8",
            borderRadius: "50%",
            animation: "spin 1s linear infinite"
          }}></div>
        </div>
      )}
      {page === "lobby" && session && !checkingReconnect && (
        <LobbyPage session={session} onJoinMatch={handleJoinMatch} onLogout={handleLogout} />
      )}
      {page === "game" && session && (
        <GamePage
          session={session}
          matchId={matchId}
          onLeave={handleBackToLobby}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}

export default App;
