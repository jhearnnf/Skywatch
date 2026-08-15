const { CBAT_GAMES } = require('../constants/cbatGames');

// Deterministic, believable filler for CBAT leaderboards so new users never
// see a sparse or empty board. Fakes can outrank real entries — after padding,
// the merged list is resorted by score-priority-then-time, so each row's
// position reflects its actual score.

// Pool of 7-digit agent numbers matching the shape of real ones (see User model).
// Each game picks a different offset so the roster varies per board.
const FAKE_AGENTS = [
  '2847193', '5102338', '4061729', '3384501', '6728014',
  '1904872', '7532091', '2360458', '4917263', '5845120',
  '3079614', '6451802', '2183947', '5692035', '4738621',
  '3917205', '2504816', '6183470', '4260917', '5371829',
  '3648102', '2971305', '5814026', '4503718', '6247193',
];

const GAME_OFFSET = {
  'plane-turn-2d':   0,
  'plane-turn-3d':   1,
  'angles':          4,
  'code-duplicates': 8,
  'symbols':        12,
  'target':         16,
  'instruments':    20,
  'ant':             2,
  'flag':            6,
  'flag-easier':     7,
  'visualisation-2d': 10,
  'visualisation-3d': 11,
  'dpt':             14,
  'trace-1':         13,
  'trace-2':         19,
  'numerical-ops':   15,
  'numerical-ops-easier': 9,
  'act':             18,
  'dad':             22,
  'cut':              3,
  'cut-easier':       5,
  'sat':             21,
  'sat-easier':      17,
  'rtt':             23,
  'rtt-easier':      24,
  'sit':             25,
  'sit-easier':      26,
  'slt':             27,
  'slt-easier':      28,
  'vlt':             29,
  'vlt-easier':      30,
  'matf':            31,
  'matf-easier':     32,
  'vigilance':       33,
  'sma':             34,
  'sma-easier':      35,
};

