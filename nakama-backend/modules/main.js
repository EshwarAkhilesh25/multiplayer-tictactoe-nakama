/// <reference types="nakama-runtime" />

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

function checkWinner(board) {

    for (const combo of WINNING_COMBINATIONS) {

        const [a, b, c] = combo;

        if (board[a] && board[a] === board[b] && board[a] === board[c]) {

            return board[a]; // returns "X" or "O"

        }

    }

    return null;

}

function checkDraw(board) {

    return board.every(cell => cell !== "") && checkWinner(board) === null;

}

function createEmptyBoard() {

    return ["", "", "", "", "", "", "", "", ""];

}

/// <reference types="nakama-runtime" />

const matchInit = function (ctx, logger, nk, params) {

    const gameMode = params?.gameMode || "classic";

    const state = {

        board: createEmptyBoard(),

        players: {},

        playerOrder: [],

        currentTurn: "",

        status: "waiting",

        winner: null,

        winnerSymbol: null,

        moveCount: 0,

        gameMode: gameMode,

        turnStartTime: 0,

        turnTimeLimit: gameMode === "timed" ? 30 : 0,

        lastMoveTime: {},  // Track last move time per player for throttling

        moveThrottleMs: 100,  // Minimum 100ms between moves per player

    };

    logger.info("Match initialized with mode: " + gameMode);

    return {

        state,

        tickRate: 1,

        label: gameMode === "timed" ? "waiting_timed" : "waiting_classic",

    };

};

const matchJoinAttempt = function (ctx, logger, nk, dispatcher, tick, state, presence, metadata) {

    const mState = state;

    // allow rejoin if player is already in the match

    if (mState.players[presence.userId]) {

        return { state, accept: true };

    }

    if (mState.playerOrder.length >= 2) {

        return { state, accept: false, rejectMessage: "Match is full" };

    }

    return { state, accept: true };

};

const matchJoin = function (ctx, logger, nk, dispatcher, tick, state, presences) {

    const mState = state;

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

        mState.turnStartTime = tick;

        const startMessage = {

            type: "match_start",

            board: mState.board,

            players: mState.players,

            currentTurn: mState.currentTurn,

            gameMode: mState.gameMode,

            turnTimeLimit: mState.turnTimeLimit,

        };

        dispatcher.broadcastMessage(1, JSON.stringify(startMessage), null, null, true);

        dispatcher.matchLabelUpdate(mState.gameMode === "timed" ? "playing_timed" : "playing_classic");

        logger.info("Match started in " + mState.gameMode + " mode!");

    }

    return { state: mState };

};

