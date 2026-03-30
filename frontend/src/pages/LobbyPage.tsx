import React, { useState, useEffect, useCallback } from "react";
import { Session } from "@heroiclabs/nakama-js";
import client from "../utils/nakamaClient";

interface Props {
  session: Session;
  onJoinMatch: (matchId: string) => void;
  onLogout: (reason?: string) => void;
}

interface Match {
  match_id: string;
  matchId?: string;
  size: number;
  label: string;
}

const parseRpcPayload = (payload: unknown): any => {
  if (!payload) return {};
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch (_) {
      return {};
    }
  }
  return payload;
};

const getMatchId = (match: any): string => {
  return String(match?.match_id || match?.matchId || "").trim();
};

const LobbyPage: React.FC<Props> = ({ session, onJoinMatch, onLogout }) => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [joinId, setJoinId] = useState("");
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [gameMode, setGameMode] = useState<"classic" | "timed">("classic");
  const [stats, setStats] = useState<any>(null);
  const [showOpenGames, setShowOpenGames] = useState(false);
  const [isNewUser, setIsNewUser] = useState(true);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [searchingForOpponent, setSearchingForOpponent] = useState(false);
  const [waitingRoomMatchId, setWaitingRoomMatchId] = useState<string | null>(null);

  const handleLogout = () => {
    if (window.confirm("Are you sure you want to logout?")) {
      // Keep playerId so user can easily log back in
      // Only remove session-specific items
      localStorage.removeItem("lastUsername");
      localStorage.removeItem("deviceUniqueId");
      localStorage.removeItem("lastDisplayName");
      onLogout();
    }
  };

  const fetchMatches = useCallback(async () => {
    try {
      // Only fetch matches for the currently selected game mode
      const result = await client.rpc(session, "list_matches", { gameMode });
      const data = parseRpcPayload(result.payload);
      
      const matches = (data?.matches || [])
        .map((m: any) => ({ ...m, match_id: getMatchId(m) }))
        .filter((m: any) => m && m.match_id);

      setMatches(matches);
    } catch (e) {
      console.error("Failed to fetch matches", e);
      setError("Failed to load open games. Please refresh.");
    }
  }, [session, gameMode]);

  const validateAndJoinMatch = async (normalizedId: string) => {
    setError("");
    setJoining(true);
    try {
      // Check in current list first
      const foundInCurrentList = matches.find(
        (m: any) => getMatchId(m) === normalizedId,
      );
      if (foundInCurrentList) {
        if (isMatchFull(foundInCurrentList)) {
          setError("This room is already full. Please join another game or create a new one.");
          return;
        }
        // B goes directly to game board
        onJoinMatch(normalizedId);
        return;
      }

      // Not in current list — fetch all modes to find the match
      const [classicResult, timedResult] = await Promise.all([
        client.rpc(session, "list_matches", { gameMode: "classic" }),
        client.rpc(session, "list_matches", { gameMode: "timed" }),
      ]);
      const classicData = parseRpcPayload(classicResult.payload);
      const timedData = parseRpcPayload(timedResult.payload);
      const allMatches = [
        ...(classicData?.matches || []),
        ...(timedData?.matches || []),
      ];
      const found = allMatches.find(
        (m: any) => getMatchId(m) === normalizedId,
      );
      if (!found) {
        setError("Invalid or unavailable match ID. Please check and try again.");
        return;
      }
      if (isMatchFull(found)) {
        setError("This room is already full. Please join another game or create a new one.");
        return;
      }
      // B goes directly to game board
      onJoinMatch(normalizedId);
    } catch (e) {
      console.error("Invalid or unavailable match", e);
      setError("Invalid or unavailable match ID. Please check and try again.");
    } finally {
      setJoining(false);
    }
  };

  const fetchStats = useCallback(async () => {
    try {
      const result = await client.rpc(session, "get_player_stats", {});
      const data = parseRpcPayload(result.payload);
      const playerStats = data?.stats || null;
      setStats(playerStats);
      // Check if user is new (no games played)
      if (playerStats && playerStats.totalGames > 0) {
        setIsNewUser(false);
      }
    } catch (e) {
      console.error("Failed to fetch stats", e);
    }
  }, [session]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      console.log("Fetching leaderboard...");
      const result = await client.rpc(session, "get_leaderboard", {});
      const data = parseRpcPayload(result.payload);
      console.log("Leaderboard data:", data);
      console.log("Leaderboard records count:", data?.records?.length || 0);
      setLeaderboard(data?.records || []);
    } catch (e) {
      console.error("Failed to fetch leaderboard", e);
    }
  }, [session]);

  useEffect(() => {
    fetchMatches();
    fetchStats();
    fetchLeaderboard();
    const interval = setInterval(fetchMatches, 2000);
    const lbInterval = setInterval(fetchLeaderboard, 30000);
    return () => {
      clearInterval(interval);
      clearInterval(lbInterval);
    };
  }, [gameMode, fetchMatches, fetchStats, fetchLeaderboard]);

  // Debug leaderboard state
  useEffect(() => {
    console.log("Leaderboard state changed:", leaderboard.length, "records");
  }, [leaderboard]);

  // Poll to detect when opponent joins - navigate A to game when match is full
  useEffect(() => {
    if (!session || !searchingForOpponent || !waitingRoomMatchId) return;

    const pollForOpponent = async () => {
      try {
        const [classicResult, timedResult] = await Promise.all([
          client.rpc(session, "list_matches", { gameMode: "classic" }),
          client.rpc(session, "list_matches", { gameMode: "timed" }),
        ]);
        const allMatches = [
          ...(parseRpcPayload(classicResult.payload)?.matches || []),
          ...(parseRpcPayload(timedResult.payload)?.matches || []),
        ];
        const waitingMatch = allMatches.find(
          (m: any) => getMatchId(m) === waitingRoomMatchId
        );
        // Navigate A when opponent has joined (size >= 1 because A's socket hasn't joined yet)
        if (waitingMatch && waitingMatch.size >= 1) {
          console.log("Opponent joined via polling - navigating A to game!");
          const matchToJoin = waitingRoomMatchId;
          setSearchingForOpponent(false);
          setWaitingRoomMatchId(null);
          if (matchToJoin) onJoinMatch(matchToJoin);
        }
      } catch (e) {
        console.error("Poll for opponent failed:", e);
      }
    };

    const pollInterval = setInterval(pollForOpponent, 2000);
    return () => clearInterval(pollInterval);
  }, [session, searchingForOpponent, waitingRoomMatchId, onJoinMatch]);

  // Real-time polling for matches list - refresh every 3 seconds when viewing open games
  useEffect(() => {
    if (!session || !showOpenGames) return;
    
    const refreshInterval = setInterval(async () => {
      await fetchMatches();
    }, 3000);
    
    return () => clearInterval(refreshInterval);
  }, [session, showOpenGames, fetchMatches]);

  
  const handleCreateMatch = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await client.rpc(session, "create_match", { gameMode });
      const data = parseRpcPayload(result.payload);
      const createdMatchId = getMatchId(data);
      setJoinId(createdMatchId);
      await fetchMatches();
      setError("");
      // Enter waiting room state
      setWaitingRoomMatchId(createdMatchId);
      setSearchingForOpponent(true);
    } catch (e) {
      setError("Failed to create match");
      setLoading(false);
    }
  };

  const handleLeaveWaitingRoom = async () => {
    console.log("=== CANCEL BUTTON CLICKED ===");
    console.log("Cancel button clicked, matchId:", waitingRoomMatchId);
    console.log("Session valid:", !!session);
    if (waitingRoomMatchId) {
      try {
        // Call delete_match RPC to clean up the match
        console.log("Calling delete_match RPC for match:", waitingRoomMatchId);
        const result = await client.rpc(session, "delete_match", { matchId: waitingRoomMatchId });
        console.log("delete_match RPC result:", result);
        // Refresh matches list to remove the cancelled match
        console.log("Refreshing matches list...");
        await fetchMatches();
        console.log("Matches list refreshed");
      } catch (e) {
        console.error("Failed to cancel match:", e);
      }
    } else {
      console.log("No waitingRoomMatchId to cancel");
    }
    console.log("Clearing waiting room state...");
    setSearchingForOpponent(false);
    setWaitingRoomMatchId(null);
    setJoinId(""); // Clear the join ID input
    setLoading(false);
    console.log("=== CANCEL COMPLETE ===");
  };


  const handleJoinById = () => {
    if (!joinId.trim()) {
      setError("Please enter a match ID");
      return;
    }
    validateAndJoinMatch(joinId.trim());
  };

  const isMatchFull = (match: any) =>
    match.label === "playing_classic" || match.label === "playing_timed";

  
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at 12% 8%, rgba(0,190,255,0.15) 0%, transparent 38%), radial-gradient(circle at 88% 82%, rgba(255,88,126,0.16) 0%, transparent 42%), linear-gradient(145deg, #060a1a 0%, #0f1733 48%, #111b3d 100%)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(circle at center, black 45%, transparent 100%)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          maxWidth: "1180px",
          margin: "0 auto",
          padding: "34px 18px 46px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <section
          style={{
            background:
              "linear-gradient(120deg, rgba(14,23,53,0.88) 0%, rgba(17,31,70,0.9) 52%, rgba(20,41,86,0.88) 100%)",
            borderRadius: "22px",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
            padding: "24px",
            marginBottom: "24px",
            animation: "fadeIn 0.35s ease-out",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "14px",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "16px",
                  background:
                    "linear-gradient(145deg, rgba(255,88,126,0.95) 0%, rgba(96,191,255,0.95) 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontSize: "24px",
                  color: "white",
                  boxShadow: "0 10px 24px rgba(31,139,255,0.35)",
                }}
              >
                {(localStorage.getItem("lastDisplayName") || session.username)?.charAt(0).toUpperCase() || "U"}
              </div>
              <div>
                <div
                  style={{
                    color: "#dce8ff",
                    fontSize: "13px",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    opacity: 0.85,
                  }}
                >
                  Tic-Tac-Toe Arena
                </div>
                <h1
                  style={{
                    margin: "2px 0 0",
                    color: "#ffffff",
                    fontSize: "clamp(24px, 3.2vw, 36px)",
                    fontWeight: 800,
                  }}
                >
                  {isNewUser ? "Welcome, Captain" : "Great to see you again"}{" "}
                  <span style={{ color: "#7ad3ff" }}>{localStorage.getItem("lastDisplayName") || session.username || "Player"}</span>
                </h1>
                <p style={{ margin: "7px 0 0", color: "#9fb3d8", fontSize: "13px" }}>
                  <span style={{ fontFamily: "monospace", letterSpacing: "1px", color: "#a0c4ff" }}>
                    {localStorage.getItem("playerId") || session.user_id?.substring(0, 12)}
                  </span>
                  {" "} • {gameMode === "timed" ? "Timed queue" : "Classic queue"}
                </p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  padding: "9px 14px",
                  borderRadius: "999px",
                  border: "1px solid rgba(84,255,157,0.35)",
                  color: "#7DFFC3",
                  background: "rgba(37,165,102,0.14)",
                  fontSize: "12px",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                Session Active
              </div>
              <button
                onClick={handleLogout}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,107,107,0.5)",
                  color: "#ff6b6b",
                  background: "rgba(255,107,107,0.1)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,107,107,0.2)";
                  e.currentTarget.style.borderColor = "rgba(255,107,107,0.7)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,107,107,0.1)";
                  e.currentTarget.style.borderColor = "rgba(255,107,107,0.5)";
                }}
              >
                🚪 Logout
              </button>
            </div>
          </div>
        </section>

        {stats && (
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "12px",
              marginBottom: "24px",
            }}
          >
            {[
              { label: "Wins", value: stats.wins, color: "#67f0a7" },
              { label: "Losses", value: stats.losses, color: "#ff7f9b" },
              { label: "Draws", value: stats.draws, color: "#ffd278" },
              { label: "Total", value: stats.totalGames, color: "#80d2ff" },
              { label: "Streak", value: stats.currentStreak, color: "#d2a7ff" },
              { label: "Best", value: stats.bestStreak, color: "#8af0ff" },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  background: "rgba(11,19,44,0.72)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "14px",
                  padding: "14px 14px 12px",
                }}
              >
                <div style={{ color: "#90a8d1", fontSize: "12px", marginBottom: "8px" }}>{item.label}</div>
                <div style={{ color: item.color, fontSize: "30px", fontWeight: 800, lineHeight: 1 }}>{item.value}</div>
              </div>
            ))}
          </section>
        )}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              background: "rgba(10,18,40,0.78)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "16px",
              padding: "18px",
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "#e8f0ff", fontSize: "18px" }}>Game Modes</h3>
            <div style={{ display: "grid", gap: "10px" }}>
              <button
                onClick={() => setGameMode("classic")}
                style={{
                  borderRadius: "12px",
                  border: gameMode === "classic" ? "1px solid #ff6d8f" : "1px solid rgba(255,255,255,0.08)",
                  background: gameMode === "classic" ? "rgba(255,86,128,0.2)" : "rgba(255,255,255,0.03)",
                  color: "#fff",
                  padding: "14px 14px",
                  textAlign: "left",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Classic Mode
                <div style={{ color: "#9ab0d5", fontSize: "12px", marginTop: "4px", fontWeight: 500 }}>
                  Strategic turn-by-turn match.
                </div>
              </button>
              <button
                onClick={() => setGameMode("timed")}
                style={{
                  borderRadius: "12px",
                  border: gameMode === "timed" ? "1px solid #6ad8ff" : "1px solid rgba(255,255,255,0.08)",
                  background: gameMode === "timed" ? "rgba(49,178,255,0.2)" : "rgba(255,255,255,0.03)",
                  color: "#fff",
                  padding: "14px 14px",
                  textAlign: "left",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Timed Mode (30s)
                <div style={{ color: "#9ab0d5", fontSize: "12px", marginTop: "4px", fontWeight: 500 }}>
                  Fast rounds, pressure plays.
                </div>
              </button>
            </div>
          </div>

          <div
            style={{
              background: "rgba(10,18,40,0.78)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "16px",
              padding: "18px",
              display: "grid",
              gap: "12px",
              alignContent: "start",
            }}
          >
            <h3 style={{ margin: 0, color: "#e8f0ff", fontSize: "18px" }}>Quick Start</h3>
            <button
              onClick={handleCreateMatch}
              disabled={loading}
              style={{
                border: "none",
                borderRadius: "12px",
                padding: "14px",
                background: loading
                  ? "rgba(255,255,255,0.12)"
                  : "linear-gradient(130deg, #ff5d8c 0%, #7b8cff 100%)",
                color: "white",
                fontWeight: 800,
                fontSize: "15px",
                cursor: loading ? "not-allowed" : "pointer",
                boxShadow: loading ? "none" : "0 12px 26px rgba(72,83,255,0.3)",
              }}
            >
              {loading ? "Creating Match..." : "Create New Match"}
            </button>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Enter match ID"
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: "180px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.03)",
                  color: "#e6f0ff",
                  padding: "11px 12px",
                  outline: "none",
                  fontSize: "14px",
                }}
              />
              <button
                onClick={handleJoinById}
                disabled={joining}
                style={{
                  border: "1px solid rgba(130,216,255,0.55)",
                  borderRadius: "10px",
                  background: "rgba(75,171,255,0.18)",
                  color: "#9fe1ff",
                  padding: "10px 16px",
                  fontWeight: 700,
                  cursor: joining ? "not-allowed" : "pointer",
                  opacity: joining ? 0.7 : 1,
                }}
              >
                {joining ? "Checking..." : "Join"}
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div
            style={{
              background: "rgba(255,86,128,0.16)",
              border: "1px solid rgba(255,126,157,0.46)",
              color: "#ffd5de",
              borderRadius: "12px",
              padding: "11px 14px",
              marginBottom: "24px",
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}

        <section
          style={{
            background: "rgba(10,18,40,0.78)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "16px",
            padding: "18px",
            marginBottom: "24px",
          }}
        >
          <div
            onClick={() => setShowOpenGames(!showOpenGames)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
              gap: "10px",
              marginBottom: showOpenGames ? "12px" : 0,
            }}
          >
            <h3 style={{ margin: 0, color: "#e8f0ff", fontSize: "18px" }}>
              Open Games <span style={{ color: "#8bc9ff" }}>({matches.length})</span>
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  fetchMatches();
                }}
                style={{
                  border: "1px solid rgba(188,157,255,0.55)",
                  borderRadius: "10px",
                  background: "rgba(172,134,255,0.16)",
                  color: "#d9c7ff",
                  padding: "8px 12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Refresh
              </button>
              <span style={{ color: "#9cb2d4", fontSize: "18px" }}>{showOpenGames ? "▲" : "▼"}</span>
            </div>
          </div>

          {showOpenGames && (
            <div style={{ display: "grid", gap: "10px" }}>
              {matches.length === 0 ? (
                <div
                  style={{
                    borderRadius: "12px",
                    border: "1px dashed rgba(255,255,255,0.15)",
                    padding: "28px 16px",
                    textAlign: "center",
                    color: "#a6b9d8",
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  No open games yet. Create a match and invite your friend.
                </div>
              ) : (
                matches.map((match) => {
                  const id = getMatchId(match);
                  const isFull = match.label === "playing_classic" || match.label === "playing_timed";
                  return (
                  <div
                    key={id}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "12px",
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: isFull ? "rgba(255,100,100,0.05)" : "rgba(255,255,255,0.03)",
                      border: isFull ? "1px solid rgba(255,100,100,0.25)" : "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "12px",
                      padding: "13px",
                    }}
                  >
                    <div style={{ minWidth: "220px", flex: 1 }}>
                      <div style={{ color: "#8fa7cd", fontSize: "12px", marginBottom: "4px" }}>Match ID</div>
                      <div
                        style={{
                          color: "#dbe7ff",
                          fontFamily: "monospace",
                          fontSize: "13px",
                          wordBreak: "break-all",
                        }}
                      >
                        {id}
                      </div>
                    </div>
                    <div
                      style={{
                        color: isFull ? "#ff9a9a" : "#7dffc3",
                        fontWeight: 700,
                        fontSize: "13px",
                        padding: "7px 10px",
                        borderRadius: "8px",
                        border: isFull ? "1px solid rgba(255,100,100,0.4)" : "1px solid rgba(125,255,195,0.35)",
                        background: isFull ? "rgba(255,80,80,0.13)" : "rgba(39,183,120,0.13)",
                      }}
                    >
                      {isFull ? "🔒 Room Full" : `Players ${match.size}/2`}
                    </div>
                    <button
                      onClick={() => {
                        if (isFull) {
                          setError("This room is already full. Please join another game or create a new one.");
                          setTimeout(() => setError(""), 3000);
                        } else {
                          onJoinMatch(id);
                        }
                      }}
                      disabled={joining}
                      style={{
                        border: "none",
                        borderRadius: "10px",
                        padding: "10px 16px",
                        background: isFull
                          ? "rgba(255,255,255,0.08)"
                          : "linear-gradient(130deg, #8e7dff 0%, #67c6ff 100%)",
                        color: isFull ? "#8899aa" : "white",
                        fontWeight: 800,
                        cursor: isFull || joining ? "not-allowed" : "pointer",
                        opacity: joining ? 0.7 : 1,
                      }}
                    >
                      {joining ? "Checking..." : isFull ? "Room Full" : "Join Match"}
                    </button>
                  </div>
                  );
                })
              )}
            </div>
          )}
        </section>

        <section
          style={{
            background: "rgba(10,18,40,0.78)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "16px",
            padding: "18px",
            marginBottom: "24px",
          }}
        >
          <div
            onClick={() => setShowLeaderboard(!showLeaderboard)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
              marginBottom: showLeaderboard ? "12px" : 0,
            }}
          >
            <h3 style={{ margin: 0, color: "#e8f0ff", fontSize: "18px" }}>
              🏆 Global Leaderboard
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                onClick={(e) => { e.stopPropagation(); fetchLeaderboard(); }}
                style={{
                  border: "1px solid rgba(188,157,255,0.55)",
                  borderRadius: "10px",
                  background: "rgba(172,134,255,0.16)",
                  color: "#d9c7ff",
                  padding: "8px 12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Refresh
              </button>
              <span style={{ color: "#9cb2d4", fontSize: "18px" }}>{showLeaderboard ? "▲" : "▼"}</span>
            </div>
          </div>
          {showLeaderboard && (
            <div style={{ display: "grid", gap: "10px" }}>
              {leaderboard.length === 0 ? (
                <div style={{
                  borderRadius: "14px",
                  border: "1px dashed rgba(255,255,255,0.15)",
                  padding: "28px 20px",
                  textAlign: "center",
                  color: "#a6b9d8",
                  background: "rgba(255,255,255,0.02)",
                  fontSize: "15px",
                }}>
                  <div style={{ fontSize: "24px", marginBottom: "8px" }}>🏆</div>
                  No rankings yet. Play games to appear here!
                </div>
              ) : (
                leaderboard.map((record: any, index: number) => {
                  const isMe = record.ownerId === session.user_id;
                  const isTop3 = index < 3;
                  return (
                    <div
                      key={record.ownerId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "14px",
                        background: isTop3
                          ? index === 0 ? "linear-gradient(145deg, rgba(255,215,0,0.12) 0%, rgba(255,193,7,0.08) 100%)"
                          : index === 1 ? "linear-gradient(145deg, rgba(192,192,192,0.12) 0%, rgba(169,169,169,0.08) 100%)"
                          : "linear-gradient(145deg, rgba(205,127,50,0.12) 0%, rgba(184,134,11,0.08) 100%)"
                          : isMe ? "rgba(122,211,255,0.12)" : "rgba(255,255,255,0.02)",
                        border: isTop3
                          ? index === 0 ? "1px solid rgba(255,215,0,0.4)"
                          : index === 1 ? "1px solid rgba(192,192,192,0.4)"
                          : "1px solid rgba(205,127,50,0.4)"
                          : isMe ? "1px solid rgba(122,211,255,0.35)" : "1px solid rgba(255,255,255,0.07)",
                        borderRadius: "12px",
                        padding: "12px 16px",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      {/* Rank Badge */}
                      <div
                        style={{
                          width: "44px",
                          height: "44px",
                          borderRadius: "50%",
                          background: isTop3
                            ? index === 0 ? "linear-gradient(145deg, #FFD700, #FFC107)"
                            : index === 1 ? "linear-gradient(145deg, #C0C0C0, #A9A9A9)"
                            : "linear-gradient(145deg, #CD7F32, #B8860B)"
                            : "linear-gradient(145deg, rgba(160,184,216,0.2), rgba(160,184,216,0.1))",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 900,
                          fontSize: isTop3 ? "20px" : "16px",
                          color: isTop3 ? "#fff" : "#a0b8d8",
                          boxShadow: isTop3
                            ? index === 0 ? "0 0 20px rgba(255,215,0,0.4)"
                            : index === 1 ? "0 0 20px rgba(192,192,192,0.4)"
                            : "0 0 20px rgba(205,127,50,0.4)"
                            : "none",
                        }}
                      >
                        {isTop3 ? ["🥇","🥈","🥉"][index] : `#${index + 1}`}
                      </div>

                      {/* Player Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          color: isMe ? "#7ad3ff" : isTop3 ? "#fff" : "#dbe7ff",
                          fontWeight: isMe ? 800 : isTop3 ? 700 : 600,
                          fontSize: "15px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}>
                          {record.username || "—"}
                          {isMe && (
                            <span style={{
                              marginLeft: "8px",
                              padding: "2px 8px",
                              borderRadius: "999px",
                              background: "rgba(122,211,255,0.2)",
                              color: "#7ad3ff",
                              fontSize: "11px",
                              fontWeight: 700,
                            }}>YOU</span>
                          )}
                          {record.playerId && (
                            <span style={{
                              marginLeft: "6px",
                              color: "rgba(160,184,216,0.6)",
                              fontSize: "11px",
                              fontFamily: "monospace",
                              fontWeight: 500,
                            }}>({record.playerId})</span>
                          )}
                        </div>
                        {isTop3 && (
                          <div style={{
                            color: "rgba(255,255,255,0.7)",
                            fontSize: "12px",
                            marginTop: "2px",
                          }}>
                            {["Champion","Runner-up","Third Place"][index]}
                          </div>
                        )}
                      </div>

                      {/* Score */}
                      <div style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: "2px",
                      }}>
                        <div style={{
                          color: isTop3 ? "#fff" : "#ffd278",
                          fontWeight: 800,
                          fontSize: "17px",
                        }}>
                          {record.score}
                        </div>
                        <div style={{
                          color: isTop3 ? "rgba(255,255,255,0.7)" : "rgba(255,210,120,0.7)",
                          fontSize: "11px",
                          fontWeight: 600,
                        }}>
                          pts
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>

        {/* Waiting Room Overlay */}
        {searchingForOpponent && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              background: "rgba(8,13,31,0.96)",
              backdropFilter: "blur(8px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              animation: "fadeIn 0.3s ease-out",
            }}
          >
            <div
              style={{
                background:
                  "linear-gradient(130deg, rgba(14,23,53,0.92) 0%, rgba(23,41,88,0.92) 100%)",
                borderRadius: "24px",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
                padding: "40px 32px",
                maxWidth: "420px",
                width: "90%",
                textAlign: "center",
              }}
            >
              {/* Spinner */}
              <div
                style={{
                  width: "72px",
                  height: "72px",
                  margin: "0 auto 24px",
                  border: "4px solid rgba(122,211,255,0.2)",
                  borderTop: "4px solid #7ad3ff",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              />

              {/* Searching Text */}
              <h2
                style={{
                  margin: "0 0 12px",
                  color: "#7ad3ff",
                  fontSize: "24px",
                  fontWeight: 800,
                  animation: "pulse 2s ease-in-out infinite",
                }}
              >
                Searching for Opponent...
              </h2>
              <p
                style={{
                  margin: "0 0 24px",
                  color: "#9fb3d8",
                  fontSize: "15px",
                  lineHeight: 1.5,
                }}
              >
                Your {gameMode === "timed" ? "⏱️ Timed" : "🎮 Classic"} match is ready.
                <br />
                Share this ID with a friend or wait for someone to join.
              </p>

              {/* Match ID */}
              <div
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "12px",
                  padding: "16px",
                  marginBottom: "24px",
                }}
              >
                <div
                  style={{
                    color: "#a6b9d8",
                    fontSize: "12px",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: "6px",
                  }}
                >
                  Match ID
                </div>
                <div
                  style={{
                    color: "#fff",
                    fontSize: "18px",
                    fontWeight: 800,
                    fontFamily: "monospace",
                    wordBreak: "break-all",
                  }}
                >
                  {waitingRoomMatchId}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(waitingRoomMatchId || "");
                    alert("Match ID copied!");
                  }}
                  style={{
                    marginTop: "10px",
                    borderRadius: "8px",
                    border: "1px solid rgba(122,211,255,0.5)",
                    background: "rgba(122,211,255,0.1)",
                    color: "#7ad3ff",
                    padding: "8px 12px",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Copy ID
                </button>
              </div>

              {/* Buttons */}
              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  onClick={handleLeaveWaitingRoom}
                  style={{
                    flex: 1,
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.05)",
                    color: "#b9c8e4",
                    padding: "12px 20px",
                    fontSize: "15px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <div style={{
                  flex: 1,
                  borderRadius: "12px",
                  border: "1px dashed rgba(255,255,255,0.3)",
                  background: "rgba(255,255,255,0.05)",
                  color: "#9cb2d4",
                  padding: "12px 20px",
                  fontSize: "15px",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  Waiting for opponent...
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LobbyPage;