// Per-game score/time tuning. Every fake score stays inside [floor, ceiling]:
//   - floor > 0 (no demo shows a zero)
//   - ceiling < game max (no demo hits the perfect score)
// seedScore is the best-ranked fake when the pool is empty; the generator
// walks from there toward the worse end using SCORE_STEPS / TIME_STEPS.
// scoreSequence (optional) overrides the step generator when a game's real
// scores can only take specific values (e.g. ANT awards 0/5/10 per round,
// so totals are always multiples of 5).
// timeSequence (optional) does for times what scoreSequence does for scores,
// and exists for a different reason: the stepped generator walks time up in
// lockstep with score walking down, so every row is slower than the one above
// it. On a game where speed and accuracy trade off — rush the answers and you
// finish fast with a worse score — a perfectly anti-correlated board is the
// tell that it's generated. An explicit sequence lets a mid-table row be the
// quickest on the board.
// seedTime is the fastest fake's totalTime; timeStep scales the between-row
// deltas. Both reflect what a real completion actually looks like for each
// game (e.g. code-duplicates is 15 rounds × ~5s display + answer ≈ 100–200s,
// instruments is capped at a 90-second timer, ANT runs 8×60s rounds ≈ 180–450s).
//
// Both seedTime and timeStep are kept non-integer so the rounded 1-decimal
// display (`bestTime.toFixed(1)`) varies row-to-row (e.g. 80.4 / 83.7 / 87.0…)
// instead of every demo row showing a .0 second tie. Exception: `flag` and
// `flag-easier` are fixed-60s games where every real run also displays 60.0,
// so their fakes match.
const FAKE_TUNING = {
  'plane-turn-2d': {
    floor: 42, ceiling: 107, seedTime: 80.4, timeStep: 3.3,
    scoreSequence: [42, 45, 48, 52, 55, 58, 62, 65, 68, 72, 75, 78, 82, 85, 88, 92, 95, 98, 102, 107],
  },
  'plane-turn-3d': {
    // 3D adds vertical navigation, climbs/dives, and quaternion rotations —
    // real best runs land closer to ~180 rotations, not the ~65 the early
    // tuning assumed. Top demo of 180 keeps the board feeling competitive
    // without giving users a trivially-beatable target.
    floor: 180, ceiling: 265, seedTime: 220.7, timeStep: 4.7,
    scoreSequence: [180, 185, 190, 195, 200, 205, 210, 215, 220, 225, 230, 235, 240, 244, 248, 252, 256, 260, 263, 265],
  },
  'angles':          { floor: 1,  ceiling: 19,  seedScore: 18,  seedTime: 38.4, scoreStep: 1,  timeStep: 2.5 },
  'code-duplicates': {
    floor: 7, ceiling: 14, seedTime: 88.7, timeStep: 3.4,
    // 20 values, monotonically non-increasing, max 13, min 7 (out of 15).
    // Times run ~88s → ~165s — bracketing realistic user runs (15 rounds ×
    // 5s display + answer time ≈ 85s fast / 160s slow).
    scoreSequence: [13, 13, 12, 12, 12, 11, 11, 11, 10, 10, 10, 9, 9, 9, 8, 8, 8, 7, 7, 7],
  },
  'symbols':         { floor: 1,  ceiling: 14,  seedScore: 13,  seedTime: 30.6, scoreStep: 1,  timeStep: 2.3 },
  'target': {
    floor: 15, ceiling: 580, seedTime: 95.4, timeStep: 6.3,
    // Top fakes sit in the 300–600 "decent to impressive" band (Outstanding
    // threshold is 400); the rest trail off through Good / Needs Work / Failed.
    scoreSequence: [580, 520, 470, 420, 380, 340, 300, 260, 220, 180, 140, 110, 85, 65, 50, 40, 32, 25, 20, 15],
  },
  'instruments': {
    // Always runs to the 90s time limit, so fake times barely vary.
    floor: 1, ceiling: 10, seedTime: 87.4, timeStep: 0.1,
    // Top fake sits at the low end of "Good" (≥10); most of the roster is
    // "Needs Work" (5–9) or "Failed" (<5). Grade bands: 15+ / 10+ / 5+.
    scoreSequence: [10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1],
  },
  'ant': {
    floor: 15, ceiling: 75, seedTime: 210.6, timeStep: 9.3,
    // 20 multiples-of-5 values, monotonically non-increasing, max 70, min 15.
    // Every ANT total is a multiple of 5 (10 exact / 5 partial / 0 miss × 8 rounds).
    scoreSequence: [70, 65, 60, 55, 50, 50, 45, 45, 40, 40, 35, 35, 30, 30, 25, 25, 20, 20, 15, 15],
  },
  'visualisation-2d': { floor: 1, ceiling: 7, seedScore: 7, seedTime: 70.5, scoreStep: 1, timeStep: 4.3 },
  'visualisation-3d': {
    // 8 rounds of 3D shape-matching, one correct answer per round (max 8).
    // 3D is harder than 2D so the top demo sits at 7, not 8, and runs a touch
    // longer (30s/round timer × 8 = ~240s baseline + feedback → ~250–320s).
    // Explicit sequence (not the stepped generator) so the narrow 2–7 band
    // still spans 6 distinct values.
    floor: 2, ceiling: 8, seedTime: 248.5, timeStep: 2.8,
    scoreSequence: [7, 7, 7, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 2, 2, 2],
  },
  'flag': {
    // Retuned 2026-07: the old 55–104 band predated real play and sat an order
    // of magnitude under it (real median single run ≈246), so every demo row
    // was trivially beatable and the board carried no challenge. Now spans
    // 380 (a strong run — Outstanding starts at 400) down to 75, with the
    // median demo at 225 sitting just under the real median.
    //
    // Multiples of 5: every FLAG award is one (+30/-10 maths, +20/-15
    // callsign, +15/-10 target) bar the -3 for a missed callsign question, so
    // a clean run's total is always a multiple of 5 and demo rows match.
    //
    // FLAG is a fixed-60s game so all real totalTimes equal 60 too — fakes
    // match (timeStep: 0, integer seedTime) so tie-breaker order stays stable
    // AND fake rows display the same 60.0 every real row does. This is the one
    // tuning intentionally exempt from the "non-integer" rule above.
    // The floor keeps the visible top-20 above it even when sub-floor real
    // entries exist (paired with FULL_SEQUENCE_GAMES below).
    floor: 75, ceiling: 380, seedTime: 60, timeStep: 0,
    scoreSequence: [380, 355, 335, 315, 300, 285, 270, 255, 240, 225, 210, 195, 180, 165, 150, 135, 120, 105, 90, 75],
  },
  'flag-easier': {
    // Same fixed-60s shape as `flag` (integer seedTime, timeStep 0 — see the
    // note above). Every FLAG award is a multiple of 5 (+30/-10 maths,
    // +20/-15 callsign, +15/-10 target) with one exception — a missed callsign
    // question is -3 — so a clean run's total is always a multiple of 5 and
    // demo rows are built that way. Top demo of 260 is a strong Easier run
    // (Outstanding starts at 300), trailing to 60 at the foot of the board.
    floor: 60, ceiling: 260, seedTime: 60, timeStep: 0,
    scoreSequence: [260, 245, 230, 215, 200, 190, 180, 170, 160, 150, 140, 130, 120, 110, 100, 90, 80, 70, 65, 60],
  },
  'act': {
    // 5 rounds × ~45s = ~225s totalTime. Score is a sum of correct rings (+20),
    // wrong rings/missed instructions (-15/-10), wall scrape (-5/sec), and
    // graded bleep hits/misses (+25/+20/+10/-10). A capable run lands in the
    // 250–420 band; the top fake at 460 is competitive but not unbeatable.
    floor: 60, ceiling: 460, seedTime: 226.4, timeStep: 4.3,
    scoreSequence: [460, 420, 380, 350, 320, 295, 270, 245, 220, 195, 175, 155, 135, 120, 105, 95, 85, 75, 68, 60],
  },
  'dpt': {
    // totalScore accumulates across 8 rounds: +100/gate, +250/intercept,
    // +50×round completion bonus, minus danger-zone (-10/s) and bad-hit (-150)
    // penalties — a perfect no-penalty run tops out near ~5,750. Top demo of
    // 4,820 is a strong-but-beatable run; the rest trail toward ~1,100. Scores
    // land on multiples of 10 (the danger-zone penalty is per-second), so the
    // sequence keeps that granularity. Runs are long (~900–1,200s / 15–20 min).
    floor: 1100, ceiling: 5750, seedTime: 915.4, timeStep: 11.3,
    scoreSequence: [4820, 4560, 4300, 4050, 3800, 3540, 3290, 3030, 2780, 2530, 2280, 2030, 1860, 1700, 1560, 1440, 1340, 1250, 1170, 1100],
  },
  'trace-1': {
    // correctTurns out of 40 (5 rounds × 8 turns), higher is better. Top demo
    // of 37 stays just under the 40 ceiling; the roster trails to 12. Rounds
    // speed up each pass (turn intervals 1.87s → 0.93s), so a full run is
    // short — ~60–120s.
    floor: 12, ceiling: 40, seedTime: 64.7, timeStep: 2.1,
    scoreSequence: [37, 36, 35, 34, 33, 31, 30, 29, 27, 26, 24, 23, 21, 20, 18, 17, 16, 15, 14, 12],
  },
  'numerical-ops': {
    // correctPercentage = round(correctCount / 20 × 100), so every real value
    // is a multiple of 5. Top demo of 95% stays under a perfect 100%; the
    // roster trails to 35%. 20 questions × 20s timer + feedback → ~300–420s.
    floor: 35, ceiling: 100, seedTime: 312.4, timeStep: 4.3,
    scoreSequence: [95, 90, 90, 85, 85, 80, 75, 75, 70, 65, 65, 60, 55, 55, 50, 50, 45, 40, 40, 35],
  },
  'numerical-ops-easier': {
    // Same 20 questions and the same 0–100 percentage ceiling as Hard — smaller
    // numbers and times-table ×/÷ simply mean more of them land, so the band
    // sits higher.
    //
    // Times are far quicker than Hard's (~312s): an easier sum is answered in a
    // couple of seconds rather than run near the 20s timeout, so 20 questions
    // land in roughly 40–80s.
    //
    // Explicitly paired with the scores rather than stepped, because on this
    // game speed and accuracy trade off: the fastest rows on the board are
    // MID-TABLE — someone hammering the keypad finishes in 41s with 45–60%,
    // while a careful 95% takes 62s. A board where time rose neatly as score
    // fell would read as generated.
    floor: 45, ceiling: 100,
    scoreSequence: [95,   95,   90,   90,   85,   85,   80,   80,   75,   75,   70,   70,   65,   65,   60,   60,   55,   50,   50,   45],
    timeSequence:  [62.4, 71.8, 55.7, 68.3, 49.2, 74.6, 58.1, 66.9, 44.3, 79.5, 51.8, 63.7, 42.6, 76.2, 40.9, 69.4, 47.5, 43.8, 72.7, 41.2],
  },
  'dad': {
    // correctCount out of 15 (Directions and Distances), higher is better. Top
    // demo of 14 stays under a perfect 15; the roster trails to 4. No hard
    // timer — 15 reading-comprehension questions run ~120–300s.
    floor: 4, ceiling: 15, seedTime: 128.6, timeStep: 6.3,
    scoreSequence: [14, 13, 13, 12, 12, 11, 11, 11, 10, 10, 9, 9, 9, 8, 8, 7, 7, 6, 5, 4],
  },
  'sat': {
    // correctCount out of 18 (Situational Awareness Test), higher is better. Top
    // demo of 17 stays under a perfect 18; the roster trails to 5. Three
    // observe+recall situations (~18s observe + 6 questions each) → ~180–260s.
    floor: 5, ceiling: 18, seedTime: 204.6, timeStep: 5.4,
    scoreSequence: [17, 16, 16, 15, 15, 14, 14, 13, 12, 12, 11, 11, 10, 9, 9, 8, 8, 7, 6, 5],
  },
  'sat-easier': {
    // correctCount out of 10 (2 situations × 5 questions), higher is better. Top
    // demo of 9 stays under a perfect 10; the roster trails to 3. Half the run
    // length of Hard — two observe windows rather than three — so ~100–150s.
    floor: 3, ceiling: 10, seedTime: 112.4, timeStep: 3.1,
    scoreSequence: [9, 9, 9, 8, 8, 8, 8, 7, 7, 7, 6, 6, 6, 5, 5, 5, 4, 4, 3, 3],
  },
  'trace-2': {
    // correctCount out of 8 (watch-and-recall, one question per round), higher
    // is better. Top demo of 7 stays under a perfect 8; the roster trails to 2.
    // Narrow 2–7 band, so an explicit sequence keeps >5 distinct values. Eight
    // rounds of ~11s watch + answer → ~110–160s.
    floor: 2, ceiling: 8, seedTime: 118.4, timeStep: 3.6,
    scoreSequence: [7, 7, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2],
  },
  'cut': {
    // Cognitive Updating Test — accumulating totalScore (higher better), no fixed
    // ceiling. Points come from tasks handled on time (comms codes, sensor
    // activations, load releases, camera selects) minus warning-time bleed and
    // missed tasks over a 180s run; a strong run lands in the 500–680 band, the
    // roster trails to 120. CUT is a fixed-180s game so real runs all display
    // ~180s, but the time column is hidden (CBAT_LEADERBOARD_CONFIG hideTime) — a
    // small non-integer timeStep keeps the demo times non-uniform anyway.
    floor: 150, ceiling: 550, seedTime: 176.4, timeStep: 0.4,
    scoreSequence: [550, 530, 505, 480, 455, 430, 410, 390, 370, 350, 330, 310, 290, 270, 250, 230, 210, 190, 170, 150],
  },
  'cut-easier': {
    // Easier serves fewer scheduled tasks in the same 180s, so the achievable
    // total is lower even though the systems drift more slowly and the passive
    // in-tolerance trickle is unchanged. Band scaled to ~75% of Hard's.
    floor: 110, ceiling: 420, seedTime: 176.9, timeStep: 0.4,
    scoreSequence: [420, 400, 385, 365, 345, 330, 310, 295, 280, 265, 250, 235, 220, 205, 190, 175, 160, 145, 128, 110],
  },
  'rtt': {
    // Rapid Tracking Test — accumulating totalScore (higher better), no fixed
    // ceiling in the leaderboard's eyes, though a flawless run tops out at 1800
    // (12 passes × 3 dead-centre frames + completion bonuses). The demo ceiling
    // of 960 is a strong-but-human run: most frames captured, most of them off
    // centre, a couple of passes lost behind cover. Roster trails to 230.
    // 12 passes of ~8s plus gaps run ~115s; the time column is hidden
    // (CBAT_LEADERBOARD_CONFIG hideTime) but a small fractional step keeps the
    // stored times from all matching.
    //
    // Dropped ~8% from the original tuning when airframe drift went into the
    // game — the wander mostly costs centring bonus rather than hits. That is
    // an estimate: retune this and the grade bands in rttDifficulty.js together
    // once there are real runs to look at.
    //
    // DELIBERATELY NOT round numbers. The multiple-of-5 sequences elsewhere in
    // this file exist because those games can only PRODUCE multiples of 5 (ANT
    // awards 10/5/0, FLAG's awards are all multiples of 5) — there, a demo
    // score of 63 would be impossible and look fabricated. RTT is the opposite:
    // a frame pays 20 plus a centring bonus of `round(20 × howCentred)`, so a
    // real total is an arbitrary integer, and a board where every score happens
    // to end in 0 or 5 is itself the tell.
    floor: 230, ceiling: 960, seedTime: 114.8, timeStep: 0.3,
    scoreSequence: [958, 921, 884, 852, 813, 779, 748, 711, 679, 641, 608, 572, 539, 504, 468, 431, 396, 357, 312, 264],
  },
  'rtt-easier': {
    // Eight passes instead of twelve, so the achievable total is two thirds of
    // Hard's (1200 for a perfect run) — the demo band scales with it rather
    // than sitting higher because the game is easier. Arbitrary integers for
    // the same reason as Hard's, above.
    floor: 175, ceiling: 675, seedTime: 80.6, timeStep: 0.3,
    scoreSequence: [673, 644, 621, 592, 571, 538, 517, 489, 466, 438, 412, 387, 361, 338, 309, 283, 261, 233, 209, 181],
  },

  // ── The five tests added to complete the RAF roster ─────────────────────────
  // SIT / SLT / VLT all keep the SAME question count on both difficulties (8,
  // 10 and 8 respectively), so each pair shares a ceiling and Easier's demo band
  // simply sits a little higher. Explicit sequences rather than the stepped
  // generator: these bands are narrow enough that the generator's `+2` steps can
  // skip a value and drop the board below the 6-distinct-scores invariant.
  'sit': {
    // 8 rounds, one point each. Rotating a studied layout to match a two-second
    // clip is genuinely hard, so the top demo sits at 7 rather than 8 and the
    // roster trails well down. ~18s a round → ~145s.
    floor: 2, ceiling: 8, seedTime: 138.6, timeStep: 4.2,
    scoreSequence: [7, 7, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2],
  },
  'sit-easier': {
    // Two object classes instead of four and a four-second clip, so the same 8
    // rounds land more often. Longer runs, because the study and clip windows
    // are what got lengthened.
    floor: 2, ceiling: 8, seedTime: 168.3, timeStep: 4.6,
    scoreSequence: [7, 7, 7, 6, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 2, 2],
  },
  'slt': {
    // 10 questions. It's a search-and-apply task with the tabs still open, so
    // scores run higher than a memory test would — the bottleneck is finding the
    // right tab inside the clock. 60s reading + 10 × ~30s ≈ 360s.
    floor: 2, ceiling: 10, seedTime: 288.4, timeStep: 8.7,
    scoreSequence: [9, 9, 8, 8, 8, 7, 7, 7, 6, 6, 6, 5, 5, 5, 4, 4, 4, 3, 3, 2],
  },
  'slt-easier': {
    // Four tabs and no two-tab joins, so the search is shorter and the band
    // moves up. Longer reading window, so the runs aren't quicker.
    floor: 3, ceiling: 10, seedTime: 262.6, timeStep: 7.9,
    scoreSequence: [9, 9, 9, 8, 8, 8, 8, 7, 7, 7, 7, 6, 6, 6, 5, 5, 5, 4, 4, 3],
  },
  // Both VLT boards were re-timed on 2026-08-15 against the real runs. The
  // original tuning budgeted "180s reading + 8 × ~50s ≈ 580s" and was about 3x
  // every run players actually posted, for two reasons:
  //
  //   1. The reading window is NOT in totalTime. CbatTabbedReasoning only adds
  //      up per-question elapsed time (see recordAnswer), so the 180s study
  //      phase — and the feedback pause between questions — costs nothing on
  //      the clock. Counting it double-charged the board by three minutes.
  //   2. Nobody spends 50s on a question. The clock allows 180s, but a player
  //      who has read the tabs knows which two to join; real avg/question ran
  //      10s, 12s, 19s and 30s.
  //
  // Scores are untouched — those bands are about the distractor, not the clock.
  'vlt': {
    // 8 questions, each needing two sections joined. Scores below SLT's share
    // because the plainly-stated sentence is a deliberate distractor.
    //
    // Times here are an ESTIMATE — no Hard run has been posted yet. Taken as
    // Easier's band × ~1.35, which is the extra searching eight tabs costs over
    // five on the same eight questions. ~15s a question at the top of the board
    // to ~42s at the foot. Retune against real runs when there are some.
    floor: 2, ceiling: 8, seedTime: 118.7, timeStep: 8.6,
    scoreSequence: [7, 7, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2],
  },
  'vlt-easier': {
    // Band runs 88.4s → 248.4s, which brackets the real spread (83.1s to
    // 237.4s) and works out at ~11s a question at the top to ~31s at the foot —
    // the same range the real avg/question covers. The quickest real run still
    // tops the board, which is the point: the demo field is competitive, not
    // unbeatable.
    floor: 2, ceiling: 8, seedTime: 88.4, timeStep: 6.4,
    scoreSequence: [7, 7, 7, 6, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 2, 2],
  },
  // Both MATF boards were lowered by about a third on 2026-08-13. The first cut
  // put the top row above the game's own Outstanding threshold (34 against 32 on
  // Hard, 42 against 40 on Easier), which is the wrong way round: the demo board
  // is the field a new player is measured against, not the record. It also
  // assumed a pace nobody sustains. Part two is a three-step lookup — pick the
  // air-speed table, find the row, find the angle column — so a 90-second part
  // yields single figures, and part one's ±17 grid is not the instant scan it
  // looks like. The bands now top out at a strong run rather than an
  // exceptional one, and the grade thresholds in src/utils/cbat/matfDifficulty.js
  // are untouched, so a player who beats this board is properly Good.
  'matf': {
    // Speeded, so there's no ceiling — a better player answers more inside the
    // same two 90-second parts. Both parts always run their full clock, so the
    // times barely vary (the same shape as `instruments`), and timeStep stays
    // fractional only so the rounded display isn't twenty identical .0s.
    //
    // Repeated values in the sequence are deliberate: on a speeded count in the
    // teens, two players landing the same total is what a real board looks like.
    floor: 5, ceiling: 26, seedTime: 180.4, timeStep: 0.1,
    scoreSequence: [22, 21, 20, 19, 19, 18, 17, 16, 16, 15, 14, 13, 13, 12, 11, 10, 9, 8, 7, 5],
  },
  'matf-easier': {
    // A ±8 grid instead of ±17, a smaller wind sheet, and 110s a part, so more
    // answers land AND the run is longer. Both moves push the count up, and the
    // gap to Hard stays roughly what it was before the retune.
    floor: 7, ceiling: 33, seedTime: 220.3, timeStep: 0.1,
    scoreSequence: [28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 10, 9, 7],
  },
  'vigilance': {
    // Accumulating score over a fixed 180s, so no ceiling and near-identical
    // times. One difficulty only — see backend/models/GameSessionCbatVigilanceResult.js.
    floor: 250, ceiling: 800, seedTime: 180.2, timeStep: 0.1,
    scoreSequence: [780, 745, 715, 690, 660, 635, 610, 585, 560, 535, 510, 485, 455, 430, 405, 375, 350, 320, 290, 255],
  },

  // ── Sensory Motor Apparatus Test ────────────────────────────────────────────
  // Accumulating totalScore over a fixed clock, so no ceiling on the board even
  // though a flawless run tops out at 600 (10 points per scored second × 60).
  // Flawless means the dot pinned exactly on the crosshair the whole way, which
  // the drift makes impossible — the demo ceiling of 418 is a strong human run
  // holding roughly two thirds of full accuracy, and the roster trails to 119.
  //
  // Every run reports the same totalTime (60 scored seconds plus the 2.5s
  // lead-in = 62.5), so the fakes use it exactly with timeStep 0, the way
  // FLAG's fixed-60s rows do. The column is hidden on this board anyway.
  //
  // Arbitrary integers rather than multiples of five, for RTT's reason: the
  // score is an integral of a continuous accuracy value, so a real total is any
  // integer at all and a board of round numbers would be the tell.
  //
  // Estimated, not measured — nobody has flown this with a stick. Retune this
  // and the grade bands in smaDifficulty.js together once there are real runs.
  'sma': {
    floor: 98, ceiling: 419, seedTime: 62.5, timeStep: 0,
    scoreSequence: [418, 402, 387, 371, 357, 342, 328, 315, 300, 286, 271, 256, 243, 228, 213, 198, 180, 163, 143, 119],
  },
  'sma-easier': {
    // 30 scored seconds instead of 60 (a 300 ceiling) AND a tolerance ring half
    // again as wide, which pays more per second for the same tracking. The two
    // effects pull opposite ways, so the band lands at a HIGHER share of its own
    // max than Hard's does while still totalling less.
    floor: 56, ceiling: 223, seedTime: 32.5, timeStep: 0,
    scoreSequence: [222, 214, 206, 199, 191, 183, 176, 169, 161, 154, 146, 138, 130, 122, 115, 107, 98, 87, 74, 61],
  },
};

