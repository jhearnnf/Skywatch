const { CBAT_GAMES, cbatLabelWithDifficulty, isCbatHardKey } = require('../constants/cbatGames');
const { boardPositionFor } = require('./cbatBoardRank');

// One agent's CBAT record: attempts, personal best and last play on every
// registry entry they have finished, most played first. Shared by the admin
// profile and the public one so the two can never disagree about a best score.
//
// One $group per registry entry rather than per Model: two entries can share a
// collection and each needs its own modeFilter (see CBAT_GAMES).
async function cbatRecordFor(uid) {
  const rows = await Promise.all(Object.entries(CBAT_GAMES).map(async ([gameKey, cfg]) => {
    const [row] = await cfg.Model.aggregate([
      { $match: { ...(cfg.modeFilter ?? {}), userId: uid } },
      { $group: {
        _id: null,
        attempts:     { $sum: 1 },
        best:         { [cfg.bestOp]: `$${cfg.primaryField}` },
        lastPlayedAt: { $max: '$createdAt' },
      } },
    ]);
    if (!row?.attempts) return null;
    return {
      gameKey,
      label:        cbatLabelWithDifficulty(gameKey),
      attempts:     row.attempts,
      best:         row.best ?? null,
      lastPlayedAt: row.lastPlayedAt ?? null,
    };
  }));
  return rows.filter(Boolean).sort((a, b) => b.attempts - a.attempts);
}

// Where they currently stand on each of those all-time boards, ranked against
// the SAME padded board a player sees — best-per-user, with the demo agents
// padLeaderboard injects into thin games counted as the places they visibly
// occupy. Telling an admin someone is 2nd while the board shows them 5th would
// make the page worse than silent.
//
// Only for games they have actually finished: an unplayed board has no
// position to report and each one costs an aggregation. Mutates and returns
// the record.
async function withBoardRanks(cbatGames, uid) {
  await Promise.all(cbatGames.map(async (g) => {
    try {
      g.boardRank = await boardPositionFor(g.gameKey, CBAT_GAMES[g.gameKey], uid);
    } catch {
      // One unrankable board must not cost the page every other number on it.
      g.boardRank = null;
    }
  }));
  return cbatGames;
}

// The podium places, best first — the same medals chat hangs off their avatar.
// Derived from the boards just ranked rather than read from the medal cache,
// so a page is never up to five minutes behind itself.
function medalsFrom(cbatGames) {
  return cbatGames
    .filter(g => g.boardRank && g.boardRank <= 3)
    .map(g => ({ gameKey: g.gameKey, gameLabel: g.label, rank: g.boardRank, hard: isCbatHardKey(g.gameKey) }))
    .sort((a, b) => a.rank - b.rank || b.hard - a.hard);
}

module.exports = { cbatRecordFor, withBoardRanks, medalsFrom };
