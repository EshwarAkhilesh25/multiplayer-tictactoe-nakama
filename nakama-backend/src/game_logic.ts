/// <reference types="nakama-runtime" />

const WINNING_COMBINATIONS = [
  [0, 1, 2], // top row
  [3, 4, 5], // middle row
  [6, 7, 8], // bottom row
  [0, 3, 6], // left column
  [1, 4, 7], // middle column
  [2, 5, 8], // right column
  [0, 4, 8], // diagonal
  [2, 4, 6], // diagonal
];

function checkWinner(board: string[]): string | null {
  for (const combo of WINNING_COMBINATIONS) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a]; // returns "X" or "O"
    }
  }
  return null;
}

function checkDraw(board: string[]): boolean {
  return board.every(cell => cell !== "") && checkWinner(board) === null;
}

function createEmptyBoard(): string[] {
  return ["", "", "", "", "", "", "", "", ""];
}