// Fixed delta tables — natural-looking variance without randomness.
const SCORE_STEPS = [1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1];
const TIME_STEPS  = [1, 1, 2, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1];

function generateFakes(gameKey, count, { lowerBetter, tuning, isAdmin }) {
  const offset = GAME_OFFSET[gameKey] ?? 0;
  const fakes = [];
  let runScore = tuning.seedScore;
  let runTime = tuning.seedTime;
  for (let i = 0; i < count; i++) {
    // If the game defines an explicit score sequence (e.g. ANT's multiples
    // of 5), use it directly. Otherwise walk from seedScore with deltas.
    if (tuning.scoreSequence) {
      runScore = tuning.scoreSequence[i % tuning.scoreSequence.length];
    } else if (i > 0) {
      const scoreDelta = SCORE_STEPS[i % SCORE_STEPS.length] * tuning.scoreStep;
      runScore = lowerBetter
        ? Math.min(runScore + scoreDelta, tuning.ceiling)
        : Math.max(runScore - scoreDelta, tuning.floor);
    }
    // An explicit time sequence (paired row-for-row with scoreSequence) wins;
    // otherwise walk up from seedTime with the step deltas.
    if (tuning.timeSequence) {
      runTime = tuning.timeSequence[i % tuning.timeSequence.length];
    } else if (i > 0) {
      const timeDelta = TIME_STEPS[i % TIME_STEPS.length] * tuning.timeStep;
      runTime += timeDelta;
    }
    const entry = {
      _id: `fake-${gameKey}-${i}`,
      userId: `fake-user-${gameKey}-${i}`,
      agentNumber: FAKE_AGENTS[(offset + i) % FAKE_AGENTS.length],
      bestScore: runScore,
      bestTime: Number(runTime.toFixed(1)),
      isFake: true,
    };
    if (isAdmin) entry.email = 'demo';
    fakes.push(entry);
  }
  return fakes;
}

