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
//
// THIN RUNS COUNT, AS A RANGE. A game played once or twice used to contribute nothing at all —
// the user's own runs reported back to them as if they had never touched it. That is its own kind
// of dishonesty, and it is expensive: Pilot draws on fifteen games, so a wall of three runs each
// is thirty-plus Hard runs before the report will say anything, and the advice a report exists to
// give is most valuable on the first evening, which was the one evening it stayed silent.
//
// So every run counts from the first, and thin evidence produces a VAGUE answer rather than no
// answer. Two things follow from one number, a test's `confidence` (runs / FORM_MIN_RUNS, capped
// at 1):
//
//   the estimate is SHRUNK toward the middle of the scale, so one lucky run cannot claim a 9
//   the estimate carries a BAND (`scoreLow`..`scoreHigh`), which narrows as runs are banked
//
// This is the normal-normal conjugate update, with the stanine scale's own definition as the
// prior: mean 5, standard deviation 2. `confidence` is the share of the posterior precision the
// user's runs supply, so the two lines above are the same arithmetic read twice, and at a full
// window confidence is 1, the shrink is nil and the band closes to zero — a full-window report is
// byte-for-byte what it was before this existed.
//
// FORM_MIN_RUNS did not go away; it moved. It is no longer the bar for producing a NUMBER, it is
// the bar for producing a VERDICT: coverage is confidence-weighted, so ten games played once each
// clear no more of the coverage floor than three games played three times, and a band still
// straddling the cutoff reports 'provisional' rather than picking the side it happens to sit on.
// Nobody gets a PASS they can screenshot off one good evening.

const mongoose = require('mongoose');
const { CBAT_GAMES } = require('../constants/cbatGames');
const { MAX_SCORE, MAX_STANINE, MIN_COVERAGE_FOR_VERDICT, DOMAINS, TESTS, BATTERY_BY_KEY, SCORED_GAME_KEYS } = require('../constants/cbatBatteries');
const { scoreToStanine, scoreForStanine, MEDIAN_STANINE } = require('./cbatStanine');

// Matches the recent-form window used by the leaderboard percentile, for the reasons given there:
// one bad run shouldn't tank the estimate, and a lifetime average would permanently drag in a
// user's worst early runs — punishing the very improvement the report exists to show.
const FORM_WINDOW = 3;
// A full window. Reaching it is what makes a test FIRM: no shrink, no band, and its whole weight
// counted toward the coverage a verdict needs. Below it a test still scores — see the header — but
// as a range. It is equal to FORM_WINDOW, so a firm test is always averaging a full window.
const FORM_MIN_RUNS = 3;

// The prior a thin test is shrunk toward, and the width of the band around it. Both are the
// stanine scale's own definition rather than anything we invented: a normal curve cut into nine
// bands with mean 5 and standard deviation 2 (see cbatStanine.js). Knowing nothing about a player,
// "somewhere in the middle, give or take two stanines" is exactly what we believe.
const PRIOR_STANINE = MEDIAN_STANINE;
const PRIOR_SD = 2;
// 90% of the band. Wide enough to be honest about a single run, narrow enough that the range is
// still a useful thing to read — a 95% band off one run spans most of the scale and says nothing.
const BAND_Z = 1.645;

