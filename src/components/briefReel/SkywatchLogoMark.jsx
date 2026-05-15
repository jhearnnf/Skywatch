// SkywatchLogoMark — compact 40×40 crosshair (matches /public/favicon.svg).
// Used as the BriefReel trigger icon and inside SVG buttons. Caller controls
// size via wrapping CSS.

export default function SkywatchLogoMark({ ringColor = '#5baaff', accentColor = '#5baaff' }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx={20} cy={20} r={17} stroke={ringColor} strokeWidth={2.2} />
      <line x1={20} y1={1}  x2={20} y2={12} stroke={ringColor}   strokeWidth={2.2} strokeLinecap="round" />
      <line x1={20} y1={28} x2={20} y2={39} stroke={ringColor}   strokeWidth={2.2} strokeLinecap="round" />
      <line x1={1}  y1={20} x2={12} y2={20} stroke={ringColor}   strokeWidth={2.2} strokeLinecap="round" />
      <line x1={28} y1={20} x2={39} y2={20} stroke={ringColor}   strokeWidth={2.2} strokeLinecap="round" />
      <circle cx={20} cy={20} r={7}   stroke={accentColor} strokeWidth={1.8} />
      <circle cx={20} cy={20} r={2.5} fill={accentColor} />
    </svg>
  );
}
