// Frontend view of the Aptitude Report data. The definitions themselves live in
// backend/constants/cbatBatteries.json and are imported straight from there — same arrangement as
// categories.json — so the roles, weights and cutoffs can never drift between the score the API
// computes and the sheet the page draws.
//
// Everything here is presentation: how to word a stanine, where a test's game lives, how to group
// the role picker.

import batteryData from '../../backend/constants/cbatBatteries.json'
import { CBAT_LEADERBOARD_CONFIG, CBAT_DIFFICULTY_BY_KEY } from './cbatGames'

export const { maxScore: MAX_SCORE, maxStanine: MAX_STANINE, domains: DOMAINS, tests: TESTS, batteries: BATTERIES } = batteryData

export const BATTERY_BY_KEY = Object.fromEntries(BATTERIES.map(b => [b.key, b]))

// Role picker grouping, in the order the sheet itself lists them: officer aircrew first, then Air
// & Space Ops, then non-commissioned. Derived from the data so a new battery appears without
// touching this file, as long as it reuses an existing group name.
export const BATTERY_GROUPS = BATTERIES.reduce((acc, b) => {
  const group = acc.find(g => g.label === b.group)
  if (group) group.batteries.push(b)
  else acc.push({ label: b.group, batteries: [b] })
  return acc
}, [])

// Whether a game ships an Easier/Hard split. Read off the leaderboard config's difficultyGroup —
// the same field the leaderboard's pill pair is built from — so a newly split game is covered here
// without a second list to keep in step.
//
// It matters on this page because anywhere the sheet tells you to go and play something it has to
// name the difficulty, but ONLY for the games that have one: "play more Target on Hard" would send
// a user looking for a setting that isn't there.
export function gameHasDifficulties(gameKey) {
  return Boolean(CBAT_LEADERBOARD_CONFIG[gameKey]?.difficultyGroup)
}

// WHICH difficulty the key a battery scores actually is — 'Easier', 'Hard', or null for a game with
// no split. Not the same question as gameHasDifficulties, and the report needs this one.
//
// For nearly every split game the scored key is the Hard half, so the two used to be interchangeable
// and the page assumed Hard outright. ANT broke that: its Easier half is the original board on the
// plain 'ant' key, which is the key the battery scores, so a sheet hard-coded to Hard would send a
// user to a board whose runs it does not count. Reading the difficulty off the registry keeps the
// wording and the link honest whichever half a battery happens to point at.
export function scoredDifficulty(gameKey) {
  return CBAT_DIFFICULTY_BY_KEY[gameKey] ?? null
}

// Where a focus item sends the user. Every scorable game has a leaderboard config carrying the
// route to its instructions page, which is where you'd want to land before a run anyway.
//
// Split games get ?difficulty= on the end, naming the half this report actually scores. A game's
// card opens on whatever difficulty that user last chose, so without the param the page would tell
// someone to play one board and then hand them the other. See src/utils/cbat/difficultyParam.js for
// what the game does with it.
export function gamePath(gameKey) {
  const path = CBAT_LEADERBOARD_CONFIG[gameKey]?.backPath ?? '/cbat'
  const difficulty = scoredDifficulty(gameKey)
  return difficulty ? `${path}?difficulty=${difficulty.toLowerCase()}` : path
}

export function gameTitle(gameKey) {
  return CBAT_LEADERBOARD_CONFIG[gameKey]?.title ?? gameKey
}

export function gameEmoji(gameKey) {
  return CBAT_LEADERBOARD_CONFIG[gameKey]?.emoji ?? '🎮'
}

// Every "go and play this" in the report has to name the difficulty, because only runs on the half
// it scores feed it. Saying just "play it more" is advice that quietly fails: the game card opens on
// the difficulty that user last chose, so the runs they go away and do could leave the score exactly
// where it was.
//
// Empty for a game with no split, where naming a difficulty would send someone hunting for a
// button that isn't on the card. Reads the same helper the links do, so the wording and the
// ?difficulty= on the link can't disagree.
export function onHard(gameKey) {
  const difficulty = scoredDifficulty(gameKey)
  return difficulty ? ` on ${difficulty}` : ''
}

// Plain words for a stanine. The bands are the real ones: a stanine has a fixed meaning against the
// normal curve (1-3 below average, 4-6 average, 7-9 above), so this is description, not grading on
// a curve of our own invention.
export function stanineBand(stanine) {
  if (stanine == null) return { label: 'Not measured', tone: 'muted' }
  const s = Math.round(stanine)
  if (s <= 2) return { label: 'Well below average', tone: 'bad' }
  if (s === 3) return { label: 'Below average',      tone: 'bad' }
  if (s <= 6) return { label: 'Average',             tone: 'mid' }
  if (s === 7) return { label: 'Above average',      tone: 'good' }
  return { label: 'Well above average',              tone: 'good' }
}

