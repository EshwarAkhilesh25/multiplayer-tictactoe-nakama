/// <reference types="nakama-runtime" />

const createMatchRpc: nkruntime.RpcFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const matchId = nk.matchCreate("tictactoe", {});
  logger.info("Match created: " + matchId);
  return JSON.stringify({ matchId: matchId });
};

const getLeaderboardRpc: nkruntime.RpcFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  try {
    const result = nk.leaderboardRecordsList("tictactoe_global", [], 10, null, null);
    return JSON.stringify({ records: result.records || [] });
  } catch (e) {
    logger.error("Failed to get leaderboard: " + e);
    return JSON.stringify({ records: [] });
  }
};

const listMatchesRpc: nkruntime.RpcFunction = function(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const matches = nk.matchList(10, true, "waiting", null, null, "*");
  logger.info("Found " + matches.length + " open matches");
  return JSON.stringify({ matches: matches });
};