// ANT, code-duplicates, flag, and cut: always generate the full demo sequence
// so the visible top 20 keeps a per-game min-score floor (15 for ANT, 7 for
// code-duplicates, 55 for flag, 150 for cut) even when real entries with
// sub-floor scores exist — including when the real pool is already at/above the
// 20-row limit. A real run below the lowest demo is displaced off the board
// until it beats that floor. Other games keep gap-fill padding
// (limit - real.length) and short-circuit when real already fills the board.
const FULL_SEQUENCE_GAMES = new Set(['ant', 'code-duplicates', 'flag', 'flag-easier', 'cut']);

function padLeaderboard(real, gameKey, { limit = 20, isAdmin = false } = {}) {
  const cfg = CBAT_GAMES[gameKey];
  const tuning = FAKE_TUNING[gameKey];

  // No tuning for this game → just rank real entries as-is.
  if (!cfg || !tuning) {
    real.forEach((e, i) => { e.rank = i + 1; });
    return real;
  }

  const isFullSequence = FULL_SEQUENCE_GAMES.has(gameKey);

  // Non-full-sequence games short-circuit when real already fills the board.
  // Full-sequence games always run the merge so the floor displaces sub-floor
  // real entries even when there are 20+ of them.
  if (!isFullSequence && real.length >= limit) {
    real.forEach((e, i) => { e.rank = i + 1; });
    return real;
  }

  const lowerBetter = cfg.sortDir === 1;
  const needed = isFullSequence ? tuning.scoreSequence.length : (limit - real.length);
  const fakes = generateFakes(gameKey, needed, { lowerBetter, tuning, isAdmin });

  // Merge real + fakes, then sort by points-priority, time-on-ties.
  const merged = [...real, ...fakes].sort((a, b) => {
    if (a.bestScore !== b.bestScore) {
      return lowerBetter ? a.bestScore - b.bestScore : b.bestScore - a.bestScore;
    }
    return a.bestTime - b.bestTime;
  });

  const trimmed = merged.slice(0, limit);
  trimmed.forEach((e, i) => { e.rank = i + 1; });
  return trimmed;
}

