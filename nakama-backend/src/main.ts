/// <reference path="types.ts" />
/// <reference path="game_logic.ts" />
/// <reference path="match_handler.ts" />
/// <reference path="rpcs.ts" />
/// <reference types="nakama-runtime" />

function InitModule(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
): Error | void {

  try {
    nk.leaderboardCreate(
      "tictactoe_global",
      false,
      nkruntime.SortOrder.DESCENDING,
      nkruntime.Operator.INCREMENTAL,
      null,
      {}
    );
    logger.info("Leaderboard created!");
  } catch (e) {
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
  initializer.registerRpc("get_leaderboard", getLeaderboardRpc);
  initializer.registerRpc("list_matches", listMatchesRpc);

  logger.info("Tic-Tac-Toe module loaded!");
}