// The share of the population sitting at or below each stanine: the standard 4/7/12/17/20/17/12/
// 7/4 split of the normal curve, accumulated.
const STANINE_CUMULATIVE = [0, 4, 11, 23, 40, 60, 77, 89, 96, 100]

// The percentage of players you are ahead of. Phrased this way round on purpose.
//
// The obvious phrasing, "you are in the top X%", breaks below average: a stanine of 2 is the top
// 93%, which is technically true and reads as praise for a bad score. "Better than 7% of players"
// is the same fact and cannot be misread. It also stays sensible right across the scale, so one
// sentence covers every user instead of needing to flip wording at the midpoint.
export function stanineBeatsPct(stanine) {
  if (stanine == null) return null
  const s = Math.round(stanine)
  // Midpoint of the band, so a 5 lands on 50 rather than on either edge of the average band.
  return Math.round((STANINE_CUMULATIVE[s - 1] + STANINE_CUMULATIVE[s]) / 2)
}

// Colour for a stanine bar, walking the same red → amber → blue → emerald ramp the rest of the app
// uses for "behind / level / ahead". Deliberately not a rainbow: the point of the bar is length.
export function stanineTone(stanine) {
  if (stanine == null) return { bar: '#1a3a5c', text: 'text-slate-500' }
  const s = Math.round(stanine)
  if (s <= 3) return { bar: '#c2544d', text: 'text-[#e58b85]' }
  if (s <= 4) return { bar: '#c98a3c', text: 'text-amber-700' }
  if (s <= 6) return { bar: '#5baaff', text: 'text-brand-700' }
  return { bar: '#3fae7d', text: 'text-emerald-300' }
}

// How the score sits against the pass mark. `margin` is signed points from it.
//
// "Cutoff" is the word printed on the real sheet, but "pass mark" is what it means, so that is what
// the UI says everywhere. Someone reading this page has often never seen a CBAT sheet.
//
// The four bands exist because "you passed by one point" and "you passed by forty" call for
// different words: the first is a warning dressed as good news, given this is an estimate, and
// telling someone they are through on a one-point margin would be the most misleading thing on the
// page.
// Below this much of a role measured, the score is arithmetic rather than a verdict. Shared with
// the backend, which sets status 'provisional' at the same threshold.
export const MIN_COVERAGE_FOR_VERDICT = batteryData.minCoverageForVerdict

export function reportVerdict({ status, margin, coverage, scoreLow, scoreHigh, cutoff } = {}) {
  // A provisional score is real arithmetic on too little evidence. It must never be coloured or
  // worded as a pass, because the number itself looks exactly as confident as a full one.
  //
  // Two different things put a battery here, and they need different words. Usually it is coverage
  // — most of the role has not been played at all. But a role can be well covered and still
  // unjudgeable because the range around the score has the pass mark inside it, and telling that
  // user to "play more of its games" would be useless advice: they have played them, they just
  // have not played them enough times each.
  if (status === 'provisional') {
    const straddles = scoreLow != null && scoreHigh != null && cutoff != null
      && scoreLow < cutoff && scoreHigh >= cutoff && scoreLow !== scoreHigh
    return straddles
      ? {
          label: 'Too close to call',
          tone: 'muted',
          blurb: `Your range is ${scoreLow} to ${scoreHigh} and the pass mark is ${cutoff}, so it could still go either way. Bank the rest of your runs and we'll call it.`,
        }
      : {
          label: 'Not enough to judge yet',
          tone: 'muted',
          blurb: `We've only measured ${coverage}% of this role. Play more of its games and we'll tell you if you'd pass.`,
        }
  }
  if (margin == null)  return { label: 'Not scored yet', tone: 'muted', blurb: 'Play a few games and your score starts here.' }
  if (margin >= 15)    return { label: 'Passing',        tone: 'good',  blurb: `You are ${margin} points above the pass mark.` }
  if (margin >= 0)     return { label: 'Only just passing', tone: 'mid', blurb: `Just ${margin} point${margin === 1 ? '' : 's'} above the pass mark. Too close to rely on.` }
  if (margin >= -20)   return { label: 'Nearly there',   tone: 'bad',   blurb: `You need ${Math.abs(margin)} more points to pass.` }
  return { label: 'Not passing yet', tone: 'bad', blurb: `You need ${Math.abs(margin)} more points to pass.` }
}

// Colour for the pass/fail ribbon and score track. Provisional shares the neutral blue of an
// unscored battery on purpose: no green, no red, nothing that reads as a result.
export function statusColour(status) {
  if (status === 'pass') return '#2f7d5b'
  if (status === 'fail') return '#a34a45'
  return '#1a3a5c'
}

export const TONE_TEXT = {
  good:  'text-emerald-300',
  mid:   'text-amber-700',
  bad:   'text-[#e58b85]',
  muted: 'text-slate-500',
}
