// The Aptitude Report — an estimate of what a user's SkyWatch play would score on a real OASC
// battery, and what to practise next to move it.
//
// The chain, mirroring the real "Aptitude Scores" sheet exactly:
//
//   recent form on a game  →  test stanine (1-9)
//   tests in a domain      →  domain stanine   (multiplier-weighted mean)
//   domains in a battery   →  score out of 180 (weight-weighted mean × 20)
//   score vs the battery's cutoff  →  pass / fail
//
// Two decisions worth stating up front, because they're what make the number honest:
//
// FORM, NOT BEST-EVER. A test stanine comes from the mean of the user's last FORM_WINDOW runs, not
// their personal best. The real CBAT is one sitting on one morning; a best-ever taken from fifty
// attempts is not what you'd walk in and reproduce. Best-ever also only ever climbs, so a report
// built on it could never tell a user they'd gone off the boil. This is the same window and the
// same reasoning as the recent-form percentile in routes/games.js.
//
// COVERAGE IS REPORTED, NOT PAPERED OVER. The roster now covers all but two tests — GSPA and RCOG,
// which between them appear on three roles — and a user may simply not have played the games we do
// have. Either way the test is excluded and
// the domain is scored on what's left; a domain with nothing left is excluded entirely and the
// battery score is renormalised over the weight that remains. `coverage` reports the share of the
// battery's weight the estimate actually rests on, so a 62%-covered score can be read for what it
// is. Silently treating an unmeasured test as average would invent data.

const mongoose = require('mongoose');
const { CBAT_GAMES } = require('../constants/cbatGames');
const { MAX_SCORE, MAX_STANINE, MIN_COVERAGE_FOR_VERDICT, DOMAINS, TESTS, BATTERY_BY_KEY, SCORED_GAME_KEYS } = require('../constants/cbatBatteries');
const { scoreToStanine, scoreForStanine } = require('./cbatStanine');

// Matches the recent-form window used by the leaderboard percentile, for the reasons given there:
// one bad run shouldn't tank the estimate, and a lifetime average would permanently drag in a
// user's worst early runs — punishing the very improvement the report exists to show.
const FORM_WINDOW = 3;
// Below this, a game's average is noise and the test is reported as "needs more runs" rather than
// scored. It doubles as the report's core call to action. It is equal to FORM_WINDOW, so a scored
// test is always averaging a full window — never one or two runs standing in for three.
const FORM_MIN_RUNS = 3;

// Only Hard counts. The real CBAT has one difficulty, so folding an Easier run into the estimate
// would inflate it — and Easier collections are separate registry keys anyway (`cut-easier` et al),
// so this is simply a matter of never looking them up. The report says so where a user has Easier
// runs but no Hard ones.
const EASIER_SUFFIX = '-easier';

// ── Form ─────────────────────────────────────────────────────────────────────────────────────
// One query per scorable game, run in parallel: the user's most recent FORM_WINDOW finished runs.
// Every result model carries the { userId: 1, createdAt: -1 } index this sorts on.
async function loadForm(userId, gameKeys = SCORED_GAME_KEYS) {
  const entries = await Promise.all(gameKeys.map(async (gameKey) => {
    const cfg = CBAT_GAMES[gameKey];
    if (!cfg) return [gameKey, null];

    const query = { ...(cfg.modeFilter ?? {}), userId };
    const recent = await cfg.Model.find(query)
      .select(`${cfg.primaryField} createdAt`)
      .sort({ createdAt: -1 })
      .limit(FORM_WINDOW)
      .lean();

    if (!recent.length) {
      // Distinguish "never touched this game" from "only ever played it on Easier", so the report
      // can tell the second group why their runs aren't counting.
      const easierCfg = CBAT_GAMES[`${gameKey}${EASIER_SUFFIX}`];
      const easierOnly = easierCfg
        ? await easierCfg.Model.exists({ ...(easierCfg.modeFilter ?? {}), userId }).then(Boolean)
        : false;
      return [gameKey, { runs: 0, form: null, easierOnly, lastPlayedAt: null }];
    }

    const scores = recent.map(r => r[cfg.primaryField]).filter(Number.isFinite);
    return [gameKey, {
      runs: scores.length,
      form: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      easierOnly: false,
      lastPlayedAt: recent[0].createdAt,
    }];
  }));

  return Object.fromEntries(entries);
}