// ── Weekly leaderboard demo padding ──────────────────────────────────────────
// The weekly board sums points earned since Monday, so demo rows must look like
// a few real players who've each played only a couple of games this week —
// modest weekTotals built from a low play count, NOT single big all-time scores.
//
// WEEKLY_PER_PLAY is a typical "decent single run" value per game, in the same
// space as that game's weekly total: primaryField points for higher-is-better
// games, and derived weeklyExpr points for the lower-is-better trace games.
// EVERY leaderboard game has an entry so no weekly board is ever left with just
// 0–1 real players — sparse weeks always get a few demo rows (unlike the
// all-time board, which leaves some games real-only). Values sit a little below
// the real median single run (queried from production) so engaged real players
// can still outrank the demos.
const WEEKLY_PER_PLAY = {
  'plane-turn-2d':   150,  // derived points space (≈ real median run, see cfg.weeklyExpr)
  'plane-turn-3d':   165,
  'angles':           14,  // real med 16
  'code-duplicates':  11,  // real med 12
  'symbols':          13,  // real med 15
  'target':          520,  // real med 602
  'instruments':       4,  // real med 3
  'ant':              45,  // real med 50
  'visualisation-2d':  4,  // real med 3
  'visualisation-3d':  4,  // real med 4
  'flag':            220,  // real med 246
  // Easier serves fewer maths questions, fewer callsign prompts and fewer
  // ringed contacts in the same 60s, so a decent run scores below a decent
  // hard one.
  'flag-easier':     170,
  'dpt':            3400,  // real med 3850
  'act':            1300,  // real med 1482
  'trace-1':          26,  // real med 29 (correctTurns /40)
  'trace-2':           5,  // correctCount /8 — a little below a decent single run
  'numerical-ops':    80,  // real med 90 (correctPercentage)
  // Smaller numbers and times-table ×/÷, so a decent run scores above a decent
  // hard one on the same 0–100 scale.
  'numerical-ops-easier': 85,
  'dad':               9,  // correctCount /15 — a little below a decent single run
  'sat':              11,  // correctCount /18 — a little below a decent single run
  'sat-easier':        6,  // correctCount /10 — same idea on the shorter run
  'cut':             350,  // accumulating totalScore — a little below a decent single run
  'cut-easier':      260,  // fewer scheduled tasks in the same 180s
  'rtt':             645,  // accumulating totalScore — a little below a decent single run
  'rtt-easier':      460,  // eight passes instead of twelve, so a lower total
  'sit':               4,  // correctCount /6 — a little below a decent single run
  'sit-easier':        3,  // correctCount /4 — same idea on the shorter run
  'slt':               7,  // correctCount /10
  'slt-easier':        6,  // correctCount /8, but single-hop, so a higher share
  'vlt':               5,  // correctCount /8
  'vlt-easier':        4,  // correctCount /6
  'matf':             22,  // speeded correctCount — no ceiling, so this is a rate
  'matf-easier':      28,  // smaller grid, longer clock, so more answers land
  'vigilance':       540,  // accumulating totalScore over the fixed 180s
  'sma':             280,  // accumulating totalScore over 60 scored seconds (max 600)
  'sma-easier':      155,  // 30 scored seconds, but a wider ring pays more per second
};

