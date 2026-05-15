import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import BriefReelButton  from './BriefReelButton';
import BriefReelPlayer  from './BriefReelPlayer';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// BriefReelSection — wraps a section's pre-rendered body (children) with the
// Brief Reel affordance: a Skywatch logo button in the bottom-right of the
// section card, an inline player below the body on desktop, and a fullscreen
// sheet on mobile. The host (BriefReader) is responsible for the feature-flag
// gate — only mount this when the flag allows for the current user.
//
// Visibility rules within this component:
//   - admin: button always renders. Click triggers generate-if-missing → play.
//   - user:  button renders only when a PUBLISHED reel is cached.
//
// `forceClose` is a version counter — bump it from the parent (e.g. on swipe)
// to collapse an active reel.

export default function BriefReelSection({
  children,        // the rendered section body (e.g. <SectionText … />)
  briefId,
  sectionIndex,
  sectionBody,     // raw body string — passed to the player for the caption strip
  isAdmin,
  apiFetch,
  onPlayChange,
  forceClose,
}) {
  const [reelInfo, setReelInfo]         = useState(null);
  const [state,    setState]            = useState('idle');
  const [showPlayer, setShowPlayer]     = useState(false);
  const [lastError, setLastError]       = useState(null);
  const [modBusy,  setModBusy]          = useState(false);
  const [activeBeatId, setActiveBeatId] = useState(null);
  // Insta-Stories tap-to-seek: bumping the version forces the player to
  // remount (via key) and restart at `seekBeatIdx`. Without the version
  // bump, clicking the bar you're already on would be a no-op.
  const [seekBeatIdx,  setSeekBeatIdx]  = useState(0);
  const [seekVersion,  setSeekVersion]  = useState(0);
  const [isMobile, setIsMobile]         = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches
  );
  const errorTimerRef = useRef(null);
  // Ref to the host-rendered body. We never replace this DOM — keyword
  // decoration, font sizes, line-heights all stay exactly as the host
  // (SectionText) drew them. The active-beat highlight is painted as a
  // separate layer via the CSS Custom Highlight API, which colours text
  // ranges without touching the DOM. This means zero layout shift on
  // open/close and zero hand-off between two different renderers.
  const bodyContainerRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 600px)');
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReelInfo(null);
    setState('idle');
    setShowPlayer(false);
    setActiveBeatId(null);

    apiFetch(`${API}/api/brief-reels/${briefId}/${sectionIndex}`, { credentials: 'include' })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 204) { setReelInfo(null); setState('idle'); return; }
        if (!res.ok)             { setReelInfo(null); setState('idle'); return; }
        const json = await res.json();
        const data = json?.data;
        if (!data) { setReelInfo(null); setState('idle'); return; }
        setReelInfo(data);
        setState('ready');
      })
      .catch(() => { if (!cancelled) { setReelInfo(null); setState('idle'); } });

    return () => { cancelled = true; };
  }, [briefId, sectionIndex, apiFetch]);

  useEffect(() => {
    if (forceClose == null) return;
    setShowPlayer(false);
    setState(prev => prev === 'playing' ? (reelInfo ? 'ready' : 'idle') : prev);
  }, [forceClose, reelInfo]);

  // Reset seek state when the reel itself changes (e.g. admin regenerates):
  // a stale seekBeatIdx pointing past the new timeline would silently freeze
  // the player on its end-of-reel recap.
  useEffect(() => {
    setSeekBeatIdx(0);
    setSeekVersion(0);
  }, [reelInfo?._id]);

  const handleSeek = useCallback((beatIdx) => {
    if (!reelInfo?.timeline) return;
    const total = reelInfo.timeline.beats?.length || 0;
    const clamped = Math.max(0, Math.min(beatIdx, total - 1));
    setSeekBeatIdx(clamped);
    setSeekVersion(v => v + 1);
  }, [reelInfo]);

  // Non-admins only see the button when a published reel exists.
  const hasPublished = reelInfo && reelInfo.status === 'published';
  const buttonVisible = isAdmin || hasPublished;

  const handleClick = useCallback(async () => {
    if (state === 'loading') return;
    if (state === 'playing') {
      setShowPlayer(false);
      setState(reelInfo ? 'ready' : 'idle');
      onPlayChange?.(false);
      return;
    }
    if (reelInfo?.timeline) {
      setShowPlayer(true);
      setState('playing');
      onPlayChange?.(true);
      return;
    }
    if (!isAdmin) return;
    setState('loading');
    try {
      const res = await apiFetch(`${API}/api/brief-reels/admin/generate`, {
        method:  'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ briefId, sectionIndex }),
      });
      if (!res.ok) {
        // Surface the backend's error message so failures aren't a silent red flash.
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `HTTP ${res.status}`);
      }
      const json = await res.json();
      const reel = json?.data?.reel;
      if (!reel?.timeline) throw new Error('No timeline returned');
      setReelInfo({ _id: reel._id, status: reel.status, timeline: reel.timeline });
      setState('ready');
    } catch (err) {
      console.error('[BriefReel] generate failed:', err.message);
      setLastError(err.message);
      setState('error');
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => {
        setState(reelInfo ? 'ready' : 'idle');
        setLastError(null);
      }, 8000);
    }
  }, [state, reelInfo, isAdmin, briefId, sectionIndex, apiFetch, onPlayChange]);

  const onComplete = useCallback(() => {
    setShowPlayer(false);
    setState('ready');
    setActiveBeatId(null);
    onPlayChange?.(false);
  }, [onPlayChange]);

  const onBeatStart = useCallback((beat) => {
    setActiveBeatId(beat?.id || null);
  }, []);

  const publishReel = useCallback(async () => {
    if (!reelInfo?._id || modBusy) return;
    setModBusy(true);
    try {
      const res = await apiFetch(`${API}/api/brief-reels/admin/${reelInfo._id}/publish`, {
        method: 'POST', credentials: 'include',
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `HTTP ${res.status}`);
      }
      setReelInfo(prev => prev ? { ...prev, status: 'published' } : prev);
    } catch (err) {
      console.error('[BriefReel] publish failed:', err.message);
      setLastError(err.message);
      setState('error');
    } finally { setModBusy(false); }
  }, [reelInfo, modBusy, apiFetch]);

  const discardReel = useCallback(async () => {
    if (!reelInfo?._id || modBusy) return;
    if (!window.confirm('Discard this reel? Next click of the button will trigger a fresh AI generation.')) return;
    setModBusy(true);
    try {
      const res = await apiFetch(`${API}/api/brief-reels/admin/${reelInfo._id}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `HTTP ${res.status}`);
      }
      setReelInfo(null);
      setShowPlayer(false);
      setState('idle');
      onPlayChange?.(false);
    } catch (err) {
      console.error('[BriefReel] discard failed:', err.message);
      setLastError(err.message);
      setState('error');
    } finally { setModBusy(false); }
  }, [reelInfo, modBusy, apiFetch, onPlayChange]);

  const playerEl = showPlayer && reelInfo?.timeline ? (
    <BriefReelPlayer
      // Including seekVersion in the key remounts the player on every seek
      // so the new startBeatIdx is honoured even when the target beat is
      // the one already showing (otherwise React would skip the effect).
      key={`${reelInfo._id}-${seekVersion}`}
      timeline={reelInfo.timeline}
      sectionBody={sectionBody}
      showCaption={isMobile}
      startBeatIdx={seekBeatIdx}
      onBeatStart={onBeatStart}
      onComplete={onComplete}
    />
  ) : null;

  const beats = reelInfo?.timeline?.beats || [];
  const activeBeatIdx = activeBeatId ? beats.findIndex(b => b.id === activeBeatId) : -1;
  const reelActive = showPlayer && !isMobile;

  // Paint the active beat's text range using the CSS Custom Highlight API.
  // The DOM stays untouched — we hand the browser a Range object plus a
  // named highlight, and ::highlight(brief-reel-active-beat) in main.css
  // colours the matched glyphs without inserting any spans. Falls back to
  // a no-op on browsers without the API (the body just dims uniformly).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    const HIGHLIGHT_KEY = 'brief-reel-active-beat';

    if (!reelActive || !activeBeatId || !bodyContainerRef.current || !sectionBody) {
      CSS.highlights.delete(HIGHLIGHT_KEY);
      return;
    }
    // Walk from the body marker, NOT the wrapper — the wrapper also contains
    // the section's <h3> heading, whose text is not part of `sectionBody`.
    // If we walked from the wrapper, the heading characters would consume
    // rawIdx against the body text and every match downstream would drift.
    const bodyEl = bodyContainerRef.current.querySelector('[data-brief-reel-body]')
      || bodyContainerRef.current;
    const beat = beats.find(b => b.id === activeBeatId);
    if (!beat?.textSpan) {
      CSS.highlights.delete(HIGHLIGHT_KEY);
      return;
    }
    const range = rangeForBeatSpan(bodyEl, sectionBody, beat.textSpan);
    if (!range) {
      CSS.highlights.delete(HIGHLIGHT_KEY);
      return;
    }
    CSS.highlights.set(HIGHLIGHT_KEY, new Highlight(range));
    return () => { CSS.highlights.delete(HIGHLIGHT_KEY); };
  }, [reelActive, activeBeatId, beats, sectionBody]);

  const showMobileSheet = isMobile && showPlayer;

  return (
    <div className="relative" data-brief-reel-section>
      {/* Body content. The host-rendered children stay mounted unchanged —
          same DOM, same fonts, same line breaks whether the reel is open
          or closed. When the reel is playing we just flip a data-attr;
          CSS in main.css dims the body text and mutes the keyword pills
          to plain colour, while the CSS Custom Highlight API paints the
          active beat's range on top. Zero swap, zero reflow. */}
      <div
        ref={bodyContainerRef}
        className="brief-reel-body-wrapper"
        data-reel-active={reelActive ? 'true' : undefined}
      >
        {children}
      </div>

      {buttonVisible && (
        <div className="absolute -bottom-3 -right-3 z-10 flex flex-col items-end">
          <BriefReelButton state={state} onClick={handleClick} title={state === 'error' && lastError ? lastError : undefined} />
          {reelInfo?.status === 'pending' && (
            <span className="mt-1 text-[9px] font-bold tracking-widest uppercase text-amber-700">Pending</span>
          )}
          {state === 'error' && lastError && (
            <span className="mt-1 text-[10px] font-semibold text-red-500 max-w-[220px] text-right whitespace-normal leading-tight">
              {lastError}
            </span>
          )}
        </div>
      )}

      <AnimatePresence>
        {!isMobile && showPlayer && playerEl && (
          <motion.div
            key="inline-player"
            initial={{ height: 0,      opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit   ={{ height: 0,      opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="mt-4 overflow-hidden"
          >
            <ReelChrome activeBeatIdx={activeBeatIdx} totalBeats={beats.length} onSeek={handleSeek} />
            <div className="aspect-video bg-surface rounded-lg overflow-hidden border border-brand-500/20 mt-2">
              {playerEl}
            </div>
            {isAdmin && reelInfo?.status === 'pending' && (
              // mr-16 reserves room on the right for the Skywatch logo
              // (w-12 button at -right-3 = 60px keep-out zone) so the
              // Publish / Discard buttons never sit behind the floating
              // logo. Keep the bar narrower than the player width.
              <div className="mt-3 mr-16 flex items-center justify-between gap-3 bg-surface-raised border border-brand-500/30 rounded-lg px-3 py-2">
                <span className="text-[10px] font-bold tracking-widest uppercase text-amber-600">Pending review</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={modBusy}
                    onClick={discardReel}
                    className="text-xs font-semibold text-red-500 hover:bg-red-500/10 border border-red-500/40 px-3 py-1.5 rounded-md disabled:opacity-40"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    disabled={modBusy}
                    onClick={publishReel}
                    className="text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-md disabled:opacity-40"
                  >
                    Publish
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {showMobileSheet && playerEl && createPortal(
        <MobileReelSheet
          onClose={() => { setShowPlayer(false); setState('ready'); onPlayChange?.(false); }}
          activeBeatIdx={activeBeatIdx}
          totalBeats={beats.length}
          onSeek={handleSeek}
          footer={isAdmin && reelInfo?.status === 'pending' ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-brand-500/20 bg-surface-raised">
              <span className="text-[10px] font-bold tracking-widest uppercase text-amber-600">Pending review</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={modBusy} onClick={discardReel}
                  className="text-xs font-semibold text-red-500 hover:bg-red-500/10 border border-red-500/40 px-3 py-1.5 rounded-md disabled:opacity-40">
                  Discard
                </button>
                <button type="button" disabled={modBusy} onClick={publishReel}
                  className="text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-md disabled:opacity-40">
                  Publish
                </button>
              </div>
            </div>
          ) : null}
        >
          {playerEl}
        </MobileReelSheet>,
        typeof document !== 'undefined' ? document.body : null,
      )}
    </div>
  );
}

// Convert a beat's textSpan (offsets into the raw sectionBody) into a DOM
// Range inside the host-rendered children.
//
// The rendered DOM differs from the raw body in non-trivial ways: bold
// markers (`**`) are stripped, leading list markers (`- `, `* `, `1. `) are
// stripped, blank lines between blocks contribute no characters, lines
// within a paragraph collapse to single spaces, etc. Trying to enumerate
// every transformation is fragile — instead we walk the DOM and the raw
// body in lockstep. For each character we see in the DOM, we advance the
// raw cursor over any chars that don't appear in the DOM (or that map to
// different whitespace) until raw[idx] lines up with the DOM char. At that
// point we know exactly which raw offset corresponds to which DOM (node,
// offset), and we can resolve any beat span correctly.
function rangeForBeatSpan(container, body, textSpan) {
  if (!container || !body || !textSpan) return null;
  // Asterisks are markdown markers — treat them as boundaries like
  // whitespace so word-snap doesn't extend into them.
  const isWord = (i) =>
    i >= 0 && i < body.length && /\S/.test(body.charAt(i)) && body.charAt(i) !== '*';

  let rawStart = Math.max(0, Math.min(body.length, textSpan.start ?? 0));
  let rawEnd   = Math.max(0, Math.min(body.length, textSpan.end   ?? 0));
  while (rawStart > 0          && isWord(rawStart) && isWord(rawStart - 1)) rawStart--;
  while (rawEnd   < body.length && isWord(rawEnd - 1) && isWord(rawEnd))    rawEnd++;
  if (rawEnd <= rawStart) return null;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node;
  let rawIdx = 0;
  let startNode = null, startOffset = 0;
  let endNode = null,   endOffset = 0;

  outer:
  while ((node = walker.nextNode())) {
    const text = node.nodeValue || '';
    for (let k = 0; k < text.length; k++) {
      const ch = text.charAt(k);
      const chIsWs = /\s/.test(ch);

      // Advance rawIdx until body[rawIdx] is the char we see in the DOM, or
      // both are whitespace (newlines/spaces interchange freely).
      while (rawIdx < body.length) {
        const r = body.charAt(rawIdx);
        if (r === ch) break;
        if (chIsWs && /\s/.test(r)) break;
        rawIdx++;
      }
      if (rawIdx >= body.length) break outer;

      // body[rawIdx] now corresponds to this DOM (node, k) position.
      if (startNode === null && rawIdx >= rawStart) {
        startNode = node;
        startOffset = k;
      }
      if (rawIdx < rawEnd) {
        endNode   = node;
        endOffset = k + 1;
      } else if (startNode) {
        break outer;
      }
      rawIdx++;
    }
  }

  if (!startNode || !endNode) return null;

  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode,    endOffset);
    return range;
  } catch {
    return null;
  }
}

function MobileReelSheet({ children, onClose, footer, activeBeatIdx, totalBeats, onSeek }) {
  useEffect(() => {
    document.body.classList.add('no-scroll');
    return () => { document.body.classList.remove('no-scroll'); };
  }, []);

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit   ={{ y: '100%' }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="fixed inset-0 z-[1200] bg-bg flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Brief Reel"
    >
      <div className="flex items-center justify-between p-3 border-b border-brand-500/20">
        <span className="text-xs font-bold tracking-widest uppercase text-brand-600">Brief Reel</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Brief Reel"
          className="w-9 h-9 rounded-full border border-brand-500/40 text-text hover:bg-surface-raised flex items-center justify-center"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        <ReelChrome activeBeatIdx={activeBeatIdx} totalBeats={totalBeats} onSeek={onSeek} />
        <div className="w-full max-w-[1024px] mx-auto aspect-video shrink-0">
          {children}
        </div>
      </div>
      {footer}
    </motion.div>
  );
}

// ── Reel chrome ─────────────────────────────────────────────────────────────
// Thin header strip above the SVG: brand label, beat counter, and a row of
// segment buttons. Tapping a segment jumps the reel to that beat — Instagram
// Stories style. The inner bar shows progress; the outer button gives a
// finger-friendly hit area without inflating the visible strip height.
function ReelChrome({ activeBeatIdx, totalBeats, onSeek }) {
  if (totalBeats <= 0) return null;
  const idx = Math.max(0, activeBeatIdx);
  const seekable = typeof onSeek === 'function';
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-1 text-[10px]">
      <span className="font-bold tracking-widest uppercase text-brand-500">Brief Reel</span>
      <div className="flex items-center gap-1.5 flex-1">
        {Array.from({ length: totalBeats }).map((_, i) => {
          const bar = (
            <div
              className={
                'h-1 rounded-full transition-colors duration-300 ' +
                (i <= idx ? 'bg-brand-500' : 'bg-slate-200')
              }
            />
          );
          if (!seekable) {
            return <div key={i} className="flex-1">{bar}</div>;
          }
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSeek(i)}
              aria-label={`Jump to beat ${i + 1} of ${totalBeats}`}
              aria-current={i === idx ? 'true' : undefined}
              className="flex-1 py-2 -my-2 group cursor-pointer focus:outline-none"
            >
              <div
                className={
                  'h-1 rounded-full transition-all duration-200 group-hover:h-1.5 ' +
                  (i <= idx ? 'bg-brand-500 group-hover:bg-brand-400' : 'bg-slate-200 group-hover:bg-slate-100')
                }
              />
            </button>
          );
        })}
      </div>
      <span className="font-mono font-semibold text-text-muted shrink-0">
        {idx + 1}/{totalBeats}
      </span>
    </div>
  );
}

