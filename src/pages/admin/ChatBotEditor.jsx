import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'

function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

// Upload the guide the chat bot answers from.
//
// This exists because the guide lives in APPLICATION_INFO/, which is gitignored
// AND outside backend/ — and Railway ships only backend/. A bot that read the
// file off disk would work perfectly on your machine and answer nothing at all
// in production. Uploading it into Mongo is what makes it exist in prod, and it
// means refreshing the guide never needs a deploy.
export default function ChatBotEditor({ API, Toast }) {
  const { apiFetch } = useAuth()
  const fileRef = useRef(null)

  const [knowledge, setKnowledge] = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [busy,      setBusy]      = useState(false)
  const [err,       setErr]       = useState('')
  const [toast,     setToast]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch(`${API}/api/chat/admin/bot/knowledge`, { credentials: 'include' })
      const d = await r.json().catch(() => null)
      setKnowledge(d?.data?.knowledge ?? null)
    } finally {
      setLoading(false)
    }
  }, [API, apiFetch])

  useEffect(() => { load() }, [load])

  const upload = async (file) => {
    if (!file || busy) return
    setBusy(true); setErr('')
    try {
      const html = await file.text()
      const r = await apiFetch(`${API}/api/chat/admin/bot/knowledge`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, html }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.message || 'Could not read that file')
      await load()
      setToast('Guide uploaded')
    } catch (e) {
      setErr(e.message || 'Could not read that file')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const stats = knowledge?.stats ?? {}

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-400">
        The bot answers only from the guide uploaded here, and refuses anything it does not
        cover. Admins can message it from Community; it is not in any channel yet.
      </p>

      <div className="rounded-xl border border-slate-300 p-3 space-y-2">
        <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Current guide</p>
        {loading && <p className="text-xs text-slate-400">Loading…</p>}
        {!loading && !knowledge && (
          <p className="text-xs text-slate-400">
            Nothing uploaded yet, so the bot has nothing to answer from.
          </p>
        )}
        {!loading && knowledge && (
          <div className="text-[11px] text-slate-400 space-y-0.5">
            <p className="text-sm font-bold text-slate-800">
              {knowledge.sourceFilename || knowledge.title}
            </p>
            <p>
              {stats.tests ?? 0} tests · {stats.facts ?? 0} facts ·{' '}
              {Math.round((stats.corpusChars ?? 0) / 1000)}k characters
            </p>
            <p>Uploaded {fmtDate(knowledge.updatedAt)}</p>
            {(stats.sectionsMissing ?? []).length > 0 && (
              <p className="text-amber-600">
                Missing sections: {stats.sectionsMissing.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <input
          ref={fileRef}
          type="file"
          accept=".html,.htm,text/html"
          onChange={e => upload(e.target.files?.[0])}
          disabled={busy}
          className="block w-full text-xs text-slate-500 file:mr-3 file:px-4 file:py-2 file:rounded-xl file:border-0 file:bg-brand-600 file:text-white file:text-sm file:font-bold hover:file:bg-brand-700 file:cursor-pointer disabled:opacity-50"
        />
        <p className="text-[11px] text-slate-400 mt-2">
          Upload the public guide HTML. Replacing it takes effect on the bot&rsquo;s next reply —
          no deploy needed.
        </p>
        {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
        {busy && <p className="text-xs text-slate-400 mt-2">Reading and parsing…</p>}
      </div>

      {Toast && <Toast msg={toast} onClear={() => setToast('')} />}
    </div>
  )
}