// Six deterministic demo players: a couple of active ones, the rest light.
// plays + factor are paired by index; factor varies the per-play average so
// totals aren't exact multiples and the ordering looks organic.
const WEEKLY_PLAYS   = [3, 2, 2, 1, 3, 1];
const WEEKLY_FACTORS = [1.18, 1.05, 0.96, 0.88, 0.78, 0.70];

// Below this many real weekly entries the board counts as "sparse" and gets
// topped up with demo rows; at or above it the week is busy enough to stand on
// its own (and we don't risk demo rows displacing real players).
const WEEKLY_SPARSE_THRESHOLD = 8;

function generateWeeklyFakes(gameKey, perPlay, isAdmin) {
  const offset = GAME_OFFSET[gameKey] ?? 0;
  const fakes = [];
  for (let i = 0; i < WEEKLY_PLAYS.length; i++) {
    const plays = WEEKLY_PLAYS[i];
    const entry = {
      _id: `fake-weekly-${gameKey}-${i}`,
      userId: `fake-weekly-user-${gameKey}-${i}`,
      agentNumber: FAKE_AGENTS[(offset + i) % FAKE_AGENTS.length],
      weekTotal: Math.round(perPlay * plays * WEEKLY_FACTORS[i]),
      plays,
      isFake: true,
    };
    if (isAdmin) entry.email = 'demo';
    fakes.push(entry);
  }
  return fakes;
}

