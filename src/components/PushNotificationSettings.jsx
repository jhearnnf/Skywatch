import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { deviceStatus, enableOnDevice, disableOnDevice, pushKind } from '../lib/pushNotifications'

// Profile › Settings card for phone and desktop notifications.
//
// Two layers, shown in that order because the second means nothing without
// the first:
//   1. This device: on or off. Asking the OS for permission happens here.
//   2. What to be notified about. Saved to the account, so it applies to
//      every device that has notifications on.

// How long the "can this device do push" check may take before the button
// is made usable anyway.
const CHECK_TIMEOUT_MS = 8000

// Mirrors User.pushPrefs defaults on the server.
const DEFAULTS = {
  dms: true, replies: true, mentions: true, reactions: true,
  lounge: false, general: false, updates: false,
}

const ABOUT_YOU = [
  { key: 'dms',       label: 'Direct messages', hint: 'When someone sends you a direct message, or the team replies to your support ticket.' },
  { key: 'replies',   label: 'Replies',         hint: 'When someone replies to one of your messages.' },
  { key: 'mentions',  label: 'Mentions',        hint: 'When someone mentions you with @ and your name.' },
  { key: 'reactions', label: 'Emoji reactions', hint: 'When someone reacts to one of your messages with an emoji.' },
]

const ROOMS = [
  { key: 'lounge',  label: 'CBAT Lounge', hint: 'The live chat beside the CBAT games.' },
  { key: 'general', label: 'General',     hint: 'The main Community room.' },
  { key: 'updates', label: 'Updates',     hint: 'Posts from the SkyWatch team.' },
]

function Switch({ on, disabled, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`shrink-0 inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors disabled:opacity-50
        ${on ? 'bg-brand-600' : 'bg-slate-200'}`}
    >
      <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  )
}

function PrefRow({ item, on, busy, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-700">{item.label}</p>
        <p className="text-[11px] text-slate-400">{item.hint}</p>
      </div>
      <Switch on={on} disabled={busy} onChange={onChange} label={item.label} />
    </div>
  )
}

export default function PushNotificationSettings() {
  const { user, setUser, API, apiFetch } = useAuth()
  const [status, setStatus]   = useState(pushKind() ? 'checking' : 'unavailable')
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [error, setError]     = useState('')
  const [savingKey, setSavingKey] = useState(null)

  const prefs = { ...DEFAULTS, ...(user?.pushPrefs ?? {}) }

  useEffect(() => {
    if (!pushKind()) return
    let alive = true
    // Never leave the button greyed out on a check that failed or stalled:
    // fall back to "off", and turning it on reports any real problem.
    const fallback = setTimeout(() => { if (alive) setStatus(s => (s === 'checking' ? 'off' : s)) }, CHECK_TIMEOUT_MS)
    deviceStatus({ API, apiFetch })
      .then(s => { if (alive) setStatus(s) })
      .catch(() => { if (alive) setStatus('off') })
      .finally(() => clearTimeout(fallback))
    return () => { alive = false; clearTimeout(fallback) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API])

  const turnOn = async () => {
    setDeviceBusy(true)
    setError('')
    try {
      setStatus(await enableOnDevice({ API, apiFetch }))
    } catch {
      setError('Something went wrong turning notifications on. Please try again.')
    } finally {
      setDeviceBusy(false)
    }
  }

  const turnOff = async () => {
    setDeviceBusy(true)
    setError('')
    await disableOnDevice({ API, apiFetch })
    setStatus('off')
    setDeviceBusy(false)
  }

  const changePref = async (key, value) => {
    if (savingKey) return
    setSavingKey(key)
    // Shown straight away; put back if the save fails.
    const before = user
    setUser({ ...user, pushPrefs: { ...prefs, [key]: value } })
    try {
      const res = await apiFetch(`${API}/api/users/me/push-prefs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      })
      const data = await res.json()
      if (!res.ok || !data?.data?.user) throw new Error('save failed')
      setUser(data.data.user)
    } catch {
      setUser(before)
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div data-testid="push-notification-settings" className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Push Notifications</p>
      <p className="text-[11px] text-slate-400 mb-3">
        Get a notification on this device when something happens in Community, even when SkyWatch
        is closed.
      </p>

      {/* This device */}
      {status === 'on' && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-brand-50 border border-brand-200 px-3 py-2.5">
          <p className="text-sm font-semibold text-brand-700">🔔 On for this device</p>
          <button
            onClick={turnOff}
            disabled={deviceBusy}
            className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 hover:border-brand-300 disabled:opacity-50 transition-colors"
          >
            Turn off
          </button>
        </div>
      )}
      {(status === 'off' || status === 'checking') && (
        <button
          onClick={turnOn}
          disabled={deviceBusy || status === 'checking'}
          className="w-full py-2.5 rounded-xl text-sm font-bold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {deviceBusy ? 'Turning on…' : '🔔 Turn on for this device'}
        </button>
      )}
      {status === 'blocked' && (
        <p className="text-[11px] text-slate-500 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
          Notifications for SkyWatch are blocked in this device&apos;s settings. Allow them there, then
          come back to this page.
        </p>
      )}
      {status === 'unavailable' && (
        <p className="text-[11px] text-slate-500 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
          This device can&apos;t get notifications from SkyWatch. They work in the Android app, and in
          the SkyWatch web app once it is installed on your phone or computer.
        </p>
      )}
      {error && <p className="text-xs text-rose-600 font-semibold mt-2">{error}</p>}

      {/* What to be notified about */}
      <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-[0.15em] mt-4">About you</p>
      <div className="divide-y divide-slate-100">
        {ABOUT_YOU.map(item => (
          <PrefRow key={item.key} item={item} on={prefs[item.key]} busy={savingKey === item.key}
            onChange={v => changePref(item.key, v)} />
        ))}
      </div>

      <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-[0.15em] mt-3">Every new message in</p>
      <div className="divide-y divide-slate-100">
        {ROOMS.map(item => (
          <PrefRow key={item.key} item={item} on={prefs[item.key]} busy={savingKey === item.key}
            onChange={v => changePref(item.key, v)} />
        ))}
      </div>

      <p className="text-[11px] text-slate-400 mt-2">
        These choices apply to every device you have turned notifications on for.
      </p>
    </div>
  )
}
