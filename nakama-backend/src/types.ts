/// <reference types="nakama-runtime" />

interface Player {
  userId: string;
  username: string;
  symbol: "X" | "O";
  connected: boolean;
}

interface MatchState {
  board: string[];
  players: { [userId: string]: Player };
  playerOrder: string[];
  currentTurn: string;
  status: "waiting" | "playing" | "finished";
  winner: string | null;
  winnerSymbol: string | null;
  moveCount: number;
}

interface MoveMessage {
  position: number;
}
