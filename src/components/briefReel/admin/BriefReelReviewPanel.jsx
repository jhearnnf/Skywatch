import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../../context/AuthContext';
import BriefReelPlayer from '../BriefReelPlayer';

// Admin review queue for Brief Reels. Lists all reels in 'pending' state with
// their brief title + section body snapshot; clicking a row opens a modal
// where the admin watches the reel and chooses Publish or Discard. Discard
// deletes the reel — the next click of the user-facing button regenerates a
// fresh one with the current section body.
export default function BriefReelReviewPanel() {
  const { API, apiFetch } = useAuth();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [active,  setActive]  = useState(null);  // row being reviewed
  const [busy,    setBusy]    = useState(false);
  const [toast,   setToast]   = useState('');

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`${API}/api/brief-reels/admin/pending`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { data: { rows: [] } })
      .then(d => setRows(d?.data?.rows ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [API, apiFetch]);

  useEffect(() => { load(); }, [load]);

  const publish = async (row) => {
    setBusy(true);
    try {
      const res = await apiFetch(`${API}/api/brief-reels/admin/${row._id}/publish`, {
        method: 'POST', credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setToast('✓ Reel published');
      setActive(null);
      load();
    } catch (err) {
      setToast(`✗ Publish failed: ${err.message}`);
    } finally { setBusy(false); }
  };

  const discard = async (row) => {
    if (!window.confirm('Discard this reel? Next click of the user-facing button will trigger a fresh AI generation.')) return;
    setBusy(true);
    try {
      const res = await apiFetch(`${API}/api/brief-reels/admin/${row._id}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setToast('✓ Reel discarded');
      setActive(null);
      load();
    } catch (err) {
      setToast(`✗ Discard failed: ${err.message}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-surface p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-700">Brief Reel — Review Queue</h3>
          <p className="text-xs text-slate-400">Pending reels need admin approval before they show to users.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 px-2 py-1 rounded-md hover:bg-brand-50"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-slate-400 italic py-3">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-400 italic py-3">No pending reels.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map(r => (
            <li key={r._id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-700 truncate">{r.briefTitle}</p>
                <p className="text-xs text-slate-400 truncate">Section {r.sectionIndex + 1} · {new Date(r.generatedAt).toLocaleString()}</p>
              </div>
              <button
                type="button"
                onClick={() => setActive(r)}
                className="text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-md hover:bg-brand-700 shrink-0"
              >
                Review
              </button>
            </li>
          ))}
        </ul>
      )}

      {toast && (
        <p className={`mt-3 text-xs font-semibold ${toast.startsWith('✓') ? 'text-emerald-600' : 'text-red-500'}`}>
          {toast}
        </p>
      )}

      <AnimatePresence>
        {active && (
          <ReviewModal
            row={active}
            busy={busy}
            onClose={() => setActive(null)}
            onPublish={() => publish(active)}
            onDiscard={() => discard(active)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ReviewModal({ row, busy, onClose, onPublish, onDiscard }) {
  const [replayKey, setReplayKey] = useState(0);

  return (
    <motion.div
      className="fixed inset-0 z-[1300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      role="dialog" aria-modal="true" aria-label="Brief Reel review"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        className="bg-bg border border-brand-500/30 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 12 }}
      >
        <div className="flex items-start justify-between gap-4 p-4 border-b border-slate-700/50">
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-widest uppercase text-brand-500">Brief Reel · Section {row.sectionIndex + 1}</p>
            <h3 className="text-lg font-bold text-text truncate">{row.briefTitle}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 shrink-0 rounded-full border border-brand-500/40 text-text hover:bg-surface-raised flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="aspect-video bg-surface rounded-lg overflow-hidden border border-brand-500/20">
            <BriefReelPlayer
              key={replayKey}
              timeline={row.timeline}
              sectionBody={row.bodySnapshot}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReplayKey(k => k + 1)}
              className="text-xs font-semibold text-text bg-surface-raised border border-brand-500/30 hover:border-brand-500/60 px-3 py-1.5 rounded-md"
            >
              Replay
            </button>
          </div>

          <details className="rounded-md border border-slate-700/50 bg-surface-raised/50 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-brand-500 uppercase tracking-wider">Section body</summary>
            <p className="mt-2 text-sm text-text whitespace-pre-wrap">{row.bodySnapshot}</p>
          </details>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-700/50">
          <button
            type="button"
            disabled={busy}
            onClick={onDiscard}
            className="text-sm font-semibold text-red-500 hover:bg-red-500/10 border border-red-500/40 px-4 py-2 rounded-md disabled:opacity-40"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onPublish}
            className="text-sm font-bold bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-md disabled:opacity-40"
          >
            Publish
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