// The same form, for many users at once. One aggregation per scorable game — 15 round trips total
// however many users are asked for — instead of loadForm's per-user query fan-out, which at 25
// users would be 375.
//
// $push then $slice takes each user's most recent FORM_WINDOW runs in a single group, the same
// trick the leaderboard's recent-form percentile uses, and it rides the same
// { userId: 1, createdAt: -1 } index.
//
// One deliberate difference from loadForm: `easierOnly` is always false here. Establishing it costs
// an extra existence check per user per game, and it changes only the WORDING of an unscored test
// ("Easier runs don't count" vs "3 more runs"), never a stanine or a score. Callers that render
// that wording must use loadForm; callers that only need numbers can use this.
async function loadFormForUsers(userIds, gameKeys = SCORED_GAME_KEYS) {
  const byUser = Object.fromEntries(userIds.map(id => [String(id), {}]));

  await Promise.all(gameKeys.map(async (gameKey) => {
    const cfg = CBAT_GAMES[gameKey];
    if (!cfg) return;

    const rows = await cfg.Model.aggregate([
      { $match: { ...(cfg.modeFilter ?? {}), userId: { $in: userIds } } },
      { $sort: { userId: 1, createdAt: -1 } },
      { $group: { _id: '$userId', scores: { $push: `$${cfg.primaryField}` } } },
      { $project: { recent: { $slice: ['$scores', FORM_WINDOW] } } },
    ]);

    for (const row of rows) {
      const scores = row.recent.filter(Number.isFinite);
      if (!byUser[String(row._id)]) continue;
      byUser[String(row._id)][gameKey] = {
        runs: scores.length,
        form: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
        easierOnly: false,
        lastPlayedAt: null,
      };
    }
  }));

  return byUser;
}

