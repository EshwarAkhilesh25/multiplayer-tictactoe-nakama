import React, { useState, useEffect, useRef } from "react";



import { Session, Socket } from "@heroiclabs/nakama-js";



import client from "../utils/nakamaClient";

/* eslint-disable react-hooks/exhaustive-deps */



interface Props {

  session: Session;



  matchId: string;



  onLeave: () => void;



  onLogout: (reason?: string) => void;

}



interface Player {

  userId: string;



  username: string;



  symbol: string;



  connected: boolean;

}



interface GameState {

  board: string[];



  players: { [key: string]: Player };



  currentTurn: string;



  status: string;



  gameMode?: string;



  turnTimeLimit?: number;



  turnStartTime?: number;

}



const GamePage: React.FC<Props> = ({ session, matchId, onLeave, onLogout }) => {

  const [gameState, setGameState] = useState<GameState>({

    board: ["", "", "", "", "", "", "", "", ""],



    players: {},



    currentTurn: "",



    status: "waiting",

  });



  const [mySymbol, setMySymbol] = useState<string>("");



  const [statusMsg, setStatusMsg] = useState("Waiting for opponent...");



  const [gameOver, setGameOver] = useState(false);



  const [gameOverMsg, setGameOverMsg] = useState("");



  const [error, setError] = useState("");



  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);



  const [lastMove, setLastMove] = useState<number | null>(null);



  const socketRef = useRef<Socket | null>(null);



  const timerRef = useRef<NodeJS.Timeout | null>(null);



  useEffect(() => {

    connectToMatch();



    return () => {

      if (socketRef.current) {

        socketRef.current.disconnect(true);

      }



      if (timerRef.current) {

        clearInterval(timerRef.current);

      }

    };

  }, []);



  const startTimer = (duration: number) => {

    if (timerRef.current) {

      clearInterval(timerRef.current);

    }



    setTimeRemaining(duration);



    timerRef.current = setInterval(() => {

      setTimeRemaining((prev) => {

        if (prev === null || prev <= 1) {

          if (timerRef.current) clearInterval(timerRef.current);



          return 0;

        }



        return prev - 1;

      });

    }, 1000);

  };



  const connectToMatch = async () => {

    try {

      const useSSL = process.env.REACT_APP_NAKAMA_SSL === "true";

      const sock = client.createSocket(useSSL, true);



      socketRef.current = sock;



      sock.onmatchdata = (matchData) => {

        const opcode = matchData.op_code;



        let data: any = {};



        try {

          if (matchData.data) {

            const decoder = new TextDecoder();



            data = JSON.parse(decoder.decode(matchData.data));

          }

        } catch (e) {

          console.error("Failed to parse match data", e);

        }



        if (opcode === 1) {

          // match_start



          setGameState({

            board: data.board,



            players: data.players,



            currentTurn: data.currentTurn,



            status: "playing",



            gameMode: data.gameMode,



            turnTimeLimit: data.turnTimeLimit,

          });



          const me = data.players[session.user_id!];



          if (me) {

            setMySymbol(me.symbol);



            setStatusMsg(

              data.currentTurn === session.user_id

                ? `Your turn (${me.symbol})`

                : "Opponent's turn",

            );

          }



          if (data.turnTimeLimit > 0) {

            startTimer(data.turnTimeLimit);

          }

        } else if (opcode === 2) {

          // state_update



          setGameState((prev) => ({

            ...prev,



            board: data.board,



            currentTurn: data.currentTurn,

          }));



          setStatusMsg(

            data.currentTurn === session.user_id

              ? `Your turn`

              : "Opponent's turn",

          );



          if (data.lastMove) {

            setLastMove(data.lastMove.position);



            setTimeout(() => setLastMove(null), 600);

          }



          if (gameState.turnTimeLimit && gameState.turnTimeLimit > 0) {

            startTimer(gameState.turnTimeLimit);

          }

        } else if (opcode === 3) {

          // game_over



          setGameState((prev) => ({

            ...prev,



            board: data.board,



            status: "finished",

          }));



          setGameOver(true);



          // Set appropriate status message when game ends

          setStatusMsg("Game Over");



          // Clear active match - game has ended



          localStorage.removeItem(`activeMatch_${session.user_id}`);



          if (data.isDraw) {

            setGameOverMsg("It's a Draw! 🤝");

          } else if (data.winner === session.user_id) {

            setGameOverMsg("You Win! 🎉 +3 pts");

          } else {

            setGameOverMsg("You Lose 😔");

          }

        } else if (opcode === 4) {

          // player_left - opponent forfeited by disconnecting



          if (timerRef.current) {

            clearInterval(timerRef.current);

            timerRef.current = null;

          }



          setTimeRemaining(null);



          setGameOver(true);



          setStatusMsg("Game Over - Opponent Disconnected");



          setGameOverMsg(

            data.winner === session.user_id

              ? "You Win by Forfeit! 🏆"

              : "Opponent disconnected.",

          );



          // Clear active match - opponent left



          localStorage.removeItem(`activeMatch_${session.user_id}`);

        } else if (opcode === 5) {

          // timeout



          setGameOver(true);



          setStatusMsg("Game Over - Time Expired");



          setGameOverMsg(

            data.message +

              (data.winner === session.user_id

                ? " You Win! 🎉"

                : " You Lose! ⏱️"),

          );



          // Clear active match - game ended by timeout



          localStorage.removeItem(`activeMatch_${session.user_id}`);



          if (timerRef.current) clearInterval(timerRef.current);

        } else if (opcode === 99) {

          // error



          setError(data.message);



          setTimeout(() => setError(""), 2000);

        }

      };



      sock.ondisconnect = (evt: any) => {

        // Check for session eviction (logged in from another device)

        if (evt?.code === 4001 || evt?.reason?.includes("session")) {

          onLogout("Logged in from another location");

          return;

        }

        setStatusMsg("Disconnected from server");

      };



      // Handle match presence events to detect when players join/leave

      sock.onmatchpresence = (matchPresence) => {

        console.log("Match presence event:", matchPresence);



        // Check if we have 2 players (game is ready to start)

        if (matchPresence.joins && matchPresence.joins.length > 0) {

          console.log("Player(s) joined:", matchPresence.joins.length);

          // Log the presence event for debugging

          matchPresence.joins.forEach((join: any) => {

            console.log("Player joined:", join.username);

          });

        }



        if (matchPresence.leaves && matchPresence.leaves.length > 0) {

          console.log("Player(s) left:", matchPresence.leaves.length);

        }

      };



      await sock.connect(session, true);



      await sock.joinMatch(matchId);



      setStatusMsg("Joined match! Waiting for opponent...");

    } catch (e: any) {

      console.error("Failed to connect", e);



      setStatusMsg("Failed to connect: " + (e?.message || String(e)));

    }

  };



  const handleCellClick = async (index: number) => {

    if (!socketRef.current || gameOver) return;



    if (gameState.status !== "playing") return;



    if (gameState.currentTurn !== session.user_id) return;



    if (gameState.board[index] !== "") return;



    try {

      const move = JSON.stringify({ position: index });



      const encoder = new TextEncoder();



      await socketRef.current.sendMatchState(matchId, 1, encoder.encode(move));

    } catch (e) {

      console.error("Failed to send move", e);

    }

  };



  const cellStyle = (value: string, index: number): React.CSSProperties => ({

    width: "clamp(84px, 16vw, 120px)",



    height: "clamp(84px, 16vw, 120px)",



    display: "flex",



    alignItems: "center",



    justifyContent: "center",



    fontSize: "clamp(32px, 6vw, 52px)",



    fontWeight: 800,



    cursor:

      value === "" && gameState.currentTurn === session.user_id && !gameOver

        ? "pointer"

        : "default",



    background:

      lastMove === index

        ? "linear-gradient(145deg, rgba(255,88,126,0.38) 0%, rgba(98,201,255,0.3) 100%)"

        : "linear-gradient(145deg, rgba(19,31,66,0.95) 0%, rgba(11,22,50,0.95) 100%)",



    borderRadius: "16px",



    border: "1px solid rgba(255,255,255,0.14)",



    color: value === "X" ? "#ff6b93" : "#6dd8ff",



    transition: "all 0.25s ease",



    transform: lastMove === index ? "scale(1.06)" : "scale(1)",



    boxShadow:

      lastMove === index

        ? "0 0 24px rgba(255,102,143,0.45), inset 0 0 20px rgba(255,255,255,0.08)"

        : "inset 0 0 14px rgba(255,255,255,0.03)",



    userSelect: "none",

  });



  return (

    <div

      style={{

        minHeight: "100vh",



        background:

          "radial-gradient(circle at 14% 10%, rgba(95,190,255,0.2) 0%, transparent 34%), radial-gradient(circle at 86% 90%, rgba(255,95,140,0.19) 0%, transparent 38%), linear-gradient(145deg, #080d1f 0%, #101a3a 55%, #0d1530 100%)",



        padding: "20px 14px 34px",

      }}

    >

      <div

        style={{

          maxWidth: "980px",



          margin: "0 auto",



          animation: "fadeIn 0.35s ease-out",

        }}

      >

        <div

          style={{

            borderRadius: "20px",



            border: "1px solid rgba(255,255,255,0.1)",



            background:

              "linear-gradient(130deg, rgba(14,24,58,0.86) 0%, rgba(23,41,88,0.86) 100%)",



            boxShadow: "0 16px 38px rgba(0,0,0,0.45)",



            padding: "18px",



            marginBottom: "14px",

          }}

        >

          <div

            style={{

              display: "flex",



              flexWrap: "wrap",



              gap: "10px",



              justifyContent: "space-between",



              alignItems: "center",

            }}

          >

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h2 style={{ margin: 0, color: "#fff", fontWeight: 800, fontSize: "clamp(22px, 4vw, 34px)" }}>
                  Match Arena
                </h2>
                {mySymbol && (
                  <div style={{
                    padding: "4px 10px",
                    borderRadius: "8px",
                    background: mySymbol === "X"
                      ? "linear-gradient(135deg, rgba(239,68,68,0.2) 0%, rgba(220,38,38,0.3) 100%)"
                      : "linear-gradient(135deg, rgba(59,130,246,0.2) 0%, rgba(37,99,235,0.3) 100%)",
                    border: `1px solid ${mySymbol === "X" ? "rgba(239,68,68,0.4)" : "rgba(59,130,246,0.4)"}`,
                  }}>
                    <span style={{
                      color: mySymbol === "X" ? "#f87171" : "#60a5fa",
                      fontSize: "clamp(12px, 1.8vw, 14px)",
                      fontWeight: 700,
                    }}>
                      You are {mySymbol}
                    </span>
                  </div>
                )}
              </div>
              {/* Player A vs Player B */}
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "12px",
                padding: "10px 16px",
                borderRadius: "12px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}>
                {(() => {
                  const players = Object.values(gameState.players);
                  const me = players.find(p => p.userId === session.user_id);
                  const opponent = players.find(p => p.userId !== session.user_id);
                  const myName = me?.username || localStorage.getItem("lastDisplayName") || "You";
                  const opponentName = opponent?.username || "Waiting...";
                  return (
                    <>
                      <span style={{
                        color: me?.symbol === "X" ? "#f87171" : "#60a5fa",
                        fontWeight: 800,
                        fontSize: "clamp(16px, 3vw, 22px)",
                        textShadow: me?.symbol === "X"
                          ? "0 0 10px rgba(239,68,68,0.4)"
                          : "0 0 10px rgba(59,130,246,0.4)",
                      }}>
                        {myName} ({me?.symbol || "?"})
                      </span>
                      <span style={{
                        color: "#64748b",
                        fontWeight: 700,
                        fontSize: "clamp(14px, 2.5vw, 18px)",
                      }}>
                        vs
                      </span>
                      <span style={{
                        color: opponent?.symbol === "X" ? "#f87171" : "#60a5fa",
                        fontWeight: 800,
                        fontSize: "clamp(16px, 3vw, 22px)",
                        textShadow: opponent?.symbol === "X"
                          ? "0 0 10px rgba(239,68,68,0.4)"
                          : "0 0 10px rgba(59,130,246,0.4)",
                      }}>
                        {opponentName} {opponent ? `(${opponent.symbol})` : ""}
                      </span>
                    </>
                  );
                })()}
              </div>
            </div>



            <button

              onClick={() => {

                navigator.clipboard.writeText(matchId);



                alert("Match ID copied!");

              }}

              style={{

                borderRadius: "10px",



                border: "1px solid rgba(151,210,255,0.55)",



                background: "rgba(56,151,255,0.2)",



                color: "#c8e9ff",



                padding: "8px 12px",



                fontWeight: 700,



                cursor: "pointer",

              }}

            >

              Copy Match ID

            </button>

          </div>



          <p

            style={{

              margin: "10px 0 0",



              color: "#9fb7df",



              fontFamily: "monospace",



              fontSize: "12px",



              wordBreak: "break-all",

            }}

          >

            {matchId}

          </p>

        </div>



        <div

          style={{

            display: "grid",



            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",



            gap: "14px",



            alignItems: "start",

          }}

        >

          <div

            style={{

              borderRadius: "18px",



              border: "1px solid rgba(255,255,255,0.09)",



              background: "rgba(10,20,48,0.82)",



              padding: "16px",

            }}

          >

            <p

              style={{

                margin: "0 0 16px",



                color: "#d8e9ff",



                fontWeight: 600,



                lineHeight: 1.4,

              }}

            >

              {statusMsg.includes("Your turn") ? (

                <>

                  Your turn (

                  <span

                    style={{

                      color: mySymbol === "X" ? "#ff7e9f" : "#80dbff",

                      fontWeight: 800,

                      marginLeft: "4px",

                      animation: "blink 1s infinite"

                    }}

                  >

                    {mySymbol}

                  </span>

                  )

                </>

              ) : (

                statusMsg

              )}

            </p>



            {gameState.gameMode === "timed" &&

              timeRemaining !== null &&

              !gameOver && (

                <div

                  style={{

                    borderRadius: "12px",



                    border:

                      timeRemaining <= 10

                        ? "1px solid rgba(255,128,128,0.75)"

                        : "1px solid rgba(123,212,255,0.5)",



                    background:

                      timeRemaining <= 10

                        ? "rgba(255,92,122,0.2)"

                        : "rgba(39,130,255,0.2)",



                    color: "#fff",



                    textAlign: "center",



                    fontWeight: 800,



                    fontSize: "clamp(24px, 5vw, 34px)",



                    padding: "12px",



                    marginBottom: "12px",



                    animation:

                      timeRemaining <= 5 ? "pulse 1s infinite" : "none",

                  }}

                >

                  <span role="img" aria-label="timer">

                    ⏱️

                  </span>{" "}

                  {timeRemaining}s

                </div>

              )}



            {error && (

              <div

                style={{

                  borderRadius: "10px",



                  padding: "10px 12px",



                  marginBottom: "12px",



                  background: "rgba(255,83,120,0.2)",



                  border: "1px solid rgba(255,130,156,0.5)",



                  color: "#ffd8e4",



                  animation: "shake 0.45s",

                }}

              >

                {error}

              </div>

            )}



            {!gameOver && (

              <button

                onClick={onLeave}

                style={{

                  width: "100%",



                  borderRadius: "10px",



                  border: "1px solid rgba(255,255,255,0.18)",



                  background: "rgba(255,255,255,0.03)",



                  color: "#b9c8e4",



                  padding: "10px",



                  cursor: "pointer",



                  fontWeight: 700,

                }}

              >

                Leave Match

              </button>

            )}

          </div>



          <div

            style={{

              borderRadius: "18px",



              border: "1px solid rgba(255,255,255,0.09)",



              background: "rgba(10,20,48,0.82)",



              padding: "16px",

            }}

          >

            <div

              style={{

                display: "grid",



                gridTemplateColumns: "repeat(3, clamp(84px, 16vw, 120px))",



                gap: "10px",



                justifyContent: "center",



                marginBottom: gameOver ? "14px" : 0,

              }}

            >

              {gameState.board.map((cell, index) => (

                <div

                  key={index}

                  style={cellStyle(cell, index)}

                  onClick={() => handleCellClick(index)}

                >

                  {cell}

                </div>

              ))}

            </div>



            {gameOver && (

              <div

                style={{

                  borderRadius: "14px",



                  border: "1px solid rgba(255,255,255,0.14)",



                  background: "rgba(255,255,255,0.03)",



                  textAlign: "center",



                  padding: "16px",

                }}

              >

                <h2

                  style={{

                    margin: "0 0 12px",



                    color: "#fff",



                    fontSize: "clamp(22px, 4vw, 30px)",

                  }}

                >

                  {gameOverMsg}

                </h2>



                <button

                  onClick={onLeave}

                  style={{

                    borderRadius: "10px",



                    border: "none",



                    background:

                      "linear-gradient(130deg, rgba(255,95,140,1) 0%, rgba(124,142,255,1) 100%)",



                    color: "white",



                    padding: "10px 18px",



                    fontWeight: 800,



                    cursor: "pointer",

                  }}

                >

                  Back to Lobby

                </button>

              </div>

            )}

          </div>

        </div>

      </div>

    </div>

  );

};



export default GamePage;

