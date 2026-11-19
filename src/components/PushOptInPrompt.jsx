import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Overlay from './ui/Overlay'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { useGameChrome } from '../context/GameChromeContext'
import { deviceStatus, enableOnDevice, pushKind } from '../lib/pushNotifications'
import { canShowInAppNotice } from '../utils/inAppNoticeRoutes'
import { hasSeenPushPrompt, markPushPromptSeen, anotherDialogIsOpen } from '../utils/pushPrompt'

// The one-time "Get notified about messages?" card. Asked once per device,
// so players can opt in straight after updating instead of having to find the
// switch in Profile > Settings (which stays the place to change it later).
//
// Timing rules, so it never gets in the way:
//  - only on screens on the in-app banner allowlist and never mid-game
//    (the same hard rule; see utils/inAppNoticeRoutes.js)
//  - only once nothing else is open (release notes, tutorials, any dialog)
//  - only on a device that could turn notifications on and has not yet
//
// Answering either way, or the device already being on or blocked, means it
// is never shown again on this device.

const FIRST_DELAY_MS = 4000
const RECHECK_MS     = 2000

export default function PushOptInPrompt() {
  const { user, API, apiFetch } = useAuth()
  const { settings } = useAppSettings() ?? {}
  const { immersive } = useGameChrome()
  const { pathname } = useLocation()

  const [eligible, setEligible] = useState(false)   // device is 'off' and not yet asked
  const [open, setOpen]         = useState(false)
  const [phase, setPhase]       = useState('ask')   // ask | busy | on | blocked | error

  const userId = user?._id ?? null
  const chatOn = settings?.chatEnabled !== false
  const allowedHere = canShowInAppNotice(pathname, { immersive })

  // Work out once per signed-in account whether this device should be asked.
  useEffect(() => {
    if (!userId || !chatOn || !pushKind() || hasSeenPushPrompt()) return
    let alive = true
    deviceStatus({ API, apiFetch }).then((status) => {
      if (!alive) return
      if (status === 'off') setEligible(true)
      // Already decided at the OS level: nothing to ask, ever.
      else if (status === 'on' || status === 'blocked') markPushPromptSeen()
      // 'unavailable' is left unmarked: the server may just not be set up yet.
    }).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, chatOn])

  // Wait for a calm moment on an allowed screen.
  useEffect(() => {
    if (!eligible || open || !allowedHere) return
    let timer = null
    const attempt = () => {
      if (anotherDialogIsOpen()) { timer = setTimeout(attempt, RECHECK_MS); return }
      setOpen(true)
    }
    timer = setTimeout(attempt, FIRST_DELAY_MS)
    return () => clearTimeout(timer)
  }, [eligible, open, allowedHere])

  // Moving into a game (or any off-list screen) puts it away; it comes back
  // on the next allowed screen unless it has been answered.
  const visible = open && allowedHere

  const close = () => {
    markPushPromptSeen()
    setEligible(false)
    setOpen(false)
  }

  const turnOn = async () => {
    setPhase('busy')
    try {
      const result = await enableOnDevice({ API, apiFetch })
      if (result === 'on') setPhase('on')
      else if (result === 'blocked') setPhase('blocked')
      else setPhase('error')
    } catch {
      setPhase('error')
    }
  }

  if (!visible) return null

  return (
    <Overlay zIndex={9500} onDismiss={phase === 'busy' ? undefined : close} data-testid="push-opt-in-prompt">
      <div className="flex h-full items-center justify-center px-4">
        <div role="dialog" aria-modal="true" aria-labelledby="push-opt-in-title"
          className="w-full max-w-sm bg-surface rounded-2xl border border-slate-200 card-shadow p-5 text-center">
          <p className="text-3xl mb-2" aria-hidden="true">🔔</p>

          {(phase === 'ask' || phase === 'busy') && (
            <>
              <p id="push-opt-in-title" className="text-base font-extrabold text-slate-800 mb-2">
                Get notified about messages?
              </p>
              <p className="text-sm text-slate-500 mb-1">
                SkyWatch can send you a notification when someone sends you a direct message, replies
                to you, mentions you or reacts to one of your messages.
              </p>
              <p className="text-[11px] text-slate-400 mb-4">
                You can change this any time in Profile &gt; Settings.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={close}
                  disabled={phase === 'busy'}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-slate-50 border border-slate-200 text-slate-600 hover:border-brand-300 disabled:opacity-50 transition-colors"
                >
                  Not now
                </button>
                <button
                  onClick={turnOn}
                  disabled={phase === 'busy'}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  {phase === 'busy' ? 'Turning on…' : 'Turn on'}
                </button>
              </div>
            </>
          )}

          {phase !== 'ask' && phase !== 'busy' && (
            <>
              <p id="push-opt-in-title" className="text-base font-extrabold text-slate-800 mb-2">
                {phase === 'on' && 'Notifications are on'}
                {phase === 'blocked' && 'Notifications are blocked'}
                {phase === 'error' && 'That did not work'}
              </p>
              <p className="text-sm text-slate-500 mb-4">
                {phase === 'on' && 'You can choose which ones you get in Profile > Settings.'}
                {phase === 'blocked' && 'Notifications for SkyWatch are turned off in your device settings. Allow them there, then turn them on in Profile > Settings.'}
                {phase === 'error' && 'Something went wrong. You can try again from Profile > Settings.'}
              </p>
              <button
                onClick={close}
                className="w-full py-2.5 rounded-xl text-sm font-bold bg-brand-600 text-white hover:bg-brand-700 transition-colors"
              >
                OK
              </button>
            </>
          )}
        </div>
      </div>
    </Overlay>
  )
}