// Pad a weekly leaderboard (already sorted weekTotal-desc) with demo rows when
// the week is sparse, then resort and assign ranks. Demo rows can interleave
// with — or, for very low-activity real entries, outrank — real ones, exactly
// like the all-time padder.
function padWeeklyLeaderboard(real, gameKey, { limit = 20, isAdmin = false } = {}) {
  const perPlay = WEEKLY_PER_PLAY[gameKey];

  // No demo tuning, board already full, or week busy enough → real only.
  if (perPlay == null || real.length >= limit || real.length >= WEEKLY_SPARSE_THRESHOLD) {
    real.forEach((e, i) => { e.rank = i + 1; });
    return real;
  }

  const fakes = generateWeeklyFakes(gameKey, perPlay, isAdmin);
  const merged = [...real, ...fakes].sort((a, b) => {
    if (a.weekTotal !== b.weekTotal) return b.weekTotal - a.weekTotal;
    return (b.plays || 0) - (a.plays || 0);
  });
  const trimmed = merged.slice(0, limit);
  trimmed.forEach((e, i) => { e.rank = i + 1; });
  return trimmed;
}

module.exports = { padLeaderboard, padWeeklyLeaderboard, FAKE_AGENTS, FAKE_TUNING, WEEKLY_PER_PLAY };
