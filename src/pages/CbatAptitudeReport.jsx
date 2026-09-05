import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'
import {
  MAX_SCORE, MAX_STANINE, BATTERY_GROUPS, BATTERY_BY_KEY,
  gamePath, gameTitle, gameEmoji, gameHasDifficulties, onHard,
  stanineBand, stanineBeatsPct, stanineTone, reportVerdict, statusColour, TONE_TEXT,
} from '../data/cbatBatteries'

// The Aptitude Report — an estimate of what a user's SkyWatch play would score on a real OASC
// battery, laid out the way the sheet a candidate is handed at Cranwell lays it out: a row per
// domain, a stanine bar per row with a tick where the RAF wants you, and one number against a
// cutoff at the end.
//
// The reason it copies that layout rather than inventing a nicer one is that this page is
// rehearsal. A user who has read their own estimate on this shape of sheet does not meet the real
// one cold.

// ── Small pieces ─────────────────────────────────────────────────────────────────────────────

// The sentence that closes a tooltip on a game that is already counting: what to do to move it up.
function levelUpHint(gameKey) {
  return gameHasDifficulties(gameKey)
    ? ' Play more Hard runs to level up. Easier runs do not count.'
    : ' Play more runs to level up.'
}

// The 1-9 stanine bar. Green fill to the achieved stanine, a red tick at the target — exactly the
// two marks the real sheet carries, for the same reason: the gap between them IS the message.
//
// `target` is the stanine this domain needs for the score to clear the cutoff on its own, so the
// tick moves with the role. Domains where we couldn't measure anything render the grid empty
// rather than at zero, because "we don't know" and "you scored the minimum" are not the same
// claim and a zero-length bar would say the second.
function StanineBar({ stanine, target, compact = false }) {
  const tone = stanineTone(stanine)
  const pct = stanine == null ? 0 : (stanine / MAX_STANINE) * 100
  const targetPct = target == null ? null : (target / MAX_STANINE) * 100

  // Built from spans throughout, not divs: a domain row is a <button> and a test row nests this
  // inside a <span>, and neither may legally contain flow content.
  return (
    <span className={`relative block w-full ${compact ? 'h-3' : 'h-5'} bg-[#060e1a] border border-[#1a3a5c] rounded-sm overflow-hidden`}>
      {/* Nine cells, so the bar reads as a scale rather than a percentage. */}
      <span className="absolute inset-0 flex pointer-events-none">
        {Array.from({ length: MAX_STANINE }, (_, i) => (
          <span key={i} className="flex-1 border-r border-[#12293f] last:border-r-0" />
        ))}
      </span>
      {stanine != null && (
        <motion.span
          className="absolute inset-y-0 left-0 block"
          style={{ background: tone.bar, opacity: 0.85 }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      )}
      {targetPct != null && (
        <span
          className="absolute inset-y-0 w-[2px] bg-[#ff4d4d]"
          style={{ left: `calc(${targetPct}% - 1px)` }}
          title={`This role wants stanine ${target} here`}
        />
      )}
    </span>
  )
}

function StanineScale() {
  return (
    <span className="flex w-full text-[9px] text-slate-500 font-mono select-none" aria-hidden="true">
      {Array.from({ length: MAX_STANINE }, (_, i) => (
        <span key={i} className="flex-1 text-center">{i + 1}</span>
      ))}
    </span>
  )
}

// One test inside a skill area. The real sheet only names these in a cramped "Tests" column; here
// each row also names the game to go and play, which is the part a user can act on.
//
// A test SkyWatch has no game for is greyed right back and carries no link. It is deliberately
// still listed rather than hidden: it is on the real test paper, so leaving it out would quietly
// misrepresent what the role asks of you.
function TestRow({ test }) {
  const mult = test.mult > 1 ? <span className="text-slate-500 font-mono"> ×{test.mult}</span> : null

  if (test.state === 'no-game') {
    return (
      <div className="flex items-center gap-2 py-1 pl-3 text-[11px] min-w-0 opacity-45" title={`${test.label}. SkyWatch has no game for this yet, so it is left out of your score.`}>
        <span className="text-slate-600 w-[92px] shrink-0 truncate line-through decoration-slate-600/60">{test.code}{mult}</span>
        <span className="px-1.5 py-0.5 rounded bg-[#0d1a2b] border border-[#1a3a5c] text-slate-600 text-[9px] font-bold uppercase tracking-wide shrink-0">
          No game yet
        </span>
        <span className="text-slate-600 truncate hidden sm:block">Left out of your score</span>
      </div>
    )
  }

  if (test.state !== 'scored') {
    const need = test.needsRuns?.[0]
    return (
      <div className="flex items-center gap-2 py-1 pl-3 text-[11px] min-w-0">
        <span className="text-slate-600 w-[92px] shrink-0 truncate">{test.code}{mult}</span>
        {test.state === 'easier-only' ? (
          <span className="text-amber-700">Easier games don&apos;t count. Play {test.games.map(gameTitle).join(' or ')} on Hard.</span>
        ) : (
          <Link to={gamePath(test.games[0])} className="text-brand-700 hover:text-brand-800 underline underline-offset-2">
            {need
              ? `Play ${need.label}${onHard(need.gameKey)} ${need.runsNeeded} more time${need.runsNeeded === 1 ? '' : 's'}`
              : `Play ${gameTitle(test.games[0])}${onHard(test.games[0])}`}
          </Link>
        )}
      </div>
    )
  }

  const tone = stanineTone(test.stanine)
  // Labelled inline wherever it appears, because an unlabelled number here reads as "the score you
  // got" rather than the mean of your recent goes that it actually is.
  //
  // The label counts the runs it is actually averaging rather than saying "3" flat. A game played
  // once now counts, and calling one run "Last 3" would be the report lying about its own
  // evidence in the one place a user can check it.
  const runsShown = Math.max(...test.played.map(p => p.runs))
  const last3 = test.played.map(p => `${p.label} ${p.form}`).join(' · ')
  const last3Title = `Your average score over your last ${runsShown} go${runsShown === 1 ? '' : 'es'} on Hard, not your best ever.`
  const runsLabel = `Last ${runsShown}:`
  // A test still short of a full window: say so on the row, because its level is being held toward
  // the middle of the scale until the runs are in and the user is owed that explanation.
  const need = test.firm === false ? (test.needsRuns?.[0] ?? null) : null

  return (
    <div className="py-1 pl-3 text-[11px] min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-slate-700 w-[92px] shrink-0 truncate" title={test.label}>{test.code}{mult}</span>
        <div className="flex-1 min-w-0"><StanineBar stanine={test.stanine} compact /></div>
        <span className={`w-6 text-right font-mono font-bold ${tone.text}`}>{Math.round(test.stanine)}</span>
        <span className="hidden sm:block w-[150px] shrink-0 text-slate-600 truncate text-right" title={last3Title}>
          <span className="text-slate-500">{runsLabel}</span> {last3}
        </span>
        {test.match === 'proxy' && (
          <span className="hidden md:inline text-[9px] text-slate-600 uppercase tracking-wide" title="A SkyWatch game that trains the same skill, not a simulation of this exact test">
            proxy
          </span>
        )}
      </div>
      {/* On a phone there is no room for the scores beside the bar, and they used to be dropped
          entirely — which left opening a row on the device most people read this on showing a
          code, a bar and a level, none of which is the thing you opened it to see. They get their
          own line instead. */}
      <p className="sm:hidden mt-0.5 text-[10px] text-slate-600 truncate" title={last3Title}>
        <span className="text-slate-500">{runsLabel}</span> {last3}
      </p>
      {need && (
        <p className="mt-0.5 text-[10px] text-brand-700 truncate">
          <Link to={gamePath(need.gameKey)} className="text-brand-700 hover:text-brand-800 underline underline-offset-2">
            Play {need.label}{onHard(need.gameKey)} {need.runsNeeded} more time{need.runsNeeded === 1 ? '' : 's'}
          </Link>
          {' '}to settle this level. Until then we hold it toward the middle.
        </p>
      )}
    </div>
  )
}

// The games that feed one skill area, always on show under its row.
//
// This is the answer to "so what do I actually play to fix this?". Without it the bar tells you
// where you are weak and nothing tells you what to do about it, which is the wrong half of the
// job. Each chip is a link straight into that game.
//
// Labelled by the game, not the test code, because a newcomer has no idea what CUT or ABD5 means
// but has just seen those game tiles on the CBAT page. The real code is in the tooltip, since it
// is what the actual sheet prints. Tests with no game are greyed and inert, so you can see at a
// glance that part of this skill area is not practisable here.
function DomainTestChips({ tests }) {
  return (
    <div className="flex flex-wrap gap-1 pb-2 pl-7 sm:pl-9 pr-2 sm:pr-3">
      {tests.map((t) => {
        const single = t.games.length === 1 ? t.games[0] : null
        const label  = single ? gameTitle(single) : t.label
        const chip   = 'px-1.5 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap'
        // Some tests are sat more than once and count that many times inside the skill area, so a
        // ×3 is a straight instruction about where the practice pays off most.
        const mult   = t.mult > 1
          ? <span className="font-mono font-normal opacity-70"> ×{t.mult}</span>
          : null

        if (t.state === 'no-game') {
          return (
            <span
              key={t.code}
              title={`${t.code} · ${t.label}. No SkyWatch game for this yet.`}
              className={`${chip} bg-[#0d1a2b] border-[#1a3a5c] text-slate-600 line-through decoration-slate-600/60 opacity-50`}
            >
              {t.label}{mult}
            </span>
          )
        }

        // Blue means "playing this moves your score right now" — either it isn't counting yet, or
        // it is counting and can still go up. Amber is the one case where runs exist but are being
        // ignored, which needs explaining rather than encouraging.
        // A part-played test is highlighted like an unplayed one, because the call to action is the
        // same: more runs. It is counting, but not at full weight, and blue is what says "playing
        // this moves your score right now".
        const thin = t.state === 'scored' && t.firm === false
        const tone = t.state === 'easier-only'
          ? 'bg-amber-500/10 border-amber-400/40 text-amber-700'
          : (t.state === 'needs-runs' || thin)
            ? 'bg-brand-500/10 border-brand-400/40 text-brand-700'
            : 'bg-[#060e1a] border-[#1a3a5c] text-slate-700 hover:border-brand-400 hover:text-brand-700'

        const hint = t.state === 'needs-runs'
          ? ` Play it${onHard(t.needsRuns?.[0]?.gameKey ?? t.games[0])} ${t.needsRuns?.[0]?.runsNeeded ?? 3} more time(s) to start counting.`
          : t.state === 'easier-only' ? ' Your runs were on Easier, which do not count. Play it on Hard to start counting.'
          : thin
            ? ` You are on level ${Math.round(t.stanine)} so far. Play it${onHard(t.needsRuns?.[0]?.gameKey ?? t.games[0])} ${t.needsRuns?.[0]?.runsNeeded ?? 1} more time(s) to settle it.`
            : ` You are on level ${Math.round(t.stanine)}.${levelUpHint(t.games[0])}`

        return (
          <Link
            key={t.code}
            to={gamePath(t.games[0])}
            title={`${t.code} · ${t.label}.${hint}`}
            className={`${chip} no-underline transition-colors ${tone}`}
          >
            {single ? `${gameEmoji(single)} ` : ''}{label}{mult}
          </Link>
        )
      })}
    </div>
  )
}

// A skill area, the games that feed it, and (on tap) how you scored on each. The sheet's own
// hierarchy: read the bars to see where you stand, open one to find out why.
//
// A skill area with nothing we can measure is greyed out whole. That happens either because we have
// no game for any of its tests, or because you haven't played them enough yet, and the row says
// which so the two are never confused.
function DomainRow({ domain, targetStanine }) {
  const [open, setOpen] = useState(false)
  const tone = stanineTone(domain.stanine)
  const band = stanineBand(domain.stanine)

  const unmeasured  = domain.stanine == null
  const noGameAtAll = unmeasured && domain.tests.every(t => t.state === 'no-game')

  return (
    <div className={`border-b border-[#12293f] last:border-b-0 ${unmeasured ? 'opacity-50' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 text-left hover:bg-[#0a1628] transition-colors"
      >
        <span className="text-slate-500 text-[10px] w-3 shrink-0">{open ? '▾' : '▸'}</span>
        <span className="w-[104px] sm:w-[150px] shrink-0 min-w-0">
          <span className="block text-xs font-bold text-slate-800 truncate">{domain.label}</span>
          <span className={`block text-[10px] truncate ${TONE_TEXT[band.tone]}`}>
            {unmeasured ? (noGameAtAll ? 'No game yet' : 'Not enough games') : band.label}
          </span>
        </span>
        <span className="flex-1 min-w-0"><StanineBar stanine={domain.stanine} target={targetStanine} /></span>
        <span className={`w-7 text-right font-mono text-base font-extrabold ${tone.text}`}>
          {domain.stanine == null ? '-' : Math.round(domain.stanine)}
        </span>
        <span className="hidden sm:block w-[104px] lg:w-[132px] shrink-0 text-right">
          <span className="block text-[10px] text-slate-600 font-mono">counts {domain.weight}%</span>
          {!unmeasured && domain.coverage < 100 && (
            <span className="block text-[9px] text-slate-600">We measure {domain.coverage}% of it</span>
          )}
        </span>
      </button>

      {/* Sibling of the toggle, not a child: these are links, and an anchor inside a button is
          invalid and swallows the click on some browsers. */}
      <DomainTestChips tests={domain.tests} />

      {open && (
        <div className="pb-2 pl-5 pr-2 sm:pr-3">
          <p className="text-[11px] text-slate-600 mb-1.5 pl-3">{domain.blurb}</p>
          {domain.tests.map(t => <TestRow key={t.code} test={t} />)}
        </div>
      )}
    </div>
  )
}

// ── Role picker ──────────────────────────────────────────────────────────────────────────────
// Every role scored at once, because "which roles would I get through on?" is a question the real
// sheet answers at a glance and no other part of SkyWatch answers at all. The pass marks span 32
// points, so the same play clears NCO Control and misses Pilot. Seeing that side by side is most of
// the value.
function RolePicker({ batteries, selected, targetBattery, onSelect, onSetTarget, onClose, canSetTarget = true }) {
  return (
    <div className="bg-surface border border-slate-200 rounded-2xl p-4 mb-5 card-shadow">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-extrabold text-slate-900">How you&apos;d do in every role</h2>
        <button type="button" onClick={onClose} className="text-xs text-slate-600 hover:text-brand-700 transition-colors">Close</button>
      </div>
      <p className="text-[11px] text-slate-600 mb-3">
        Every role has its own pass mark, so the same score can pass one and fail another. Tap one to see it in full.
      </p>

      {BATTERY_GROUPS.map(group => (
        <div key={group.label} className="mb-4 last:mb-0">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide font-bold mb-1.5">{group.label}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {group.batteries.map(b => {
              const row = batteries.find(x => x.key === b.key)
              const isSelected = b.key === selected
              const isTarget = b.key === targetBattery
              // Provisional shares the muted grey of an unscored role: it is not a result.
              const tone = row?.status === 'pass' ? 'text-emerald-300' : row?.status === 'fail' ? 'text-[#e58b85]' : 'text-slate-500'
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => onSelect(b.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'border-brand-400 bg-brand-50'
                      : 'border-[#1a3a5c] bg-[#060e1a] hover:border-brand-300 hover:bg-[#0a1628]'
                  }`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-bold text-slate-800 truncate">
                      {b.label}
                      {isTarget && <span className="ml-1.5 text-[9px] text-brand-700 uppercase tracking-wide">your goal</span>}
                    </span>
                    <span className="block text-[10px] text-slate-600 font-mono">pass mark {b.cutoff}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className={`block font-mono text-sm font-extrabold ${tone}`}>{row?.score ?? '-'}</span>
                    <span className={`block text-[9px] uppercase tracking-wide ${tone}`}>
                      {row?.status === 'unscored' ? 'no score' : row?.status === 'provisional' ? 'partial' : row?.status}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {/* Hidden while an admin is reading someone else's report: the button sets the ADMIN's own
          target, which is not what "set target role" means on a page showing another player. */}
      {canSetTarget ? (
        <>
          <button
            type="button"
            onClick={() => onSetTarget(selected)}
            disabled={selected === targetBattery}
            className="mt-2 w-full px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-[#0a1628] disabled:text-slate-600 text-white text-xs font-bold transition-colors"
          >
            {selected === targetBattery
              ? `${BATTERY_BY_KEY[selected]?.label} is the role you're aiming for`
              : `I'm aiming for ${BATTERY_BY_KEY[selected]?.label}`}
          </button>
          <p className="text-[10px] text-slate-600 text-center mt-1.5">
            We&apos;ll track this role for you on the CBAT Aptitude Practise page.
          </p>
        </>
      ) : (
        <p className="text-[10px] text-slate-600 text-center mt-2">
          {targetBattery
            ? <>This player is aiming for <span className="font-bold text-slate-700">{BATTERY_BY_KEY[targetBattery]?.label}</span>.</>
            : <>This player has not chosen a role yet.</>}
        </p>
      )}
    </div>
  )
}

// ── Admin: read the report as another player ─────────────────────────────────────────────────
// A support tool — "my report looks wrong" is unanswerable without seeing what they see — and the
// only way to view a populated report without playing every game yourself.
//
// Ordered by finished runs so it opens on the people who have a report worth reading. The search
// box is debounced and hits the server rather than filtering the loaded page, because the ranked
// list is only the top 25 and the player being asked about is usually not in it.
function AdminUserPicker({ current, onPick, onClose }) {
  const { API, apiFetch } = useAuth()
  const [q, setQ] = useState('')
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch(`${API}/api/games/cbat/report-users?q=${encodeURIComponent(q)}`)
        const json = await res.json()
        if (!cancelled && res.ok) setUsers(json.data.users)
      } catch { /* the list simply stays as it was */ } finally {
        if (!cancelled) setLoading(false)
      }
    }, q ? 250 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, API, apiFetch])

  return (
    <div className="bg-surface border border-amber-400/40 rounded-2xl p-4 mb-5 card-shadow">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-extrabold text-slate-900">
          View as another player <span className="text-[10px] text-amber-700 uppercase tracking-wide ml-1">admin</span>
        </h2>
        <button type="button" onClick={onClose} className="text-xs text-slate-600 hover:text-brand-700 transition-colors">Close</button>
      </div>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search agent number, name or email…"
        className="w-full px-3 py-2 mb-3 rounded-lg bg-[#060e1a] border border-[#1a3a5c] text-sm text-slate-800
          placeholder:text-slate-600 focus:border-brand-400 focus:outline-none"
      />

      {loading && <p className="text-xs text-slate-500 py-3 text-center">Loading…</p>}
      {!loading && !users.length && <p className="text-xs text-slate-500 py-3 text-center">No players match that.</p>}

      <div className="max-h-[320px] overflow-y-auto space-y-1">
        {current && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-brand-400 bg-brand-50 text-left transition-colors"
          >
            <span className="flex-1 text-xs font-bold text-slate-800">← Back to my own report</span>
          </button>
        )}
        {users.map(u => (
          <button
            key={u._id}
            type="button"
            onClick={() => onPick(u._id)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors ${
              u._id === current
                ? 'border-brand-400 bg-brand-50'
                : 'border-[#1a3a5c] bg-[#060e1a] hover:border-brand-300 hover:bg-[#0a1628]'
            }`}
          >
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-bold text-slate-800 truncate">
                  {u.displayName || `Agent ${u.agentNumber}`}
                </span>
                {u.isAdmin && <span className="shrink-0 text-[9px] text-amber-700 uppercase tracking-wide">admin</span>}
                {/* Roles currently cleared. Sits by the name rather than in the numeric column
                    because it's the thing being scanned for — run count only says how much
                    someone has played, not whether there's a report worth opening. */}
                <span
                  title={`Clears the cutoff on ${u.rolesPassed} of ${u.totalRoles} roles`}
                  className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide ${
                    u.rolesPassed > 0
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-[#c2544d]/15 text-[#e58b85]'
                  }`}
                >
                  {u.rolesPassed} {u.rolesPassed === 1 ? 'role' : 'roles'}
                </span>
              </span>
              <span className="block text-[10px] text-slate-600 truncate">{u.email}</span>
              {/* Whether they've chosen a role, on its own line rather than as a chip by the name:
                  role labels run to "WSOP (Air Signaller, Linguist)" and would crowd out the name
                  they're being scanned against. Blue when set, grey when not, so the two states
                  separate at a glance down the column. */}
              <span
                className={`block text-[10px] truncate ${u.targetBattery ? 'text-brand-700' : 'text-slate-500 italic'}`}
                title={u.targetBattery
                  ? 'Opening this player will show this role'
                  : 'This player has not chosen a role, so their report opens on the first one on the sheet'}
              >
                {u.targetBattery
                  ? `Aiming for ${BATTERY_BY_KEY[u.targetBattery]?.label ?? u.targetBattery}`
                  : 'No role chosen'}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-sm font-extrabold text-slate-700">{u.plays}</span>
              <span className="block text-[9px] text-slate-600 uppercase tracking-wide">runs</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────────────────────

export default function CbatAptitudeReport() {
  const { user, setUser, API, apiFetch } = useAuth()
  const [params, setParams] = useSearchParams()

  const [summary, setSummary] = useState(null)     // every battery, headline figures
  const [report, setReport] = useState(null)       // the selected battery, in full
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [userPickerOpen, setUserPickerOpen] = useState(false)
  // The explainer answers the questions a first-timer has and nobody else's. Null means "decide
  // from the report": open for a reader with no score, shut for one who has one and has almost
  // certainly read it. An explicit tap wins over both, for the life of the page.
  const [helpOpen, setHelpOpen] = useState(null)

  // Admin only: whose report we're reading. In the URL so a refresh — or a link pasted into a
  // support thread — lands back on the same player.
  const viewingId = user?.isAdmin ? params.get('as') : null
  const asParam = viewingId ? `?userId=${encodeURIComponent(viewingId)}` : ''
  const viewingAs = report?.viewingAs ?? summary?.viewingAs ?? null

  // When viewing another player it's THEIR saved target the page should open on, not the admin's.
  const targetBattery = (viewingId ? summary?.targetBattery : user?.cbatTargetBattery) ?? null

  // Our own target is on the user object and known immediately; another player's only arrives with
  // their summary. Until it does there is no role worth fetching — guessing one would render a
  // report for a role nobody asked for and then swap it out from under the reader — so `selected`
  // stays null and the page holds on its loading line.
  const subjectReady = !viewingId || summary != null
  // URL wins (so a report is linkable), then the saved target, then the first role on the sheet.
  const selected = params.get('role')
    ?? (subjectReady ? (targetBattery ?? BATTERY_GROUPS[0].batteries[0].key) : null)

  // The sheet is wide — a domain row carries a name, a weight, a nine-cell bar and a verdict.
  // Same shell override the CBAT picker uses.
  useEffect(() => {
    document.body.classList.add('cbat-recent-wide')
    return () => document.body.classList.remove('cbat-recent-wide')
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    // Dropped before the fetch, not merged after it: the target role on a stale summary belongs to
    // the player we've just navigated away from, and reading it as the new one's would open their
    // report on a role they never chose.
    setSummary(null)
    ;(async () => {
      try {
        const res = await apiFetch(`${API}/api/games/cbat/report${asParam}`)
        const json = await res.json()
        if (!cancelled && res.ok) setSummary(json.data)
      } catch { /* the per-role report below is what the page needs to render */ }
    })()
    return () => { cancelled = true }
  }, [user, API, apiFetch, asParam])

  useEffect(() => {
    if (!user) return
    setLoading(true)
    if (!selected) return   // still waiting on the viewed player's saved role
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch(`${API}/api/games/cbat/report/${selected}${asParam}`)
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(json.message || 'Could not load your report')
        setReport(json.data)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [user, API, apiFetch, selected, asParam])

  const selectRole = useCallback((key) => {
    setParams(prev => { const next = new URLSearchParams(prev); next.set('role', key); return next }, { replace: true })
  }, [setParams])

  // Switching subject drops the role from the URL: the previous player's target role has no
  // bearing on the next one's, and the effect above will re-open on whatever theirs is.
  const pickUser = useCallback((id) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('role')
      if (id) next.set('as', id); else next.delete('as')
      return next
    }, { replace: true })
    setUserPickerOpen(false)
  }, [setParams])

  const setTarget = useCallback(async (key) => {
    try {
      const res = await apiFetch(`${API}/api/users/me/target-battery`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batteryKey: key }),
      })
      const json = await res.json()
      if (res.ok) setUser(json.data.user)
    } catch { /* leaving the target unchanged is a safe failure */ }
  }, [API, apiFetch, setUser])

  // The stanine every domain would need for the battery to land exactly on its cutoff — the red
  // tick on each row. It's a flat line rather than a per-domain figure because the real per-domain
  // targets aren't published anywhere; what IS derivable is that a candidate sitting on this
  // stanine across the board scores precisely the cutoff, which makes it an honest "this is the
  // bar" mark and reads the same way the sheet's tick does.
  const targetStanine = useMemo(
    () => (report ? Number(((report.cutoff / MAX_SCORE) * MAX_STANINE).toFixed(2)) : null),
    [report],
  )

  if (!user) {
    return (
      <div>
        <SEO title="Aptitude Report" description="See how your CBAT practice would score against a real RAF role cutoff." />
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 text-center card-shadow">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to see your Aptitude Report</p>
          <p className="text-sm text-slate-500 mb-4">See how your practice would score on the real CBAT, and what to work on next.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors no-underline">Sign In</Link>
        </div>
      </div>
    )
  }

  const verdict = reportVerdict(report ?? {})
  const showHelp = helpOpen ?? (report?.score == null)

  return (
    <div>
      <SEO title="Aptitude Report" description="See how your CBAT practice would score against a real RAF role cutoff." />

      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl font-extrabold text-slate-900">Aptitude Report</h1>
        <Link to="/cbat" className="text-sm text-slate-500 hover:text-brand-600 transition-colors shrink-0">CBAT Aptitude Practise &rarr;</Link>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        An estimate of how you&apos;d score on the real CBAT, and what to practise next.
      </p>

      {/* Admin: whose report this is. Amber, and stated in full — an admin who forgets they're
          looking at someone else's numbers will read them as their own. */}
      {user.isAdmin && (
        <div className="flex items-center gap-3 mb-4 px-3 py-2 rounded-xl border border-amber-400/40 bg-amber-500/5">
          <span className="text-base shrink-0">👤</span>
          <p className="flex-1 min-w-0 text-xs text-slate-700 truncate">
            {viewingAs
              ? <>Viewing <span className="font-bold text-amber-700">{viewingAs.displayName || `Agent ${viewingAs.agentNumber}`}</span>&apos;s report, not your own.</>
              : <>Viewing your own report.</>}
          </p>
          {viewingAs && (
            <button type="button" onClick={() => pickUser(null)} className="shrink-0 text-xs font-bold text-slate-600 hover:text-brand-700 transition-colors">
              Back to me
            </button>
          )}
          <button
            type="button"
            onClick={() => setUserPickerOpen(o => !o)}
            className="shrink-0 px-3 py-1.5 rounded-lg border border-amber-400/60 text-amber-700 hover:bg-amber-500/10 text-xs font-bold transition-colors"
          >
            {userPickerOpen ? 'Close' : 'View as…'}
          </button>
        </div>
      )}

      {user.isAdmin && userPickerOpen && (
        <AdminUserPicker current={viewingId} onPick={pickUser} onClose={() => setUserPickerOpen(false)} />
      )}

      {/* Role bar. One line: which role the numbers below are being judged against, and the way to
          change it. It was three lines and a label, which is a lot of chrome to cross before
          reaching the score it introduces.
          
          Reworded when an admin is reading someone else's report: the role on show is that
          player's choice, and calling it the one "you're" aiming for would read as the admin's
          own. An unchosen role is said plainly rather than left to look like a decision, because
          an admin reading our default as the player's goal would draw the wrong conclusion from
          every number under it. */}
      <div className="flex items-center gap-3 mb-4">
        <p className="flex-1 min-w-0 text-sm text-slate-600 truncate">
          {viewingAs ? 'This player is aiming for ' : 'Aiming for '}
          <span className="font-extrabold text-slate-900">{report?.label ?? BATTERY_BY_KEY[selected]?.label ?? '-'}</span>
          {viewingAs && !targetBattery && (
            <span className="text-amber-700"> (not chosen yet, so this is the first role on the sheet)</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => setPickerOpen(o => !o)}
          className="shrink-0 px-4 py-2 rounded-lg border border-brand-400 text-brand-700 hover:bg-brand-50 text-xs font-bold transition-colors"
        >
          {pickerOpen ? 'Close' : 'Change role'}
        </button>
      </div>

      {pickerOpen && summary && (
        <RolePicker
          batteries={summary.batteries}
          selected={selected}
          targetBattery={targetBattery}
          onSelect={selectRole}
          onSetTarget={setTarget}
          onClose={() => setPickerOpen(false)}
          canSetTarget={!viewingAs}
        />
      )}

      {loading && <p className="text-sm text-slate-400 py-8 text-center">Working out your score...</p>}
      {error && !loading && <p className="text-sm text-[#e58b85] py-8 text-center">{error}</p>}

      {report && !loading && (
        <>
          {/* Headline — the sheet's Score box and its PASS/FAIL ribbon. */}
          <div className="bg-surface border border-slate-200 rounded-2xl overflow-hidden mb-5 card-shadow">
            <div className="flex">
              {/* The ribbon down the left edge, exactly where the real sheet puts it. */}
              <div
                className={`w-8 sm:w-10 shrink-0 flex items-center justify-center ${
                  report.status === 'pass' ? 'bg-[#2f7d5b]' : report.status === 'fail' ? 'bg-[#a34a45]' : 'bg-[#1a3a5c]'
                }`}
              >
                <span className="text-white text-[11px] font-extrabold tracking-[0.3em] uppercase" style={{ writingMode: 'vertical-rl' }}>
                  {report.status === 'unscored' ? 'no score' : report.status === 'provisional' ? 'partial' : report.status}
                </span>
              </div>

              <div className="flex-1 min-w-0 p-4 sm:p-5">
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide">
                      {report.score != null && report.firm === false ? 'Your score is somewhere in here'
                        : report.status === 'provisional' ? 'Estimated so far'
                        : 'Your estimated score'}
                    </p>
                    {/* A range until every game behind it has a full three runs, then a single
                        number. One run tells us something and it is not nothing, but it is not a
                        point either, and printing a lone 120 off one evening would be a made-up
                        precision the user would then watch move thirty points. The range only ever
                        narrows, so it reads as progress rather than as the number changing its
                        mind. */}
                    <p data-testid="aptitude-report-score" className="font-mono font-extrabold text-4xl sm:text-5xl text-slate-900 leading-none">
                      {report.score == null ? '-'
                        : report.firm === false
                          ? <>{report.scoreLow}<span className="text-slate-600">-</span>{report.scoreHigh}</>
                          : report.score}
                      <span className="text-lg text-slate-600 font-bold"> / {MAX_SCORE}</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide">Pass mark</p>
                    <p className="font-mono font-extrabold text-2xl text-slate-700 leading-none">{report.cutoff}</p>
                  </div>
                  <div className="min-w-0">
                    <p className={`text-sm font-extrabold ${TONE_TEXT[verdict.tone]}`}>{verdict.label}</p>
                    <p className="text-[11px] text-slate-600">{verdict.blurb}</p>
                  </div>
                </div>

                {/* Score track with the cutoff marked. */}
                <div className="relative mt-4 h-3 bg-[#060e1a] border border-[#1a3a5c] rounded-sm overflow-hidden">
                  <motion.div
                    className="absolute inset-y-0 left-0"
                    style={{ background: statusColour(report.status), opacity: 0.9 }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, ((report.score ?? 0) / MAX_SCORE) * 100)}%` }}
                    transition={{ duration: 0.7, ease: 'easeOut' }}
                  />
                  {/* The uncertainty, drawn where it belongs: a hatched tail running from the low
                      end of the range to the high one. The solid fill still stops at the middle
                      estimate, so the eye reads "about here, could be anywhere across that". It
                      disappears of its own accord once every game has three runs behind it. */}
                  {report.firm === false && report.scoreHigh > report.scoreLow && (
                    <motion.div
                      className="absolute inset-y-0"
                      style={{
                        left: `${(report.scoreLow / MAX_SCORE) * 100}%`,
                        background: `repeating-linear-gradient(135deg, ${statusColour(report.status)} 0 3px, transparent 3px 6px)`,
                        opacity: 0.75,
                      }}
                      initial={{ width: 0 }}
                      animate={{ width: `${((report.scoreHigh - report.scoreLow) / MAX_SCORE) * 100}%` }}
                      transition={{ duration: 0.7, ease: 'easeOut' }}
                      title={`Somewhere between ${report.scoreLow} and ${report.scoreHigh}`}
                    />
                  )}
                  <div
                    className="absolute inset-y-0 w-[2px] bg-[#ff4d4d]"
                    style={{ left: `calc(${(report.cutoff / MAX_SCORE) * 100}% - 1px)` }}
                    title={`Cutoff ${report.cutoff}`}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-slate-600 font-mono mt-1">
                  <span>0</span><span>{MAX_SCORE}</span>
                </div>

                {/* The range in the unit the user can actually do something about. A percentage is
                    abstract; "11 of 45 runs" is an evening's play, and it is the only caption that
                    explains why the number above it is a range rather than a figure. */}
                {report.firm === false && report.score != null && (
                  <p className="text-[11px] text-slate-600 mt-3">
                    Based on <span className="font-bold text-slate-700">{report.runsBanked} of {report.runsForFirmScore} runs</span>.
                    {' '}Every run you bank narrows the range, and at {report.runsForFirmScore} it becomes a single number.
                  </p>
                )}
                <p className="text-[11px] text-slate-600 mt-3">
                  {report.coverage === 100
                    ? <>We can measure <span className="font-bold text-slate-700">everything</span> this role is tested on.</>
                    : <>We can measure <span className="font-bold text-slate-700">{report.coverage}%</span> of what this role is
                       tested on. The rest is greyed out below.</>}
                </p>
                {report.note && <p className="text-[11px] text-brand-700 mt-1">{report.note}</p>}
              </div>
            </div>
          </div>

          {/* Focus — the ranked answer to "what do I do next?" */}
          {report.focus.length > 0 && (
            <div className="bg-surface border border-slate-200 rounded-2xl p-4 mb-5 card-shadow">
              <h2 className="text-sm font-extrabold text-slate-900 mb-0.5">Play these next</h2>
              <p className="text-[11px] text-slate-600 mb-3">
                Ranked by what helps you most right now. A % is a test we cannot measure yet, and playing it is what
                lets us judge your score. A number is roughly the points it adds. Only Hard runs count, so these open
                on Hard.
              </p>
              <div className="space-y-1.5">
                {report.focus.map((f) => {
                  const test = report.domains.flatMap(d => d.tests).find(t => t.code === f.code)
                  const game = test?.games?.[0]
                  return (
                    <div key={`${f.domainKey}-${f.code}`} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#060e1a] border border-[#1a3a5c]">
                      {/* One currency per kind, and it is the one the row was ranked on. Points for
                          a scored test, because there is a base to express them against. Coverage for
                          a test we cannot measure yet, because its points would rest on a stanine we
                          have never seen, and the share of the role it opens up is a certainty. */}
                      <span className="font-mono font-extrabold text-emerald-300 text-sm w-12 shrink-0">
                        {f.kind === 'unlock' ? `+${f.coverageGain}%` : `+${f.gain}`}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-bold text-slate-800 truncate">
                          {game ? `${gameEmoji(game)} ${gameTitle(game)}` : f.label}
                        </span>
                        <span className="block text-[10px] text-slate-600 truncate">
                          {f.kind === 'unlock'
                            ? (f.easierOnly
                                ? `Play it on Hard and it starts counting. Helps your ${f.domainLabel}.`
                                // A test already part-played is counting; what its remaining runs
                                // buy is certainty, not entry, so it must not be told to "start"
                                // something it started last night.
                                : `Play it${onHard(game)} ${f.needsRuns?.[0]?.runsNeeded ?? 3} more time${(f.needsRuns?.[0]?.runsNeeded ?? 3) === 1 ? '' : 's'} ${f.stanine == null ? 'and it starts counting' : 'to settle it and narrow your range'}. Helps your ${f.domainLabel}.`)
                            : f.nextTarget
                              ? `Average ${f.nextTarget.score}+ across 3 goes${onHard(game)} to go from level ${Math.round(f.stanine)} to ${Math.round(f.stanine) + 1}. Helps your ${f.domainLabel}.`
                              : `You're on level ${Math.round(f.stanine)}. Helps your ${f.domainLabel}.`}
                        </span>
                      </span>
                      {game && (
                        <Link
                          to={gamePath(game)}
                          title={gameHasDifficulties(game)
                            ? `Opens ${gameTitle(game)} with Hard already selected. Only Hard runs count towards this report.`
                            : `Opens ${gameTitle(game)}.`}
                          className="shrink-0 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[11px] font-bold transition-colors no-underline"
                        >
                          Play
                        </Link>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* The sheet. */}
          <div className="bg-surface border border-slate-200 rounded-2xl overflow-hidden mb-5 card-shadow">
            <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 bg-[#060e1a] border-b border-[#1a3a5c] text-[10px] text-slate-500 uppercase tracking-wide font-bold">
              <span className="w-3 shrink-0" />
              <span className="w-[104px] sm:w-[150px] shrink-0">Skill area</span>
              <span className="flex-1 min-w-0"><StanineScale /></span>
              <span className="w-7 text-right">Lvl</span>
              <span className="hidden sm:block w-[104px] lg:w-[132px] shrink-0 text-right">Weighting</span>
            </div>
            {report.domains.map(d => (
              <DomainRow key={d.key} domain={d} targetStanine={targetStanine} />
            ))}
          </div>

          <p className="text-[11px] text-slate-600 mb-5">
            <span className="inline-block w-[2px] h-3 bg-[#ff4d4d] align-middle mr-1.5" />
            The red line is level {targetStanine ? Math.round(targetStanine * 10) / 10 : '-'}. Reach it in every skill area and
            you land exactly on this role&apos;s pass mark. The chips under each row are the games that feed it: tap one to
            play it, or tap the row itself for your average on each.
          </p>

          {/* Gaps. */}
          {report.gaps?.length > 0 && (
            <div className="bg-surface border border-slate-200 rounded-2xl p-4 mb-5 card-shadow">
              <h2 className="text-sm font-extrabold text-slate-900 mb-0.5">Tests we don&apos;t have a game for</h2>
              <p className="text-[11px] text-slate-600 mb-3">
                You&apos;ll sit these on the day, but we have no game for them yet, so we leave them out rather than guess
                at them. It is why your score covers part of this role and not all of it.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {report.gaps.map(g => (
                  <span
                    key={g.code}
                    className="px-2.5 py-1 rounded-lg bg-[#0d1a2b] border border-[#1a3a5c] text-[11px] opacity-60"
                    title={g.label}
                  >
                    <span className="font-mono font-bold text-slate-600">{g.code}</span>
                    <span className="text-slate-600"> · {g.domains.join(', ')}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Not small print: the page is worthless, and misleading, if it is mistaken for a result.
              Written for someone who has never sat the CBAT and may not know what a stanine is. */}
          <div className="border border-[#1a3a5c] rounded-2xl p-4 bg-[#060e1a]">
            <button
              type="button"
              onClick={() => setHelpOpen(!showHelp)}
              className="w-full flex items-center justify-between gap-3 text-left"
            >
              <h2 className="text-xs font-extrabold text-slate-700 uppercase tracking-wide">New to this? Start here</h2>
              <span className="text-[10px] font-bold text-brand-700 shrink-0">{showHelp ? 'Hide' : 'Show'}</span>
            </button>
            {showHelp && (
            <ul className="text-[11px] text-slate-600 space-y-2.5 list-none pl-0 mt-3">
              <li>
                <span className="block text-slate-700 font-bold mb-0.5">How the real CBAT works</span>
                You sit the tests once and get one score out of 180. That score is checked against the pass mark for every
                RAF role, and each role has a different one. So a single score can pass you for one job and fail you for
                another. There is no overall CBAT pass.
              </li>
              <li>
                <span className="block text-slate-700 font-bold mb-0.5">What the 1 to 9 levels mean</span>
                Each skill area is scored 1 to 9. This is called a stanine. 5 is dead average, most people land between 4
                and 6, and 7 or above puts you in the top quarter.
                {report.score != null && (
                  <> Yours averages out at about {Math.round((report.score / MAX_SCORE) * MAX_STANINE * 10) / 10},
                  which puts you ahead of roughly {stanineBeatsPct((report.score / MAX_SCORE) * MAX_STANINE)}% of
                  other SkyWatch players.</>
                )}
              </li>
              <li>
                <span className="block text-slate-700 font-bold mb-0.5">Why some rows are greyed out</span>
                A greyed row is a test that isn&apos;t counting yet. Nearly always that just means you haven&apos;t played
                its game enough: three goes on Hard and it starts counting.
                {report.gaps?.length > 0 && (
                  <> The exception{report.gaps.length === 1 ? ' is the test' : 's are the tests'} listed further up under
                  &ldquo;Tests we don&apos;t have a game for&rdquo;, which {report.gaps.length === 1 ? 'is' : 'are'} on
                  this role&apos;s paper but {report.gaps.length === 1 ? 'has' : 'have'} no SkyWatch game yet.</>
                )}
                {' '}Either way we leave it out of your score instead of guessing, so your number only reflects what we
                can actually measure.
              </li>
              <li>
                <span className="block text-slate-700 font-bold mb-0.5">We use your recent scores, not your best</span>
                Each game counts the average of your last 3 goes, so you need 3 goes before it counts at all. On the
                day you get one attempt, so your best ever score from fifty tries is not what you would walk in and repeat.
                Only Hard difficulty counts, because the real test has one setting.
              </li>
            </ul>
            )}

            {/* Never behind the toggle. The page is worthless, and actively misleading, if it is
                mistaken for a real result, so the one paragraph that says so is not something a
                reader can collapse away. */}
            <p className={`text-[11px] text-slate-600 ${showHelp ? 'mt-3 pt-3 border-t border-[#12293f]' : 'mt-3'}`}>
              <span className="block text-slate-700 font-bold mb-0.5">This is a practice estimate, not a real result</span>
              Our games are our own versions of the CBAT tests, not the RAF&apos;s. The role weightings and pass marks come
              from real score sheets, but your levels are worked out by comparing you to other SkyWatch players, not to
              real RAF candidates. Treat it as a guide to what to practise, not a prediction.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