// ── Per-test scoring ─────────────────────────────────────────────────────────────────────────
// A test's stanine is the mean of the stanines of whichever of its games the user has enough runs
// on. VISS is the only test today backed by two games (Visualisation 2D and 3D); a user who has
// played only one is scored on that one rather than blocked for missing the other.
//
// Returns a row for EVERY test in the battery, scored or not — the report's gap list and its
// "play three runs of X" prompts are both built from the unscored ones, so they can't be dropped.
function scoreTest(code, form) {
  const test = TESTS[code];
  const base = { code, label: test.label, match: test.match, games: test.games };

  if (!test.games.length) {
    return { ...base, stanine: null, state: 'no-game' };   // SkyWatch has no game for this test
  }

  const played = [];
  const needsRuns = [];
  let easierOnly = false;

  for (const gameKey of test.games) {
    const f = form[gameKey];
    if (!f) continue;
    if (f.easierOnly) easierOnly = true;
    if (f.runs >= FORM_MIN_RUNS) {
      played.push({
        gameKey,
        label: CBAT_GAMES[gameKey]?.label ?? gameKey,
        form: Number(f.form.toFixed(1)),
        runs: f.runs,
        stanine: scoreToStanine(gameKey, f.form),
        lastPlayedAt: f.lastPlayedAt,
      });
    } else {
      needsRuns.push({
        gameKey,
        label: CBAT_GAMES[gameKey]?.label ?? gameKey,
        runs: f.runs,
        runsNeeded: FORM_MIN_RUNS - f.runs,
      });
    }
  }

  if (!played.length) {
    return {
      ...base,
      stanine: null,
      state: easierOnly ? 'easier-only' : 'needs-runs',
      needsRuns,
    };
  }

  const stanine = played.reduce((a, p) => a + p.stanine, 0) / played.length;
  // The score to beat for the next stanine up, on whichever of the test's games is furthest along.
  // Null at 9 — there is nothing above it.
  const lead = played.reduce((a, b) => (b.stanine > a.stanine ? b : a));
  const nextTarget = lead.stanine < MAX_STANINE
    ? { gameKey: lead.gameKey, stanine: lead.stanine + 1, score: scoreForStanine(lead.gameKey, lead.stanine + 1) }
    : null;

  return { ...base, stanine, state: 'scored', played, needsRuns, nextTarget };
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────
// `form` is passed in rather than loaded here so a caller building several batteries at once (the
// role picker, which shows an estimate against all thirteen) pays for one set of queries, not
// thirteen.
function buildBatteryReport(battery, form) {
  const domains = battery.domains.map((d) => {
    const tests = d.tests.map(t => ({ ...scoreTest(t.code, form), mult: t.mult }));

    const scored = tests.filter(t => t.state === 'scored');
    const totalMult = tests.reduce((a, t) => a + t.mult, 0);
    const scoredMult = scored.reduce((a, t) => a + t.mult, 0);

    // Multiplier-weighted mean over the tests we could score. A domain where nothing is scorable
    // gets a null stanine and drops out of the battery total below.
    const stanine = scoredMult
      ? scored.reduce((a, t) => a + t.stanine * t.mult, 0) / scoredMult
      : null;

    return {
      key: d.key,
      label: DOMAINS[d.key].label,
      blurb: DOMAINS[d.key].blurb,
      weight: d.weight,
      stanine: stanine === null ? null : Number(stanine.toFixed(2)),
      // Share of this domain's own tests that fed the stanine — the caveat on the domain row.
      coverage: totalMult ? Math.round((scoredMult / totalMult) * 100) : 0,
      tests,
    };
  });

  // Renormalise over the weight actually measured, so a partially covered battery reports the
  // score implied by what we know rather than one dragged down by what we don't.
  const measured = domains.filter(d => d.stanine !== null);
  const measuredWeight = measured.reduce((a, d) => a + d.weight, 0);
  const totalWeight = domains.reduce((a, d) => a + d.weight, 0);

  const score = measuredWeight
    ? Math.round((measured.reduce((a, d) => a + d.stanine * d.weight, 0) / measuredWeight) * (MAX_SCORE / MAX_STANINE))
    : null;

  // Weight-share of the battery the estimate rests on. Both legs matter: a domain can be fully
  // weighted in but only half its tests scored, so this walks tests rather than domains.
  const coveredWeight = domains.reduce((a, d) => a + (d.weight * d.coverage) / 100, 0);
  const coverage = totalWeight ? Math.round((coveredWeight / totalWeight) * 100) : 0;

  return {
    key: battery.key,
    label: battery.label,
    group: battery.group,
    note: battery.note ?? null,
    cutoff: battery.cutoff,
    maxScore: MAX_SCORE,
    score,
    // Signed distance from the cutoff — the number the UI leads with ("+28 clear" / "14 short").
    margin: score === null ? null : score - battery.cutoff,
    // 'provisional' is the guard on renormalisation. Dividing by measured weight is right at 90%
    // coverage and actively misleading at 16%: the score stays confident-looking while the evidence
    // behind it collapses, so a player who has touched two games gets told they are PASSING.
    //
    // The score is still returned, because it is the honest arithmetic on what we know and it gives
    // a new player something to watch move. It just isn't a verdict, and nothing downstream may
    // render it as one — `rolesPassed` counts 'pass' only, so a provisional battery is not claimed
    // as cleared either.
    status: score === null
      ? 'unscored'
      : coverage < MIN_COVERAGE_FOR_VERDICT
        ? 'provisional'
        : score >= battery.cutoff ? 'pass' : 'fail',
    coverage,
    domains,
    focus: buildFocus(domains, measuredWeight, coverage),
  };
}

// ── "What should I work on?" ─────────────────────────────────────────────────────────────────
// The ranked answer to the only question a report has to earn: what do I play tonight. Two kinds
// of row come back, and each is priced in the currency that is true for it.
//
// 'improve' — a scored test, priced in SCORE POINTS: what the battery score does if the user
//             gains one stanine on it.
//
//               gain = (domainWeight / measuredWeight) × (testMult / domainScoredMult) × 20
//
//             measuredWeight — not 100 — is the denominator because that's the base the score is
//             renormalised over, so the figure is what the user would actually see the number do.
//             That marginal value is the whole reason a report beats a leaderboard: on Control
//             Officer (ATC), one stanine of CUT is worth roughly five times one stanine of ACT.
//
// 'unlock'  — a game played fewer than three times, so it isn't counting yet. Priced in COVERAGE:
//             the share of the battery's weight the test would ADD to what we can measure.
//
// UNLOCKS ARE NOT PRICED IN POINTS, for two reasons, and this used to be wrong in both directions.
//
// The first is arithmetic. An unlock in a domain with nothing else scored doesn't just add to the
// top of the battery's fraction — the domain isn't in `measuredWeight` at all, so playing it adds
// the domain's whole weight to the BOTTOM and dilutes everything already measured. Pricing it as
// a share of the current base reported a gain for a play that can move the score DOWN: on WSOP
// (Air Signaller, Linguist), a user averaging stanine 5.7 across the 80 weight they had measured
// was told the Verbal Logic Test was worth +5, when three median runs would in fact take them
// from 114 to 111. `gain` is now the honest difference between the score now and the score after,
// and it can be negative. It is still returned, because it is a true number and the admin view
// reads it, but nothing ranks or renders it.
//
// The second is that the number is a guess whichever way it is computed. An unlock's points rest
// on ASSUMED_UNLOCK_STANINE — a run we have never seen — while its coverage figure is a
// certainty. Ranking a certainty against a guess is how FLAG ended up above the one test standing
// between a user and a verdict.
//
// WHICH BLOCK LEADS is the whole product decision here, and it turns on MIN_COVERAGE_FOR_VERDICT.
// Below that floor the battery reports 'provisional': there is no pass or fail, and no amount of
// improving a measured test will produce one. Coverage is the objective, so every unlock outranks
// every improve. At or above the floor the verdict exists and the only thing left to move is the
// number, so improvements lead and the leftover unlocks follow.
//
// Tests with no SkyWatch game at all are gaps, not focus items — they're reported separately and
// never appear here, because "work on RCOG" is advice a user cannot act on.
//
// A BATTERY WITH NOTHING MEASURED STILL GETS A LIST. With no scored test there is no base and a
// points figure is undefined, so `gain` comes back null — but that is exactly the user who most
// needs telling what to play, and returning [] left the newest player with no advice at all.
// Every row there is an unlock ranked on coverage, which is what the /cbat card leads with anyway.
const FOCUS_LIMIT = 5;

// The stanine an unplayed test is assumed to land on, for the one number that has to guess at one.
// 5 is the middle of the 1-9 scale and the honest expectation for a run we have not seen.
const ASSUMED_UNLOCK_STANINE = 5;

function buildFocus(domains, measuredWeight, coverage) {
  const out = [];

  // The battery's current numerator and score, so an unlock can be priced as the difference
  // between the score now and the score after — the only honest way to price a play that changes
  // the denominator as well as the top of the fraction.
  const stanineWeight = domains.reduce((a, d) => a + (d.stanine === null ? 0 : d.stanine * d.weight), 0);
  const currentScore = measuredWeight ? (stanineWeight / measuredWeight) * (MAX_SCORE / MAX_STANINE) : null;

  for (const d of domains) {
    const scored = d.tests.filter(t => t.state === 'scored');
    const scoredMult = scored.reduce((a, t) => a + t.mult, 0);
    // The domain's whole multiplier pool, no-game tests included — the same denominator the
    // domain's reported `coverage` uses, so a row's coverageGain and the headline agree.
    const totalMult = d.tests.reduce((a, t) => a + t.mult, 0);

    for (const t of scored) {
      if (t.stanine >= MAX_STANINE) continue;   // already topped out
      out.push({
        kind: 'improve',
        code: t.code, label: t.label, match: t.match,
        domainKey: d.key, domainLabel: d.label, domainWeight: d.weight,
        stanine: t.stanine,
        nextTarget: t.nextTarget,
        gain: measuredWeight ? (d.weight / measuredWeight) * (t.mult / scoredMult) * (MAX_SCORE / MAX_STANINE) : null,
        coverageGain: 0,   // already counted; improving it measures nothing new
      });
    }

    for (const t of d.tests) {
      if (t.state !== 'needs-runs' && t.state !== 'easier-only') continue;
      // A domain with nothing scored is not in `measuredWeight`, so this play brings the domain's
      // whole weight into the base rather than joining a base it is already part of. Both cases
      // are the same subtraction once the new base is worked out properly.
      const opensDomain = scoredMult === 0;
      const newDomainStanine =
        ((opensDomain ? 0 : d.stanine * scoredMult) + ASSUMED_UNLOCK_STANINE * t.mult) / (scoredMult + t.mult);
      const newWeight = measuredWeight + (opensDomain ? d.weight : 0);
      const newStanineWeight =
        stanineWeight - (opensDomain ? 0 : d.stanine * d.weight) + newDomainStanine * d.weight;

      out.push({
        kind: 'unlock',
        code: t.code, label: t.label, match: t.match,
        domainKey: d.key, domainLabel: d.label, domainWeight: d.weight,
        stanine: null,
        needsRuns: t.needsRuns ?? [],
        easierOnly: t.state === 'easier-only',
        // True where this play would put a domain of the role on the report for the first time.
        // Those are the rows the score cannot currently see at all.
        opensDomain,
        gain: measuredWeight ? (newStanineWeight / newWeight) * (MAX_SCORE / MAX_STANINE) - currentScore : null,
        coverageGain: totalMult ? (d.weight * t.mult) / totalMult : 0,
      });
    }
  }

  // Coverage first while the score cannot be judged, points first once it can. Within a block
  // every row is the same kind and so ranked on the same figure it displays — the order always
  // matches the numbers beside it.
  const unlocksLead = coverage < MIN_COVERAGE_FOR_VERDICT;
  const block = f => ((f.kind === 'unlock') === unlocksLead ? 0 : 1);
  const rank = f => (f.kind === 'unlock' ? f.coverageGain : f.gain);

  return out
    .sort((a, b) => block(a) - block(b) || rank(b) - rank(a))
    .slice(0, FOCUS_LIMIT)
    .map(f => ({
      ...f,
      gain: f.gain === null ? null : Number(f.gain.toFixed(1)),
      coverageGain: Number(f.coverageGain.toFixed(1)),
    }));
}

// Tests in a battery that SkyWatch has no game for — the honest footnote under every score, and
// the product's own roadmap. Deduplicated by code: FLAG appears in one domain, but TRT can appear
// in two and shouldn't be listed twice.
function buildGaps(battery) {
  const seen = new Map();
  for (const d of battery.domains) {
    for (const t of d.tests) {
      if (TESTS[t.code].games.length) continue;
      if (!seen.has(t.code)) seen.set(t.code, { code: t.code, label: TESTS[t.code].label, domains: [] });
      seen.get(t.code).domains.push(DOMAINS[d.key].label);
    }
  }
  return [...seen.values()];
}

// Every battery scored against one load of the user's form — the role picker's list, and the
// "roles you'd currently pass" summary. Trimmed to the headline fields; the full domain breakdown
// is only built for the battery actually being viewed.
//
// `targetKey` buys one extra thing for the /cbat card: the single highest-value next play for the
// role the user is aiming at. Every battery's focus list is computed here already, so this is a
// pick rather than more work, and it saves the card either fetching the full report (thirteen
// domains of detail to render one sentence) or inventing its own advice.
async function buildAllBatteryScores(userId, targetKey = null) {
  const form = await loadForm(userId);
  let targetFocus = null;
  const batteries = Object.values(BATTERY_BY_KEY).map((b) => {
    const report = buildBatteryReport(b, form);
    const { key, label, group, cutoff, score, margin, status, coverage } = report;
    if (targetKey && key === targetKey) targetFocus = topFocus(report);
    return { key, label, group, cutoff, maxScore: MAX_SCORE, score, margin, status, coverage };
  });
  const target = targetKey ? BATTERY_BY_KEY[targetKey] : null;
  // runsToCount travels with the data rather than being mirrored in the frontend. The card counts
  // runs toward it in its own copy ("2 / 3", "play it once more"), and a client guessing at three
  // while the report moved to four would be wrong in the one place a new user is watching.
  return {
    batteries,
    targetFocus,
    nearestUnlock: nearestUnlock(form, target),
    runsToCount: FORM_MIN_RUNS,
    form,
  };
}

// The top focus row, with the game key resolved onto it. The full report page finds the game by
// walking its own domain tree; a caller holding only the summary has no tree to walk, so the key
// travels with the row.
function topFocus(report) {
  const top = report.focus[0];
  if (!top) return null;
  const test = report.domains.flatMap(d => d.tests).find(t => t.code === top.code);
  return { ...top, gameKey: test?.games?.[0] ?? null };
}

// The run this user is CLOSEST TO BANKING: of the games they have started but not yet played
// FORM_MIN_RUNS times, the one with the most runs on it.
//
// It exists for the state the score cannot describe. A player two runs into the roster has a score
// of null and 0% coverage, so every figure the report owns reads as nothing at all — and "nothing
// at all" is wrong, because they may be one run away from their first score. This is that run, and
// on the /cbat card it is the whole message: one game, one number, one more go.
//
// Ranked on runs banked first and most recently played second, deliberately: the question is "what
// am I nearly done with", not "what is worth most", which is what `focus` is for. The recency
// tie-break means it names the game they were just playing, which is the one they are most likely
// to go back into.
//
// Games with no runs at all are excluded. A game never touched is not something a user is partway
// through, and offering it as a near-miss would misreport their own history back at them.
//
// `battery` narrows it to the games a chosen role is actually tested on; without one it ranges
// over the whole roster, because a user who has picked no role still has a first score to earn and
// any game will start it.
function nearestUnlock(form, battery = null) {
  const allowed = battery ? batteryGameKeys(battery) : null;
  let best = null;

  for (const [gameKey, f] of Object.entries(form)) {
    if (!f || !f.runs || f.runs >= FORM_MIN_RUNS) continue;
    if (allowed && !allowed.has(gameKey)) continue;

    const row = {
      gameKey,
      label: CBAT_GAMES[gameKey]?.label ?? gameKey,
      runs: f.runs,
      runsNeeded: FORM_MIN_RUNS - f.runs,
      lastPlayedAt: f.lastPlayedAt ?? null,
    };
    const better = !best
      || row.runs > best.runs
      || (row.runs === best.runs && (row.lastPlayedAt ?? 0) > (best.lastPlayedAt ?? 0));
    if (better) best = row;
  }

  return best;
}

// Every SkyWatch game a battery is tested on, deduplicated.
function batteryGameKeys(battery) {
  const keys = new Set();
  for (const d of battery.domains) {
    for (const t of d.tests) {
      for (const game of TESTS[t.code].games) keys.add(game);
    }
  }
  return keys;
}

// ── Admin: who is worth looking at? ──────────────────────────────────────────────────────────
// Ranks users by finished CBAT runs so the admin picker opens on the people with a report worth
// reading, rather than on whoever registered first.
//
// One aggregation, not one per collection: $unionWith stitches all 25 result collections into a
// single stream of userIds and groups once. Each leg projects away everything but userId, so the
// union carries the minimum. Easier collections are included here deliberately — this counts
// ENGAGEMENT, to sort the list, and is not the report's score (which stays Hard-only).
//
// A search term matches identity, and matching users with no runs at all still come back, ranked
// last: an admin looking up one specific person must find them whether or not they've played.
const MAX_USER_MATCHES = 200;   // ceiling on identity matches fed into the count
const USER_LIST_LIMIT  = 25;

async function buildCbatUserList(User, { q = '', limit = USER_LIST_LIMIT } = {}) {
  const term = String(q).trim();

  let matchedIds = null;
  if (term) {
    // Escaped so punctuation in the query is a literal, not a regex operator — same treatment the
    // admin user search gives it.
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const matches = await User.find(
      { $or: [{ email: rx }, { agentNumber: rx }, { displayName: rx }] },
      '_id',
    ).limit(MAX_USER_MATCHES).lean();
    matchedIds = matches.map(m => m._id);
    if (!matchedIds.length) return [];
  }

  const keys = Object.keys(CBAT_GAMES);
  const leg = (gameKey) => {
    const cfg = CBAT_GAMES[gameKey];
    const match = { ...(cfg.modeFilter ?? {}), ...(matchedIds ? { userId: { $in: matchedIds } } : {}) };
    return [{ $match: match }, { $project: { userId: 1, _id: 0 } }];
  };

  const [head, ...tail] = keys;
  const counts = await CBAT_GAMES[head].Model.aggregate([
    ...leg(head),
    ...tail.map(k => ({ $unionWith: { coll: CBAT_GAMES[k].Model.collection.name, pipeline: leg(k) } })),
    { $group: { _id: '$userId', plays: { $sum: 1 } } },
    { $sort: { plays: -1 } },
    { $limit: limit },
  ]);

  const byId = new Map(counts.map(c => [String(c._id), c.plays]));

  // Pull identity for the ranked ids. On a search we also want the zero-play matches, so the id
  // set is the union of both.
  const ids = [...new Set([...byId.keys(), ...(matchedIds ?? []).map(String)])];
  const users = await User.find({ _id: { $in: ids } }, 'agentNumber email displayName isAdmin cbatTargetBattery').lean();

  const ranked = users
    .map(u => ({
      _id: String(u._id),
      agentNumber: u.agentNumber ?? null,
      email: u.email ?? null,
      displayName: u.displayName ?? null,
      isAdmin: !!u.isAdmin,
      // The role they've said they're aiming for, or null if they never picked one. Carried on the
      // list itself so the picker can say which players have chosen a role before one is opened,
      // and so opening a player lands on their role rather than a default.
      targetBattery: u.cbatTargetBattery ?? null,
      plays: byId.get(String(u._id)) ?? 0,
    }))
    .sort((a, b) => b.plays - a.plays || String(a.agentNumber).localeCompare(String(b.agentNumber)))
    .slice(0, limit);

  // How many roles each listed player currently clears — the thing an admin is actually scanning
  // for, since run count alone doesn't say whether there's a report worth opening.
  //
  // Scored only for the trimmed page (≤25 users), not the whole match set: the form load is one
  // aggregation per game regardless of user count, but there is no reason to score people who
  // won't be shown. Battery scoring itself is pure arithmetic — 25 users × 13 batteries costs
  // nothing once the form is in memory.
  const withPlays = ranked.filter(u => u.plays > 0);
  const form = withPlays.length
    ? await loadFormForUsers(withPlays.map(u => new mongoose.Types.ObjectId(u._id)))
    : {};

  const batteries = Object.values(BATTERY_BY_KEY);
  return ranked.map(u => ({
    ...u,
    // A player with no runs clears nothing — no need to score them to find that out.
    rolesPassed: form[u._id]
      ? batteries.filter(b => buildBatteryReport(b, form[u._id]).status === 'pass').length
      : 0,
    totalRoles: batteries.length,
  }));
}

async function buildAptitudeReport(userId, batteryKey) {
  const battery = BATTERY_BY_KEY[batteryKey];
  if (!battery) return null;
  const form = await loadForm(userId);
  return { ...buildBatteryReport(battery, form), gaps: buildGaps(battery) };
}

module.exports = {
  buildAptitudeReport,
  buildAllBatteryScores,
  buildCbatUserList,
  loadFormForUsers,
  USER_LIST_LIMIT,
  buildBatteryReport,
  buildGaps,
  loadForm,
  scoreTest,
  FORM_WINDOW,
  FORM_MIN_RUNS,
  FOCUS_LIMIT,
};