const matchLeave = function (ctx, logger, nk, dispatcher, tick, state, presences) {

    const mState = state;

   

    // VALIDATION 11: Graceful Disconnection Handling

    for (const presence of presences) {

        if (mState.players[presence.userId]) {

            mState.players[presence.userId].connected = false;

            mState.players[presence.userId].disconnectTime = tick;

            logger.info("Player disconnected: " + presence.username + " (" + presence.userId + ")");

        } else {

            logger.warn("Unknown player attempted to leave: " + presence.userId);

        }

    }

   

    // VALIDATION 12: Connection Management - Handle disconnection during active game

    if (mState.status === "playing") {

        // Check if any players are still connected

        const connectedPlayers = mState.playerOrder.filter(id => mState.players[id] && mState.players[id].connected);

       

        if (connectedPlayers.length === 0) {

            // Both players disconnected - end match as draw

            logger.info("All players disconnected - ending match as draw");

            mState.status = "finished";
            dispatcher.matchLabelUpdate("finished");

            for (const playerId of mState.playerOrder) {

                updatePlayerStats(nk, logger, playerId, "draw", mState.players[playerId]?.username || "");

            }

            const drawMsg = {

                type: "game_over",

                board: mState.board,

                winner: null,

                winnerSymbol: null,

                isDraw: true,

                reason: "All players disconnected"

            };

            dispatcher.broadcastMessage(3, JSON.stringify(drawMsg), null, null, true);

            return { state: mState };

        }

       

        // Find the remaining connected player

        const remainingPlayerId = connectedPlayers[0];

        if (remainingPlayerId) {

            // Award win to remaining player (opponent disconnected/forfeited)

            logger.info("Awarding win to " + remainingPlayerId + " due to opponent disconnect");

            mState.status = "finished";
            dispatcher.matchLabelUpdate("finished");

            mState.winner = remainingPlayerId;

            mState.winnerSymbol = mState.players[remainingPlayerId]?.symbol || null;

           

            // Update stats

            updatePlayerStats(nk, logger, remainingPlayerId, "win", mState.players[remainingPlayerId]?.username || "");

            const disconnectedPlayerId = mState.playerOrder.find(id => id !== remainingPlayerId) || "";

            if (disconnectedPlayerId) {

                updatePlayerStats(nk, logger, disconnectedPlayerId, "loss", mState.players[disconnectedPlayerId]?.username || "");

                logger.info("Player " + disconnectedPlayerId + " forfeited by disconnect");

            }

           

            const winMsg = {

                type: "player_left",

                winner: remainingPlayerId,

                winnerSymbol: mState.winnerSymbol,

                message: "Opponent disconnected. You win by forfeit!"

            };

            dispatcher.broadcastMessage(4, JSON.stringify(winMsg), null, null, true);

        }

    } else if (mState.status === "waiting") {

        // Player left during waiting phase - check if match is now empty

        const connectedPlayers = mState.playerOrder.filter(id => mState.players[id] && mState.players[id].connected);

        if (connectedPlayers.length === 0) {

            // All players left - cancel the match

            logger.info("All players left during waiting phase - cancelling match");

            mState.status = "finished";

            dispatcher.matchLabelUpdate("finished");

            // Add to cancelled matches list for filtering

            try {

                const cancelledMatchesKey = "cancelled_matches";

                const storageObjectId = {

                    collection: "system",

                    key: cancelledMatchesKey,

                    userId: ctx.userId

                };

                let cancelledMatches = [];

                try {

                    const objects = nk.storageRead([storageObjectId]);

                    if (objects.length > 0) {

                        cancelledMatches = objects[0].value?.cancelled_matches || [];

                    }

                } catch (e) {

                    logger.info("Creating new cancelled matches list");

                }

                // Add this match to cancelled list

                if (!cancelledMatches.includes(mState.matchId)) {

                    cancelledMatches.push(mState.matchId);

                    const write = {

                        collection: "system",

                        key: cancelledMatchesKey,

                        userId: ctx.userId,

                        value: { cancelled_matches: cancelledMatches },

                        permissionRead: 0,

                        permissionWrite: 0

                    };

                    nk.storageWrite([write]);

                    logger.info("Empty match added to cancelled list: " + mState.matchId);

                }

            } catch (e) {

                logger.error("Failed to add empty match to cancelled list: " + e);

            }

        } else {

            logger.info("Player left during waiting phase - " + connectedPlayers.length + " players remain");

        }

    }

    return { state: mState };

};

