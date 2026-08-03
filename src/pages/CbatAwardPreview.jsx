import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { CBAT_LEADERBOARD_CONFIG } from '../data/cbatGames'
import { AWARD_TIERS } from '../utils/cbatProgressAward'
import CbatGameOver from '../components/CbatGameOver'

// Admin-only preview of the CBAT progress-award milestone flow.
//
// It mounts the REAL <CbatGameOver> rather than the award component on its own, because the thing
// worth checking is the whole post-game moment: the celebration landing over the results, the
// dissolve, the donation note appearing below, and how all of that sits with the score panel,
// sparklines, weekly chase and action row that were already there.
//
// Everything below the award is genuinely live — CbatGameOver fetches its own weekly standing and
// progress series (so those panels show the admin's real history for whichever game came up, or
// sit empty if they have never played it). Only the award itself and the just-played score are
// synthesised, via the `previewAward` prop.
//
// It cannot write a score: submission lives in the game pages, not in CbatGameOver, so mounting
// this leaves the admin's own leaderboard position untouched. It cannot burn a real milestone
// either — `previewAward` short-circuits the claim request entirely.

const GAME_KEYS = Object.keys(CBAT_LEADERBOARD_CONFIG)

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))

// A score that looks like it came from this game rather than from a random number generator —
// within the game's own scale, and near the top of it, since the premise is a player on an
// improving run. Lower-is-better games score in rotations, so they get their own range.
function plausibleScore(cfg) {
  if (cfg.lowerIsBetter) return between(40, 70)
  if (cfg.maxScore) return between(Math.ceil(cfg.maxScore * 0.6), cfg.maxScore)
  return between(120, 480)
}

// A percentage that sits inside the tier being previewed rather than exactly on its boundary —
// the boundary case is the least representative thing to look at.
function pctForTier(tier) {
  const next = AWARD_TIERS[AWARD_TIERS.indexOf(tier) + 1]
  return next ? between(tier, next - 1) : between(tier, tier + 40)
}

// `id` only exists to key the remount below — see runKey.
function roll(id = 0) {
  const gameKey = pick(GAME_KEYS)
  const cfg = CBAT_LEADERBOARD_CONFIG[gameKey]
  const tier = pick(AWARD_TIERS)
  return {
    id,
    gameKey,
    score: plausibleScore(cfg),
    time: cfg.hideTime ? undefined : between(20, 90) + Math.random(),
    award: { gameKey, tier, pct: pctForTier(tier), attempts: between(8, 40) },
  }
}

export default function CbatAwardPreview() {
  const { user } = useAuth()
  const { settings } = useAppSettings()
  const navigate = useNavigate()
  const [run, setRun] = useState(() => roll())
  const reroll = () => setRun(prev => roll(prev.id + 1))

  if (!user?.isAdmin) {
    return (
      <div className="max-w-md mx-auto px-5 py-16 text-center">
        <p className="text-sm text-slate-500">Admins only.</p>
        <Link to="/cbat" className="text-brand-300 text-sm underline">Back to CBAT</Link>
      </div>
    )
  }

  const cfg = CBAT_LEADERBOARD_CONFIG[run.gameKey]
  const donateUrl = String(settings?.progressAwardDonateUrl || '').trim()
  const donateOn = settings?.progressAwardDonateEnabled !== false && !!donateUrl

  return (
    <div className="max-w-md mx-auto px-5 py-6 flex flex-col items-center gap-4">
      {/* Deliberately NOT styled like a results panel. The first version reused
          `bg-[#060e1a] border-[#1a3a5c]` — the exact treatment of <WeeklyChase> and
          <ProgressTrend> — so while previewing it read as one more panel of the screen being
          previewed. A neutral background and a dashed border say "tooling, not content", which
          is the one thing this card must never be mistaken for. */}
      <div className="w-full bg-[#0d1117] border border-dashed border-[#3d4a5c] rounded-lg p-3 text-left">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-amber-300 uppercase tracking-widest font-bold">Admin preview</p>
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Players never see this card</p>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          Showing <span className="text-[#ddeaf8] font-bold">{cfg.title}</span> at the{' '}
          <span className="text-[#ddeaf8] font-bold">+{run.award.tier}%</span> tier. The score is
          made up; the progress and weekly panels below the award are your real data. Nothing here
          is saved.
        </p>
        {/* Says why the ask is missing rather than leaving an admin wondering whether it broke. */}
        {!donateOn && (
          <p className="text-[11px] text-amber-700 mt-1.5">
            {settings?.progressAwardDonateEnabled === false
              ? 'The donation note is switched off in Game Options, so it will not appear after you dismiss the award.'
              : 'No donation URL is set in Game Options, so the donation note will not appear after you dismiss the award.'}
          </p>
        )}
        {/* Neutral greys, not brand-600 — a primary-styled "Roll another" would compete with the
            real Play Again a few hundred pixels below it, in a screen whose whole purpose is
            judging how those real buttons sit together. */}
        <div className="flex gap-3 mt-2.5">
          <button
            onClick={reroll}
            className="px-3 py-1.5 bg-[#232b36] hover:bg-[#2d3745] text-[#ddeaf8] text-xs font-bold rounded-lg transition-colors"
          >
            Roll another
          </button>
          <button
            onClick={() => navigate('/admin')}
            className="px-3 py-1.5 bg-[#232b36] hover:bg-[#2d3745] text-[#ddeaf8] text-xs font-bold rounded-lg transition-colors"
          >
            Back to Admin
          </button>
        </div>
      </div>

      {/* Remounted on every roll so the entrance animation and count-up replay from the start —
          the animation is the main thing being previewed, and swapping numbers in place would
          let an admin see it exactly once. `scoreSaved` is true so the live weekly and progress
          panels fetch immediately instead of sitting on a spinner for the save-wait fallback;
          the banner above states that nothing is actually saved. */}
      <CbatGameOver
        key={run.id}
        gameKey={run.gameKey}
        score={run.score}
        time={run.time}
        scoreSaved
        queued={false}
        personalBest={null}
        onPlayAgain={reroll}
        previewAward={{
          award: run.award,
          donate: donateOn ? { url: donateUrl } : null,
        }}
      />
    </div>
  )
}
