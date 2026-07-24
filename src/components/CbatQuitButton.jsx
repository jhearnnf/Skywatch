import { useEffect, useRef, useState } from 'react'
import Overlay from './ui/Overlay'

// Confirmation shown before the back-to-instructions button abandons a game
// that is actively in progress.
function QuitConfirmModal({ open, onCancel, onConfirm }) {
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null
  return (
    <Overlay zIndex={100} backdrop="rgba(0,0,0,0.70)" onDismiss={onCancel} className="flex items-center justify-center px-4" data-testid="cbat-quit-modal">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cbat-quit-title"
        className="w-full max-w-sm rounded-2xl border border-slate-300/20 bg-surface p-5 flex flex-col gap-3"
      >
        <h2 id="cbat-quit-title" className="text-base font-bold text-text">
          Quit this game?
        </h2>
        <p className="text-sm text-text-muted leading-relaxed">
          Going back to the instructions ends the game you&#39;re playing and this score won&#39;t be saved.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            data-testid="cbat-quit-cancel"
            className="px-4 py-2 rounded-btn text-sm font-semibold text-brand-600 border border-brand-600/40 hover:bg-brand-600/10 transition-colors"
          >
            Keep Playing
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="cbat-quit-confirm"
            className="px-4 py-2 rounded-btn text-sm font-semibold text-white bg-danger hover:opacity-90 transition-opacity"
          >
            Quit Game
          </button>
        </div>
      </div>
    </Overlay>
  )
}

/**
 * The back-to-instructions link in a CBAT game header. When a game is actively
 * in progress (`confirmNeeded`), clicking asks the player to confirm before
 * quitting, since leaving abandons the current game and its unsaved score.
 * Otherwise it behaves exactly like the plain button it replaces.
 *
 * The default label (&larr; Instructions) matches every game header; pass
 * `label` for the odd one out (e.g. Trace's "Quit").
 *
 * While `confirmNeeded` is true the component also traps the mobile back
 * gesture / Android hardware back button so it can't silently abandon the
 * game — it routes the back press through the same prompt (see the effect
 * below). Navigating `/cbat` -> `/cbat/<game>` already gives the second-level
 * "instructions -> CBAT menu" back step for free, so we only guard the first
 * level (playing -> instructions).
 */
export default function CbatQuitButton({ onConfirm, confirmNeeded = false, label }) {
  const [confirming, setConfirming] = useState(false)

  // Whether our extra history entry is currently on the stack, and any pending
  // removal of it. Kept in refs so they survive a React StrictMode remount
  // (mount -> cleanup -> mount) as a single continuous guard.
  const guardActiveRef  = useRef(false)
  const removalTimerRef = useRef(null)

  function handleClick() {
    if (confirmNeeded) setConfirming(true)
    else onConfirm()
  }

  // Back-gesture guard, live only while a game is in progress. We push one
  // extra history entry so a back press pops that instead of leaving the page;
  // the popstate handler re-holds the position and opens the quit prompt. On
  // confirm the game returns to its instructions screen (via `onConfirm`),
  // which unmounts this button and the cleanup drops the guard entry — leaving
  // a clean stack where the next back press falls through to the CBAT menu.
  useEffect(() => {
    if (!confirmNeeded) return
    const guardPath = window.location.pathname

    // A synchronous StrictMode remount (or a quick re-enter) arrives with a
    // removal still pending from the just-torn-down instance. Cancel it and
    // reuse the guard entry that is still on the stack, rather than popping and
    // re-pushing — the pop would fire a spurious popstate and prompt on entry.
    if (removalTimerRef.current !== null) {
      clearTimeout(removalTimerRef.current)
      removalTimerRef.current = null
    }
    if (!guardActiveRef.current) {
      window.history.pushState(window.history.state, '')
      guardActiveRef.current = true
    }

    function onPop() {
      // The user popped our guard entry — re-hold the position and ask, rather
      // than letting the game be abandoned.
      guardActiveRef.current = false
      window.history.pushState(window.history.state, '')
      guardActiveRef.current = true
      setConfirming(true)     // no-op if the prompt is already open
    }
    window.addEventListener('popstate', onPop)

    return () => {
      window.removeEventListener('popstate', onPop)
      // Drop the guard entry when play ends — but only if we're still on the
      // same page (don't hijack a real navigation). Deferred so a synchronous
      // StrictMode remount can cancel it above and keep the single guard.
      if (guardActiveRef.current && window.location.pathname === guardPath) {
        removalTimerRef.current = setTimeout(() => {
          removalTimerRef.current = null
          guardActiveRef.current = false
          window.history.back()
        }, 0)
      }
    }
  }, [confirmNeeded])

  return (
    <>
      <button
        onClick={handleClick}
        className="text-slate-500 hover:text-brand-400 transition-colors text-sm bg-transparent border-0 p-0 cursor-pointer"
      >
        {label ?? <>&larr; Instructions</>}
      </button>
      <QuitConfirmModal
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); onConfirm() }}
      />
    </>
  )
}