const matchLoop = function (ctx, logger, nk, dispatcher, tick, state, messages) {

    const mState = state;

   

    // VALIDATION 1: Game Status Check - Reject moves if game is not in playing state

    if (mState.status !== "playing") {

        return { state: mState };

    }

   

    // VALIDATION 2: Timeout Validation - Check for turn timeout in timed mode

    if (mState.gameMode === "timed" && mState.turnTimeLimit > 0) {

        const elapsedSeconds = tick - mState.turnStartTime;

        if (elapsedSeconds >= mState.turnTimeLimit) {

            // Current player loses by timeout

            const timeoutPlayerId = mState.currentTurn;

            const winnerId = mState.playerOrder.find(id => id !== timeoutPlayerId) || "";

            mState.status = "finished";
            dispatcher.matchLabelUpdate("finished");

            mState.winner = winnerId;

            mState.winnerSymbol = mState.players[winnerId]?.symbol || null;

            // Update stats

            updatePlayerStats(nk, logger, winnerId, "win", mState.players[winnerId]?.username || "");

            updatePlayerStats(nk, logger, timeoutPlayerId, "loss", mState.players[timeoutPlayerId]?.username || "");

            const timeoutMsg = {

                type: "timeout",

                winner: winnerId,

                winnerSymbol: mState.winnerSymbol,

                message: "Time's up! " + mState.players[timeoutPlayerId]?.username + " took too long.",

            };

            dispatcher.broadcastMessage(5, JSON.stringify(timeoutMsg), null, null, true);

            logger.warn("Player " + timeoutPlayerId + " timed out");

            return { state: mState };

        }

    }

   

    for (const message of messages) {

        const senderId = message.sender.userId;

       

        // VALIDATION 3: Identity Verification - Ensure sender is a participant in this match

        if (!mState.players[senderId]) {

            logger.warn("Rejected move from non-participant: " + senderId);

            const errorMsg = { type: "error", message: "You are not a participant in this match" };

            dispatcher.broadcastMessage(99, JSON.stringify(errorMsg), [message.sender], null, true);

            continue;

        }

       

        // VALIDATION 4: Turn Validation - Verify it's the correct player's turn

        if (senderId !== mState.currentTurn) {

            logger.warn("Player " + senderId + " attempted out-of-turn move");

            const errorMsg = { type: "error", message: "Not your turn. Wait for opponent's move." };

            dispatcher.broadcastMessage(99, JSON.stringify(errorMsg), [message.sender], null, true);

            continue;

        }

       

        // VALIDATION 5: Message Throttling - Prevent spam attacks

        const currentTime = Date.now();

        const lastMoveTime = mState.lastMoveTime[senderId] || 0;

        if (currentTime - lastMoveTime < mState.moveThrottleMs) {

            logger.warn("Player " + senderId + " is sending moves too quickly (throttled)");

            const errorMsg = { type: "error", message: "Please wait before making another move" };

            dispatcher.broadcastMessage(99, JSON.stringify(errorMsg), [message.sender], null, true);

            continue;

        }

        mState.lastMoveTime[senderId] = currentTime;

        // VALIDATION 6: Message Parsing - Validate message format

        let move;

        try {

            move = JSON.parse(nk.binaryToString(message.data));

        }

        catch (e) {

            logger.error("Failed to parse move message from " + senderId + ": " + e);

            const errorMsg = { type: "error", message: "Invalid message format" };

            dispatcher.broadcastMessage(99, JSON.stringify(errorMsg), [message.sender], null, true);

            continue;

        }

       

        // VALIDATION 7: Move Data Validation - Ensure position field exists

        if (typeof move.position !== "number") {

            logger.warn("Invalid move data from " + senderId + ": missing or invalid position");

            const errorMsg = { type: "error", message: "Invalid move data" };

            dispatcher.broadcastMessage(99, JSON.stringify(errorMsg), [message.sender], null, true);

            continue;

        }

       

        const position = move.position;

       

        // VALIDATION 8: Grid Boundaries - Ensure position is within valid range (0-8)

        if (position < 0 || position > 8) {

            logger.warn("Player " + senderId + " attempted move outside grid boundaries: " + position);

            const errorMsg = { type: "error", message: "Move position out of bounds (must be 0-8)" };

            dispatcher.broadcastMessage(99, JSON.stringify(errorMsg), [message.sender], null, true);

            continue;

        }

       

        // VALIDATION 9: Cell Availability - Ensure the cell is empty

        if (mState.board[position] !== "") {

            logger.warn("Player " + senderId + " attempted to play on occupied cell: " + position);

            const errorMsg = { type: "error", message: "Cell already occupied. Choose an empty cell." };

            dispatcher.broadcastMessage(99, JSON.stringify(errorMsg), [message.sender], null, true);

            continue;

        }

       

        // VALIDATION 10: Double-check game hasn't ended (race condition protection)

        if (mState.status !== "playing") {

            logger.warn("Move rejected - game already ended");

            const errorMsg = { type: "error", message: "Game has already ended" };

            dispatcher.broadcastMessage(99, JSON.stringify(errorMsg), [message.sender], null, true);

            continue;

        }

        // All validations passed - apply the move

        const playerSymbol = mState.players[senderId].symbol;

        mState.board[position] = playerSymbol;

        mState.moveCount++;

        logger.info("Valid move by " + senderId + " (" + playerSymbol + ") at position " + position);

        // check for winner

        const winnerSymbol = checkWinner(mState.board);
        logger.info("Checking for winner... result: " + (winnerSymbol || "none"));

        if (winnerSymbol) {

            mState.status = "finished";
            dispatcher.matchLabelUpdate("finished");

            mState.winnerSymbol = winnerSymbol;

            mState.winner = Object.values(mState.players).find(p => p.symbol === winnerSymbol)?.userId || null;

            // update stats

            if (mState.winner) {

                const loserId = mState.playerOrder.find(id => id !== mState.winner) || "";

                updatePlayerStats(nk, logger, mState.winner, "win", mState.players[mState.winner]?.username || "");

                if (loserId) {

                    updatePlayerStats(nk, logger, loserId, "loss", mState.players[loserId]?.username || "");

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
        logger.info("Checking for draw... board is full: " + mState.board.every(cell => cell !== ""));
        if (checkDraw(mState.board)) {
            logger.info("Draw detected - updating stats for both players");

            mState.status = "finished";
            dispatcher.matchLabelUpdate("finished");

            // update stats for both players

            for (const playerId of mState.playerOrder) {

                updatePlayerStats(nk, logger, playerId, "draw", mState.players[playerId]?.username || "");

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

        // game continues - switch turn and reset timer

        mState.currentTurn = mState.playerOrder.find(id => id !== senderId) || "";

        mState.turnStartTime = tick;  // Reset turn timer for next player

        const stateUpdate = {

            type: "state_update",

            board: mState.board,

            currentTurn: mState.currentTurn,

            lastMove: { position, symbol: playerSymbol, playerId: senderId },

        };

        dispatcher.broadcastMessage(2, JSON.stringify(stateUpdate), null, null, true);

        logger.info("Turn switched to " + mState.currentTurn);

    }

    return { state: mState };

};

const matchTerminate = function (ctx, logger, nk, dispatcher, tick, state, graceSeconds) {

    return { state };

};

const matchSignal = function (ctx, logger, nk, dispatcher, tick, state, data) {
    try {
        const signal = JSON.parse(data);
        if (signal.type === "cancel") {
            logger.info("Match cancelled via signal - marking as finished");
            state.cancelled = true;
            state.status = "cancelled";
            dispatcher.matchLabelUpdate("finished");
            return { state };
        }
    } catch (e) {
        // Not a JSON signal, ignore
    }
    return { state, data };
};

/// <reference types="nakama-runtime" />

function updatePlayerStats(nk, logger, userId, result, username) {

    logger.info("updatePlayerStats called for userId: " + userId + " result: " + result + " username: " + username);

    try {

        const objectId = {

            collection: "stats",

            key: "player_stats",

            userId: userId,

        };

        let stats = { wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0, totalGames: 0 };

        try {

            const objects = nk.storageRead([objectId]);

            if (objects.length > 0) {

                stats = objects[0].value;

            }

        }

        catch (e) {

            logger.info("Creating new stats for user: " + userId);

        }

        stats.totalGames++;

        if (result === "win") {

            stats.wins++;

            stats.currentStreak++;

            if (stats.currentStreak > stats.bestStreak) {

                stats.bestStreak = stats.currentStreak;

            }

            // Using increment operator - send only points earned this game (3 for win)
            logger.info("Writing to leaderboard for winner: " + username + " adding 3 points");
            nk.leaderboardRecordWrite("tictactoe_global", userId, username, 3);

        }

        else if (result === "loss") {

            stats.losses++;

            stats.currentStreak = 0;

        }

        else if (result === "draw") {

            stats.draws++;
            // Using increment operator - send only points earned this game (1 for draw)
            logger.info("Writing to leaderboard for draw: " + username + " adding 1 point");
            nk.leaderboardRecordWrite("tictactoe_global", userId, username, 1);

        }

        const write = {

            collection: "stats",

            key: "player_stats",

            userId: userId,

            value: stats,

            permissionRead: 1,

            permissionWrite: 0,

        };

        nk.storageWrite([write]);

    }

    catch (e) {

        logger.error("Failed to update stats: " + e);

    }

}

const createMatchRpc = function (ctx, logger, nk, payload) {

    const params = payload ? JSON.parse(payload) : {};

    const gameMode = params.gameMode || "classic";

    const matchId = nk.matchCreate("tictactoe", { gameMode: gameMode });

    logger.info("Match created with mode: " + gameMode + ", ID: " + matchId);

    return JSON.stringify({ matchId: matchId, gameMode: gameMode });

};

const deleteMatchRpc = function (ctx, logger, nk, payload) {
    logger.info("delete_match RPC called by user=" + ctx.username + " with payload: " + payload);
    try {
        const params = payload ? JSON.parse(payload) : {};
        const matchId = params.matchId;

        if (!matchId) {
            return JSON.stringify({ success: false, error: "Match ID required" });
        }

        const match = nk.matchGet(matchId);
        if (!match) {
            return JSON.stringify({ success: false, error: "Match not found" });
        }

        // Only cancel matches that are still waiting (no opponent joined yet)
        if (match.label !== "waiting_classic" && match.label !== "waiting_timed") {
            return JSON.stringify({ success: false, error: "Cannot cancel an active match" });
        }

        // Signal the match to terminate and mark itself as "finished"
        // This removes it from list_matches for ALL players immediately
        nk.matchSignal(matchId, JSON.stringify({ type: "cancel" }));
        logger.info("Cancel signal sent to match: " + matchId);

        return JSON.stringify({ success: true, message: "Match cancelled" });

    } catch (e) {
        logger.error("Failed to delete match: " + e);
        return JSON.stringify({ success: false, error: "Server error" });
    }
};

const resetLeaderboardRpc = function (ctx, logger, nk, payload) {
    logger.info("resetLeaderboardRpc called - clearing all leaderboard records");
    try {
        const result = nk.leaderboardRecordsList("tictactoe_global", [], 1000, null, null);
        const records = result.records || [];
        logger.info("Found " + records.length + " records to delete");
        for (const record of records) {
            nk.leaderboardRecordDelete("tictactoe_global", record.ownerId);
        }
        logger.info("Leaderboard cleared successfully");
        return JSON.stringify({ success: true, deleted: records.length });
    } catch (e) {
        logger.error("Failed to reset leaderboard: " + e);
        return JSON.stringify({ success: false, error: String(e) });
    }
};

const getLeaderboardRpc = function (ctx, logger, nk, payload) {
    logger.info("getLeaderboardRpc called");
    try {
        const result = nk.leaderboardRecordsList("tictactoe_global", null, 10, null, null);
        const records = result.records || [];
        logger.info("Raw record count: " + records.length);

        // Fetch usernames directly from user accounts for all record owners
        const ownerIds = records.map(r => r.ownerId).filter(Boolean);
        let userMap = {};
        if (ownerIds.length > 0) {
            try {
                const users = nk.usersGetId(ownerIds);
                logger.info("usersGetId returned " + users.length + " users for " + ownerIds.length + " owners");
                if (users.length > 0) {
                    logger.info("User object keys: " + JSON.stringify(Object.keys(users[0])));
                    logger.info("User object sample: " + JSON.stringify(users[0]));
                }
                users.forEach(u => {
                    const uid = u.userId || u.id || u.user_id || u.accountId;
                    userMap[uid] = u.username;
                    logger.info("User uid=" + uid + " -> " + u.username);
                });
            } catch (e) {
                logger.error("usersGetId failed: " + e);
            }
        }

        const enriched = records.map(r => ({
            ownerId:  r.ownerId || "",
            username: userMap[r.ownerId] || r.username || null,
            score:    r.score   || 0,
            rank:     r.rank    || 0,
        })).filter(r => r.username);

        logger.info("Returning " + enriched.length + " enriched leaderboard records");
        return JSON.stringify({ records: enriched });
    }
    catch (e) {
        logger.error("Failed to get leaderboard: " + e);
        return JSON.stringify({ records: [] });
    }
};

const getPlayerStatsRpc = function (ctx, logger, nk, payload) {

    try {

        const userId = ctx.userId;

        const objectId = {

            collection: "stats",

            key: "player_stats",

            userId: userId,

        };

        let stats = { wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0, totalGames: 0 };

        try {

            const objects = nk.storageRead([objectId]);

            if (objects.length > 0) {

                stats = objects[0].value;

            }

        }

        catch (e) {

            logger.info("No stats found for user: " + userId);

        }

        return JSON.stringify({ stats: stats });

    }

    catch (e) {

        logger.error("Failed to get player stats: " + e);

        return JSON.stringify({ stats: { wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0, totalGames: 0 } });

    }

};

const listMatchesRpc = function (ctx, logger, nk, payload) {
    const params = payload ? JSON.parse(payload) : {};
    const gameMode = params.gameMode || "classic";
    logger.info("list_matches RPC called by user=" + ctx.username + " gameMode=" + gameMode);
    
    const waitingLabel = gameMode === "timed" ? "waiting_timed" : "waiting_classic";
    const playingLabel = gameMode === "timed" ? "playing_timed" : "playing_classic";

    // Fetch all active matches and filter by label
    // Cancelled matches are marked "finished" via matchSignal so they are excluded naturally
    const allMatches = nk.matchList(100, true, null, null, null, "*");
    logger.info("Total matches found: " + allMatches.length);

    const filteredMatches = allMatches.filter(function(m) {
        return m.label === waitingLabel || m.label === playingLabel;
    });

    logger.info("Returning " + filteredMatches.length + " matches for mode: " + gameMode);
    return JSON.stringify({ matches: filteredMatches });
};

/// <reference path="types.ts" />

/// <reference path="game_logic.ts" />

/// <reference path="match_handler.ts" />

/// <reference path="rpcs.ts" />

/// <reference types="nakama-runtime" />

function InitModule(ctx, logger, nk, initializer) {

    try {

        nk.leaderboardCreate("tictactoe_global", false, "descending" /* nkruntime.SortOrder.DESCENDING */, "increment" /* nkruntime.Operator.INCREMENTAL */, null, {});

        logger.info("Leaderboard created!");

    }

    catch (e) {

        logger.info("Leaderboard already exists");

    }

    initializer.registerMatch("tictactoe", {

        matchInit: matchInit,

        matchJoinAttempt: matchJoinAttempt,

        matchJoin: matchJoin,

        matchLeave: matchLeave,

        matchLoop: matchLoop,

        matchTerminate: matchTerminate,

        matchSignal: matchSignal,

    });

    initializer.registerRpc("create_match", createMatchRpc);

    initializer.registerRpc("delete_match", deleteMatchRpc);

    initializer.registerRpc("get_leaderboard", getLeaderboardRpc);

    initializer.registerRpc("reset_leaderboard", resetLeaderboardRpc);

    initializer.registerRpc("get_player_stats", getPlayerStatsRpc);

    initializer.registerRpc("list_matches", listMatchesRpc);

    logger.info("Tic-Tac-Toe module loaded!");

}