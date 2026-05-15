import SkywatchLogoMark from './SkywatchLogoMark';

// State machine:
//   'idle'    — admin, no cached reel; click triggers generation
//   'loading' — generating via AI
//   'ready'   — reel cached and ready to play (slow pulse)
//   'playing' — reel currently playing (bright active state)
//   'error'   — last action failed; click retries
//
// Renders a 40×40 crosshair logo inside a 56×56 button so the touch target
// stays comfortable on mobile. The wrapping host decides WHEN to render
// this — feature-flag visibility is the host's job, not the button's.

export default function BriefReelButton({
  state = 'idle',
  onClick,
  title,
}) {
  const isReady   = state === 'ready';
  const isPlaying = state === 'playing';
  const isLoading = state === 'loading';
  const isError   = state === 'error';

  const baseClasses =
    'relative flex items-center justify-center w-12 h-12 rounded-full border ' +
    'bg-surface-raised/80 backdrop-blur-sm transition-colors duration-200 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

  const stateClasses = isPlaying
    ? 'border-brand-600 shadow-[0_0_18px_rgba(91,170,255,0.55)]'
    : isReady
      ? 'border-brand-500/60 brief-reel-pulse'
      : isError
        ? 'border-red-400/60'
        : 'border-brand-500/30 hover:border-brand-500/60';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLoading}
      aria-pressed={isPlaying || undefined}
      aria-busy={isLoading || undefined}
      title={title || defaultTitle(state)}
      data-brief-reel-button
      data-state={state}
      className={`${baseClasses} ${stateClasses}`}
    >
      <div className="w-7 h-7 pointer-events-none">
        <SkywatchLogoMark
          ringColor={isError ? '#ef4444' : '#5baaff'}
          accentColor={isError ? '#ef4444' : isPlaying ? '#ddeaf8' : '#5baaff'}
        />
      </div>

      {isLoading && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border-2 border-brand-500/30 border-t-brand-500 animate-spin"
        />
      )}
    </button>
  );
}

function defaultTitle(state) {
  switch (state) {
    case 'ready':   return 'Play Brief Reel';
    case 'playing': return 'Close Brief Reel';
    case 'loading': return 'Generating Brief Reel…';
    case 'error':   return 'Brief Reel failed — click to retry';
    default:        return 'Generate Brief Reel';
  }
}