// How much of a test's estimate the user's own runs supply, 0 to 1. Everything the thin-run path
// does is a function of this one number.
const confidenceFor = runs => Math.min(runs, FORM_MIN_RUNS) / FORM_MIN_RUNS;

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
// A test's stanine is the mean of the stanines of whichever of its games the user has played at
// all. VISS is the only test today backed by two games (Visualisation 2D and 3D); a user who has
// played only one is scored on that one rather than blocked for missing the other.
//
// A game played fewer than FORM_MIN_RUNS times is scored TOO, shrunk toward the middle of the
// scale and carrying a standard deviation — the header explains why, and `confidenceFor` is the
// whole of the arithmetic:
//
//   stanine = c × (what their runs say) + (1 - c) × 5      the posterior mean
//   sd      = 2 × sqrt(1 - c)                              the posterior spread
//
// At a full window c is 1, which leaves the raw stanine and a sd of zero. Everything downstream
// of a firm test therefore behaves exactly as it did before thin runs were scored at all.
//
// Two games of one test are independent readings of the same skill, so their means average and
// their sds combine in quadrature — playing both narrows the test, which is right.
//
// Returns a row for EVERY test in the battery, scored or not — the report's gap list and its
// "play it once more" prompts are both built from the ones that are not firm yet, so they can't
// be dropped. `needsRuns` is populated for a thin game whether or not it is scoring.
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
    if (!f.runs) continue;

    const confidence = confidenceFor(f.runs);
    played.push({
      gameKey,
      label: CBAT_GAMES[gameKey]?.label ?? gameKey,
      form: Number(f.form.toFixed(1)),
      runs: f.runs,
      // The raw reading of their runs, unshrunk. This is the one the user is shown against the
      // game ("you are on a 6") and the one `nextTarget` aims at, because it is what their play
      // actually says — the shrink is a statement about how much of it we believe yet, and it
      // belongs to the battery total rather than to the game.
      stanine: scoreToStanine(gameKey, f.form),
      confidence,
      firm: f.runs >= FORM_MIN_RUNS,
      lastPlayedAt: f.lastPlayedAt,
    });

    if (f.runs < FORM_MIN_RUNS) {
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
      confidence: 0,
      firm: false,
    };
  }

  const shrunk = played.map(p => p.confidence * p.stanine + (1 - p.confidence) * PRIOR_STANINE);
  const sds    = played.map(p => PRIOR_SD * Math.sqrt(1 - p.confidence));

  const stanine   = shrunk.reduce((a, s) => a + s, 0) / shrunk.length;
  // What the test would read at if the shrink came off — where banking the outstanding runs takes
  // it, assuming the user keeps playing as they have been. The focus list prices a thin test's
  // remaining runs against this rather than against a stanine we have never seen.
  const rawStanine = played.reduce((a, p) => a + p.stanine, 0) / played.length;
  const stanineSd = Math.sqrt(sds.reduce((a, s) => a + s * s, 0)) / sds.length;
  const confidence = played.reduce((a, p) => a + p.confidence, 0) / played.length;

  // The score to beat for the next stanine up, on whichever of the test's games is furthest along.
  // Null at 9 — there is nothing above it.
  const lead = played.reduce((a, b) => (b.stanine > a.stanine ? b : a));
  const nextTarget = lead.stanine < MAX_STANINE
    ? { gameKey: lead.gameKey, stanine: lead.stanine + 1, score: scoreForStanine(lead.gameKey, lead.stanine + 1) }
    : null;

  return {
    ...base,
    stanine,
    rawStanine,
    stanineSd,
    confidence,
    // Firm means every game feeding this test has a full window behind it: no shrink, no band, and
    // its whole weight counts toward the coverage a verdict needs.
    firm: played.every(p => p.firm),
    state: 'scored',
    played,
    needsRuns,
    nextTarget,
  };
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
    // Coverage is confidence-weighted, so a test played once buys a third of its weight rather
    // than all of it. This is the load-bearing half of "thin runs cannot buy a verdict": without
    // it, ten games played once each would clear the 80% floor and hand out a PASS on ten single
    // runs, which is the exact thing MIN_COVERAGE_FOR_VERDICT exists to prevent.
    const measuredMult = scored.reduce((a, t) => a + t.mult * t.confidence, 0);

    // Multiplier-weighted mean over the tests we could score. A domain where nothing is scorable
    // gets a null stanine and drops out of the battery total below.
    //
    // Weighted on `mult` alone, NOT on mult × confidence: a thin test has already been pulled
    // toward the middle of the scale by its own shrink, and discounting it a second time here
    // would count the same uncertainty twice and quietly hand the domain to whichever test the
    // user happens to have played most. The uncertainty that is left rides in `stanineSd`.
    const stanine = scoredMult
      ? scored.reduce((a, t) => a + t.stanine * t.mult, 0) / scoredMult
      : null;
    // Independent readings, so the sds combine in quadrature under the same weights. Zero once
    // every test in the domain is firm.
    const stanineSd = scoredMult
      ? Math.sqrt(scored.reduce((a, t) => a + (t.mult * t.stanineSd) ** 2, 0)) / scoredMult
      : null;

    return {
      key: d.key,
      label: DOMAINS[d.key].label,
      blurb: DOMAINS[d.key].blurb,
      weight: d.weight,
      stanine: stanine === null ? null : Number(stanine.toFixed(2)),
      stanineSd: stanineSd === null ? null : Number(stanineSd.toFixed(2)),
      // Share of this domain's own tests that fed the stanine, discounted by how firm each one is
      // — the caveat on the domain row.
      coverage: totalMult ? Math.round((measuredMult / totalMult) * 100) : 0,
      // True once nothing in this domain is still resting on a part-played game.
      firm: scored.length > 0 && scored.every(t => t.firm),
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

  // The band. Domains are independent readings of different skills, so their sds combine in
  // quadrature under the same weights and through the same ×20, and the whole thing collapses to
  // zero the moment every counted test is firm.
  const scoreSd = measuredWeight
    ? (Math.sqrt(measured.reduce((a, d) => a + (d.weight * d.stanineSd) ** 2, 0)) / measuredWeight) * (MAX_SCORE / MAX_STANINE)
    : null;
  const clampScore = n => Math.min(MAX_SCORE, Math.max(0, Math.round(n)));
  const scoreLow  = score === null ? null : clampScore(score - BAND_Z * scoreSd);
  const scoreHigh = score === null ? null : clampScore(score + BAND_Z * scoreSd);
  // A firm report is one nothing is still guessing at: no part-played game anywhere in it. This is
  // what turns the range back into the single number the page leads with.
  const firm = score !== null && scoreSd === 0;

  // Weight-share of the battery the estimate rests on. Both legs matter: a domain can be fully
  // weighted in but only half its tests scored, so this walks tests rather than domains.
  const coveredWeight = domains.reduce((a, d) => a + (d.weight * d.coverage) / 100, 0);
  const coverage = totalWeight ? Math.round((coveredWeight / totalWeight) * 100) : 0;

  // Runs banked against runs to a firm score, for the line under the range ("based on 11 of 45
  // runs"). Counted over the games this role is actually tested on, and capped per game at a full
  // window, so the denominator is a finish line the user can reach rather than a total that grows
  // every time they play.
  const gameKeys = batteryGameKeys(battery);
  let runsBanked = 0;
  for (const key of gameKeys) runsBanked += Math.min(form[key]?.runs ?? 0, FORM_MIN_RUNS);

  return {
    key: battery.key,
    label: battery.label,
    group: battery.group,
    note: battery.note ?? null,
    cutoff: battery.cutoff,
    maxScore: MAX_SCORE,
    score,
    // The range around `score`, and the flag saying whether there is one. On a firm report low and
    // high are both the score itself, so a caller can render `scoreLow`..`scoreHigh` unconditionally
    // and get a single number without asking.
    scoreLow,
    scoreHigh,
    scoreSd: scoreSd === null ? null : Number(scoreSd.toFixed(1)),
    firm,
    // Runs banked toward a firm score, and the number that gets there. The honest caption under a
    // range: it says how far off the single number is in the only unit the user can act in.
    runsBanked,
    runsForFirmScore: gameKeys.size * FORM_MIN_RUNS,
    // How many of this role's tests are settled, and how many are contributing at all. The /cbat
    // card needs the first to tell "has never finished a window" apart from "part way through a
    // well-covered role" — two states that both report a band, and want opposite headlines.
    firmTests: domains.reduce((a, d) => a + d.tests.filter(t => t.firm).length, 0),
    scoredTests: domains.reduce((a, d) => a + d.tests.filter(t => t.state === 'scored').length, 0),
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
    //
    // The second guard is the band. Coverage can clear the floor with a couple of part-played
    // games still in the mix, and a score of 92 against a cutoff of 90 is not a pass when the
    // range around it runs 85 to 99 — that verdict is a coin toss dressed as a result. A band
    // straddling the cutoff is therefore provisional too, and the way out is the same as ever:
    // bank the runs, close the band, get an answer. Zero-width on a firm report, so this can never
    // touch a fully played battery.
    status: score === null
      ? 'unscored'
      : coverage < MIN_COVERAGE_FOR_VERDICT
        ? 'provisional'
        : (scoreLow < battery.cutoff && scoreHigh >= battery.cutoff)
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
// 'unlock'  — a game played fewer than three times, so it is not counting in full yet. Priced in
//             COVERAGE: the share of the battery's weight the outstanding runs would ADD to what
//             we can measure. Covers both a game never touched and one part-played; the second
//             kind has already bought a slice of its weight and is priced on the remainder.
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

    // Only a FIRM test is an improvement. A test still short of a full window emits an unlock row
    // instead, below — its outstanding runs are what it needs, and rows are one per test so a
    // half-played game is never advertised twice with two different prices on it.
    for (const t of scored) {
      if (!t.firm) continue;
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
      const thin = t.state === 'scored' && !t.firm;
      if (t.state !== 'needs-runs' && t.state !== 'easier-only' && !thin) continue;

      // A domain with nothing scored is not in `measuredWeight`, so this play brings the domain's
      // whole weight into the base rather than joining a base it is already part of. Both cases
      // are the same subtraction once the new base is worked out properly. A thin test is already
      // in the base, so it never opens anything.
      const opensDomain = scoredMult === 0;
      // Where the test lands once the outstanding runs are in. For a game never touched that is a
      // guess at the middle of the scale; for one already part-played it is what their own runs
      // are saying, freed of the shrink — a far better estimate, and the reason firming up can
      // legitimately move the score DOWN for someone below the median.
      const settledStanine = thin ? t.rawStanine : ASSUMED_UNLOCK_STANINE;
      const newDomainStanine = thin
        ? (d.stanine * scoredMult - t.stanine * t.mult + settledStanine * t.mult) / scoredMult
        : ((opensDomain ? 0 : d.stanine * scoredMult) + settledStanine * t.mult) / (scoredMult + t.mult);
      const newWeight = measuredWeight + (opensDomain ? d.weight : 0);
      const newStanineWeight =
        stanineWeight - (opensDomain ? 0 : d.stanine * d.weight) + newDomainStanine * d.weight;

      out.push({
        kind: 'unlock',
        code: t.code, label: t.label, match: t.match,
        domainKey: d.key, domainLabel: d.label, domainWeight: d.weight,
        // A thin test HAS a reading, and hiding it here would be the old silence in miniature:
        // the row is about banking runs, but the user has already earned a number on it.
        stanine: thin ? t.stanine : null,
        needsRuns: t.needsRuns ?? [],
        easierOnly: t.state === 'easier-only',
        // True where this play would put a domain of the role on the report for the first time.
        // Those are the rows the score cannot currently see at all.
        opensDomain,
        gain: measuredWeight ? (newStanineWeight / newWeight) * (MAX_SCORE / MAX_STANINE) - currentScore : null,
        // What the outstanding runs would add. A thin test has already bought part of its weight,
        // so only the remainder is on offer — which is what keeps a game played twice below one
        // never touched when the list is ranked on coverage.
        coverageGain: totalMult ? (d.weight * t.mult * (1 - (t.confidence ?? 0))) / totalMult : 0,
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
    const { key, label, group, cutoff, score, scoreLow, scoreHigh, firm, margin, status, coverage,
            runsBanked, runsForFirmScore, firmTests } = report;
    if (targetKey && key === targetKey) targetFocus = topFocus(report);
    return { key, label, group, cutoff, maxScore: MAX_SCORE, score, scoreLow, scoreHigh, firm,
             margin, status, coverage, runsBanked, runsForFirmScore, firmTests };
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
  PRIOR_STANINE,
  PRIOR_SD,
  BAND_Z,
  confidenceFor,
};
