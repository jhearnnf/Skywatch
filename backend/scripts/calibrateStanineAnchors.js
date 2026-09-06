/**
 * calibrateStanineAnchors.js
 *
 * READ-ONLY. Proposes new `stanineAnchors` for constants/cbatBatteries.json by
 * measuring both ends of the scale the same way the Aptitude Report measures a
 * user, which is not how the current anchors were built.
 *
 * WHY THIS EXISTS
 * ---------------
 * The report scores a user on the mean of their last FORM_WINDOW runs
 * (utils/cbatAptitudeReport.js). The anchors it compares that against were built
 * differently at both ends:
 *
 *   median  a typical SINGLE run, queried ad hoc (see the "real median single
 *           run ~246" comment on flag in utils/cbatFakeLeaderboard.js)
 *   strong  never measured at all - lifted from that file's demo ceiling, a
 *           number chosen to make fake leaderboard rows look plausible
 *
 * A mean-of-three and a single run share a centre, so `median` roughly survives.
 * The SPREAD does not: averaging strips out within-player noise, so the
 * population of 3-run means is tighter than the population of single runs. A
 * `strong` taken from single runs therefore sits too far out, the step
 * (strong - median) / 3 comes out too wide, and every stanine is squeezed toward
 * 5 - good players read lower than they are. More data never fixes that; it
 * reproduces it more precisely.
 *
 * WHAT THIS MEASURES INSTEAD
 * --------------------------
 * One value per player - their most recent FORM_WINDOW runs, averaged, exactly
 * the estimator the report uses - and both anchors read off that one
 * distribution as quantiles. The stanine band table in utils/cbatStanine.js
 * gives the targets: stanine 5 spans the 40th-60th percentile and stanine 8
 * spans the 89th-96th, so the band centres are P50 and P92.5.
 *
 * One value PER PLAYER, never per run: a run-level quantile is dominated by
 * heavy users, and heavy users are the practised ones, so it drifts upward on
 * volume alone.
 *
 * WHAT IT DOES NOT TOUCH
 * ----------------------
 * Nothing about thin evidence. The shrink toward 5, the scoreLow..scoreHigh band
 * and the 80% coverage floor are independent of where the anchors sit and all
 * still apply on top of whatever this proposes.
 *
 * It also writes nothing. It prints a diff and a paste-ready JSON block; moving
 * the numbers into cbatBatteries.json is a deliberate human step.
 *
 * READING THE OUTPUT
 * ------------------
 * `now@` is the percentile the CURRENT anchor actually sits at in the measured
 * distribution. That is the headline: a strong anchor reading `now@P98` is the
 * compression described above, caught in the act.
 *
 * Usage:
 *   node backend/scripts/calibrateStanineAnchors.js
 *   node backend/scripts/calibrateStanineAnchors.js --min-cohort=50
 *   node backend/scripts/calibrateStanineAnchors.js --game=act --verbose
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const { CBAT_GAMES } = require('../constants/cbatGames');
const { STANINE_ANCHORS, SCORED_GAME_KEYS } = require('../constants/cbatBatteries');
const { MEDIAN_STANINE, STRONG_STANINE } = require('../utils/cbatStanine');

// The report's own window. Kept as a literal rather than imported, because
// cbatAptitudeReport.js pulls in a much larger module graph than this needs -
// but it MUST track it, so a drift here silently mis-measures the cohort.
const FORM_WINDOW = 3;

// Band centres for the two anchors, straight off the stanine table in
// cbatStanine.js: bands are 4/7/12/17/20/17/12/7/4 percent, so the cumulative
// edges are 4, 11, 23, 40, 60, 77, 89, 96. Stanine 5 is 40-60 (centre 50) and
// stanine 8 is 89-96 (centre 92.5).
const MEDIAN_PCT = 50;
const STRONG_PCT = 92.5;

// Below this many distinct players a quantile - especially the P92.5 one, which
// leans on the top tail - is noise dressed as a measurement. Games under it are
// reported but never proposed.
const DEFAULT_MIN_COHORT = 100;

// A game whose per-player values take very few distinct values (Trace 2 is
// integers 0-8, Visualisation 2D is 1-7) cannot support a quantile read: P50 and
// P92.5 can land on adjacent integers and produce a degenerate step. Those keep
// their hand-judged anchors.
const MIN_DISTINCT_VALUES = 12;
const MIN_STEP = 0.5;

const args = process.argv.slice(2);
const argVal = (name, fallback) => {
  const hit = args.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const MIN_COHORT = Number(argVal('min-cohort', DEFAULT_MIN_COHORT));
const ONLY_GAME  = argVal('game', null);
const VERBOSE    = args.includes('--verbose');

// Linear-interpolated quantile over an ascending array. pct is 0-100.
function quantile(sorted, pct) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Where an existing anchor sits in the measured distribution - the "how far off
// are we" number. Share of the cohort at or below `value`.
function percentileOf(sorted, value) {
  if (!sorted.length || !Number.isFinite(value)) return null;
  let n = 0;
  while (n < sorted.length && sorted[n] <= value) n += 1;
  return (n / sorted.length) * 100;
}

// One recent-form value per player: the mean of their most recent FORM_WINDOW
// runs. $sort then $push preserves order inside the group, so $slice takes the
// newest - the same trick loadFormForUsers and the leaderboard percentile use,
// riding the same { userId: 1, createdAt: -1 } index.
async function loadCohort(gameKey) {
  const cfg = CBAT_GAMES[gameKey];
  if (!cfg) return null;

  const match = Object.assign({}, cfg.modeFilter || {}, {
    userId: { $ne: null },
  });
  match[cfg.primaryField] = { $type: 'number' };

  const rows = await cfg.Model.aggregate([
    { $match: match },
    { $sort: { userId: 1, createdAt: -1 } },
    { $group: { _id: '$userId', scores: { $push: '$' + cfg.primaryField } } },
    { $project: {
        runs: { $size: '$scores' },
        form: { $avg: { $slice: ['$scores', FORM_WINDOW] } },
      } },
  ]).allowDiskUse(true);

  const forms = rows.map(r => r.form).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    forms,
    players: forms.length,
    runs: rows.reduce((a, r) => a + r.runs, 0),
    fullWindow: rows.filter(r => r.runs >= FORM_WINDOW).length,
  };
}

function analyse(gameKey, cohort) {
  const current = STANINE_ANCHORS[gameKey] || null;
  const cfg = CBAT_GAMES[gameKey];
  const forms = cohort.forms;

  const proposedMedian = quantile(forms, MEDIAN_PCT);
  const proposedStrong = quantile(forms, STRONG_PCT);
  const distinct = new Set(forms.map(f => Math.round(f * 100))).size;
  const step = proposedStrong === null ? null
    : (proposedStrong - proposedMedian) / (STRONG_STANINE - MEDIAN_STANINE);

  const blockers = [];
  // Every scored game is higher-is-better (asserted in the battery unit tests);
  // a lower-is-better one would invert `strong` and silently corrupt the scale.
  if (cfg && cfg.sortDir !== -1) blockers.push('lower-is-better: anchors would invert');
  if (cohort.players < MIN_COHORT) blockers.push('cohort ' + cohort.players + ' < ' + MIN_COHORT);
  if (distinct < MIN_DISTINCT_VALUES) blockers.push('only ' + distinct + ' distinct values: too lumpy to quantile');
  if (step !== null && step < MIN_STEP) blockers.push('step ' + step.toFixed(2) + ' too small');
  if (!current) blockers.push('no current anchor to compare');

  return Object.assign({
    gameKey, current, proposedMedian, proposedStrong, step, distinct,
    nowMedianPct: current ? percentileOf(forms, current.median) : null,
    nowStrongPct: current ? percentileOf(forms, current.strong) : null,
    blockers,
  }, cohort);
}

const r0 = n => (n === null || n === undefined ? '-' : String(Math.round(n)));
const pct = n => (n === null || n === undefined ? '-' : 'P' + n.toFixed(0));

function report(rows) {
  console.log('');
  console.log('Recent-form window: last ' + FORM_WINDOW + ' runs per player, averaged (matches the report)');
  console.log('Anchor targets:     median = P' + MEDIAN_PCT + ' -> stanine ' + MEDIAN_STANINE
    + '   strong = P' + STRONG_PCT + ' -> stanine ' + STRONG_STANINE);
  console.log('Cohort gate:        ' + MIN_COHORT + ' distinct players');
  console.log('');
  console.log('game                players  runs  full |   median            |   strong            | step');
  console.log('                                        |   now  now@   prop  |   now  now@   prop  |');
  console.log('-'.repeat(100));

  for (const r of rows) {
    console.log([
      r.gameKey.padEnd(18),
      String(r.players).padStart(7),
      String(r.runs).padStart(6),
      String(r.fullWindow).padStart(6),
      ' | ',
      r0(r.current && r.current.median).padStart(5),
      pct(r.nowMedianPct).padStart(6),
      r0(r.proposedMedian).padStart(7),
      ' | ',
      r0(r.current && r.current.strong).padStart(5),
      pct(r.nowStrongPct).padStart(6),
      r0(r.proposedStrong).padStart(7),
      ' | ',
      r.step === null ? '-' : r.step.toFixed(1).padStart(5),
    ].join(''));
    if (r.blockers.length) console.log(' '.repeat(20) + 'HOLD: ' + r.blockers.join('; '));
  }

  const ready = rows.filter(r => !r.blockers.length);
  console.log('');
  console.log(ready.length + ' of ' + rows.length + ' games clear the gate.');

  if (ready.length) {
    console.log('');
    console.log('Paste-ready (merge into stanineAnchors, leave held games as they are):');
    const block = {};
    for (const r of ready) {
      block[r.gameKey] = {
        median: Math.round(r.proposedMedian),
        strong: Math.round(r.proposedStrong),
      };
    }
    console.log(JSON.stringify(block, null, 2));
  }

  const compressed = ready.filter(r => r.nowStrongPct !== null && r.nowStrongPct >= 96);
  if (compressed.length) {
    console.log('');
    console.log('Compression caught: the current `strong` sits at or above the stanine-9 edge (P96)');
    console.log('on these, so almost nobody could ever reach an 8 on them:');
    for (const r of compressed) {
      console.log('  ' + r.gameKey.padEnd(18) + 'strong ' + r.current.strong
        + ' = ' + pct(r.nowStrongPct) + '  ->  ' + Math.round(r.proposedStrong));
    }
  }
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set (backend/.env). Nothing queried.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected. READ-ONLY: this script issues no writes.');

  const keys = (ONLY_GAME ? [ONLY_GAME] : SCORED_GAME_KEYS).filter(k => {
    if (CBAT_GAMES[k]) return true;
    console.warn('skipping ' + k + ': not in CBAT_GAMES');
    return false;
  });

  const rows = [];
  for (const key of keys) {
    const cohort = await loadCohort(key);
    if (!cohort) continue;
    rows.push(analyse(key, cohort));
    if (VERBOSE && cohort.forms.length) {
      const f = cohort.forms;
      console.log('  ' + key + ': min ' + f[0].toFixed(1)
        + '  P25 ' + quantile(f, 25).toFixed(1)
        + '  P75 ' + quantile(f, 75).toFixed(1)
        + '  max ' + f[f.length - 1].toFixed(1));
    }
  }

  rows.sort((a, b) => b.players - a.players);
  report(rows);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
