/// <reference types="nakama-runtime" />

const matchInit = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  params: { [key: string]: string }
): { state: nkruntime.MatchState; tickRate: number; label: string } {
  const state: MatchState = {
    board: createEmptyBoard(),
    players: {},
    playerOrder: [],
    currentTurn: "",
    status: "waiting",
    winner: null,
    winnerSymbol: null,
    moveCount: 0,
  };

  logger.info("Match initialized");

  return {
    state,
    tickRate: 1,
    label: "waiting",
  };
};

const matchJoinAttempt = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presence: nkruntime.Presence,
  metadata: { [key: string]: any }
): { state: nkruntime.MatchState; accept: boolean; rejectMessage?: string } | null {
  const mState = state as MatchState;

  // allow rejoin if player is already in the match
  if (mState.players[presence.userId]) {
    return { state, accept: true };
  }

  if (mState.playerOrder.length >= 2) {
    return { state, accept: false, rejectMessage: "Match is full" };
  }

  return { state, accept: true };
};

const matchJoin = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presences: nkruntime.Presence[]
): { state: nkruntime.MatchState } | null {
  const mState = state as MatchState;

  for (const presence of presences) {
    // skip if player already exists
    if (mState.players[presence.userId]) {
      logger.info("Player rejoined: " + presence.username);
      mState.players[presence.userId].connected = true;
      continue;
    }
    const symbol = mState.playerOrder.length === 0 ? "X" : "O";
    mState.players[presence.userId] = {
      userId: presence.userId,
      username: presence.username,
      symbol,
      connected: true,
    };
    mState.playerOrder.push(presence.userId);
    logger.info("Player joined: " + presence.username + " as " + symbol);
  }

  if (mState.playerOrder.length === 2) {
    mState.status = "playing";
    mState.currentTurn = mState.playerOrder[0];

    const startMessage = {
      type: "match_start",
      board: mState.board,
      players: mState.players,
      currentTurn: mState.currentTurn,
    };
    dispatcher.broadcastMessage(1, JSON.stringify(startMessage), null, null, true);
    dispatcher.matchLabelUpdate("playing");
    logger.info("Match started!");
  }

  return { state: mState };
};

const matchLeave = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presences: nkruntime.Presence[]
): { state: nkruntime.MatchState } | null {
  const mState = state as MatchState;

  for (const presence of presences) {
    if (mState.players[presence.userId]) {
      mState.players[presence.userId].connected = false;
      logger.info("Player left: " + presence.username);
    }
  }

  if (mState.status === "playing") {
    // find the remaining player
    const remainingPlayerId = mState.playerOrder.find(
      id => mState.players[id] && mState.players[id].connected
    );

    if (remainingPlayerId) {
      mState.status = "finished";
      mState.winner = remainingPlayerId;
      mState.winnerSymbol = mState.players[remainingPlayerId].symbol;
      mState.currentTurn = ""; // Clear current turn when game ends

      const leaveMessage = {
        type: "player_left",
        winner: remainingPlayerId,
        winnerSymbol: mState.winnerSymbol,
        message: "Opponent disconnected. You win!",
      };
      dispatcher.broadcastMessage(4, JSON.stringify(leaveMessage), null, null, true);
    }
  }

  return { state: mState };
};

const matchLoop = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  messages: nkruntime.MatchMessage[]
): { state: nkruntime.MatchState } | null {
  const mState = state as MatchState;

  if (mState.status !== "playing") {
    return { state: mState };
  }

  for (const message of messages) {
    const senderId = message.sender.userId;

    // ignore messages from players not in this match
    if (!mState.players[senderId]) continue;

    // ignore if not this player's turn
    if (senderId !== mState.currentTurn) {
      const errorMsg = { type: "error", message: "Not your turn" };
      dispatcher.broadcastMessage(99, JSON.stringify(errorMsg), [message.sender], null, true);
      continue;
    }

    let move: MoveMessage;
    try {
      move = JSON.parse(nk.binaryToString(message.data));
    } catch (e) {
      logger.error("Failed to parse move message");
      continue;
    }

    const position = move.position;

    // validate position
    if (position < 0 || position > 8 || mState.board[position] !== "") {
      const errorMsg = { type: "error", message: "Invalid move" };
      dispatcher.broadcastMessage(99, JSON.stringify(errorMsg), [message.sender], null, true);
      continue;
    }

    // apply the move
    const playerSymbol = mState.players[senderId].symbol;
    mState.board[position] = playerSymbol;
    mState.moveCount++;

    // check for winner
    const winnerSymbol = checkWinner(mState.board);
    if (winnerSymbol) {
      mState.status = "finished";
      mState.winnerSymbol = winnerSymbol;
      mState.winner = Object.values(mState.players).find(
        p => p.symbol === winnerSymbol
      )?.userId || null;
      mState.currentTurn = ""; // Clear current turn when game ends

      // update leaderboard
      if (mState.winner) {
        const loserId = mState.playerOrder.find(id => id !== mState.winner) || "";
        try {
          nk.leaderboardRecordWrite("tictactoe_global", mState.winner, "", 3);
if (loserId) {
  nk.leaderboardRecordWrite("tictactoe_global", loserId, "", 0);
}
        } catch (e) {
          logger.error("Failed to update leaderboard: " + e);
        }
      }

      const gameOverMsg = {
        type: "game_over",
        board: mState.board,
        winner: mState.winner,
        winnerSymbol: mState.winnerSymbol,
        isDraw: false,
      };
      dispatcher.broadcastMessage(3, JSON.stringify(gameOverMsg), null, null, true);
      return { state: mState };
    }

    // check for draw
    if (checkDraw(mState.board)) {
      mState.status = "finished";
      mState.currentTurn = ""; // Clear current turn when game ends

      // give both players 1 point for draw
      for (const playerId of mState.playerOrder) {
        try {
          nk.leaderboardRecordWrite("tictactoe_global", playerId, "", 1);
        } catch (e) {
          logger.error("Failed to update leaderboard for draw: " + e);
        }
      }

      const drawMsg = {
        type: "game_over",
        board: mState.board,
        winner: null,
        winnerSymbol: null,
        isDraw: true,
      };
      dispatcher.broadcastMessage(3, JSON.stringify(drawMsg), null, null, true);
      return { state: mState };
    }

    // game continues - switch turn
    mState.currentTurn = mState.playerOrder.find(id => id !== senderId) || "";

    const stateUpdate = {
      type: "state_update",
      board: mState.board,
      currentTurn: mState.currentTurn,
      lastMove: { position, symbol: playerSymbol, playerId: senderId },
    };
    dispatcher.broadcastMessage(2, JSON.stringify(stateUpdate), null, null, true);
  }

  return { state: mState };
};

const matchTerminate = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  graceSeconds: number
): { state: nkruntime.MatchState } | null {
  return { state };
};

const matchSignal = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  data: string
): { state: nkruntime.MatchState; data: string } | null {
  return { state, data };
};
