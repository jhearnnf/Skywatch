import { useId } from 'react'

// Flag emoji do not render on Windows: Segoe UI Emoji has no flag glyphs, so
// 🇬🇧 falls back to the two regional-indicator letters and a guide card shows
// "GB" in a box, which reads like a placeholder. Mac, iOS and Android draw the
// flag. This component draws the same flag everywhere, as inline SVG, for the
// handful of countries we have guides for, and hands anything else back to the
// caller to render as the emoji it already was.
//
// Every flag is drawn in a 60×30 box (all three are officially 2:1) and shown
// at the size the caller asks for. IDs inside the SVG (clip paths) go through
// useId so several flags on one page do not share them.

const REGIONAL_A = 0x1f1e6

// '🇨🇦' → 'CA'. Anything that is not exactly two regional-indicator symbols
// returns null, which is how the caller knows to fall back to the emoji.
export function flagEmojiToCode(emoji) {
  if (typeof emoji !== 'string') return null
  const cps = [...emoji].map(ch => ch.codePointAt(0))
  if (cps.length !== 2) return null
  if (!cps.every(cp => cp >= REGIONAL_A && cp <= REGIONAL_A + 25)) return null
  return String.fromCharCode(...cps.map(cp => cp - REGIONAL_A + 65))
}

const BLUE = '#012169'
const RED  = '#C8102E'

// The Union Flag, drawn to fill a w×h box. Australia reuses it at half size as
// its canton, which is why it is a fragment and not a whole SVG.
function UnionFlag({ w, h, clipId }) {
  const cx = w / 2, cy = h / 2
  // Counter-changed red diagonals: the red is offset to one side of each white
  // diagonal, which the four quadrant clip does.
  return (
    <>
      <clipPath id={clipId}>
        <path d={`M${cx},${cy} h${cx} v${cy} z v${cy} h-${cx} z h-${cx} v-${cy} z v-${cy} h${cx} z`} />
      </clipPath>
      <rect width={w} height={h} fill={BLUE} />
      <path d={`M0,0 L${w},${h} M${w},0 L0,${h}`} stroke="#fff" strokeWidth={h / 5} />
      <path d={`M0,0 L${w},${h} M${w},0 L0,${h}`} stroke={RED} strokeWidth={h / 7.5} clipPath={`url(#${clipId})`} />
      <path d={`M${cx},0 v${h} M0,${cy} h${w}`} stroke="#fff" strokeWidth={h / 3} />
      <path d={`M${cx},0 v${h} M0,${cy} h${w}`} stroke={RED} strokeWidth={h / 5} />
    </>
  )
}

// A regular star as a closed path. `inner` is the inner radius as a fraction
// of the outer one: 4/9 is the Australian Commonwealth star's ratio and reads
// as a star, not a blob, even at 24 pixels wide.
function starPath(cx, cy, points, r, inner = 4 / 9) {
  const pts = []
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inner
    const a = -Math.PI / 2 + (i * Math.PI) / points
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
}

// The maple leaf from the Government of Canada's reference drawing, which is
// laid out on a 9600×4800 flag with the leaf centred at (4800, 2400). The
// scale brings it into our 60×30 box.
const MAPLE_LEAF = 'm 4800,1125 -212.5,400 c -24.1,43.4 -67.3,39.3 -110.5,15.4 l -155.5,-80.9 115.7,616.3 c 24.2,113.3 -54.3,113.3 -93.3,64.3 l -272.3,-305.8 -44.5,155 c -5.2,20.8 -27.9,42.6 -61.6,37.5 l -343.4,-72.7 90.5,332.1 c 19.4,73.9 34.6,104.5 -19.6,124 l -122.5,57.7 592.8,483.4 c 23.4,18.2 35.2,50.9 26.8,80.6 l -51.9,169.5 c 204.5,-23.7 387.4,-59.5 591.5,-80.7 18.1,-1.7 48.2,27.6 48.1,48.3 l -27.1,624 h 99.5 l -15.8,-623 c -0.1,-20.8 27.6,-51.2 45.7,-49.5 204.1,21.2 387,57 591.5,80.7 l -51.9,-169.5 c -8.4,-29.7 3.4,-62.5 26.8,-80.6 l 592.8,-483.4 -122.5,-57.7 c -54.3,-19.6 -39.1,-50.1 -19.6,-124 l 90.5,-332.1 -343.4,72.7 c -33.8,5.1 -56.5,-16.7 -61.6,-37.5 l -44.5,-155 -272.3,305.8 c -38.9,49 -117.4,49 -93.3,-64.3 l 115.7,-616.3 -155.5,80.9 c -43.2,23.9 -86.4,28 -110.5,-15.4 z'

const FLAGS = {
  GB: ({ id }) => <UnionFlag w={60} h={30} clipId={`${id}-uk`} />,

  // 1:2:1 red-white-red, leaf in the white pale.
  CA: () => (
    <>
      <rect width={60} height={30} fill="#fff" />
      <rect width={15} height={30} fill="#D52B1E" />
      <rect x={45} width={15} height={30} fill="#D52B1E" />
      <path d={MAPLE_LEAF} fill="#D52B1E" transform="scale(0.00625)" />
    </>
  ),

  // Union canton, Commonwealth Star under it, Southern Cross in the fly.
  // Positions are the official ones scaled to 60 wide: the four seven-pointed
  // stars are 1/14 of the width across, Epsilon 1/24, the Commonwealth Star
  // 3/20.
  AU: ({ id }) => (
    <>
      <rect width={60} height={30} fill={BLUE} />
      <UnionFlag w={30} h={15} clipId={`${id}-au`} />
      <g fill="#fff">
        <path d={starPath(15, 22.5, 7, 4.5)} />
        <path d={starPath(45, 25, 7, 2.15)} />
        <path d={starPath(37.5, 13.125, 7, 2.15)} />
        <path d={starPath(45, 5, 7, 2.15)} />
        <path d={starPath(51.67, 11.125, 7, 2.15)} />
        <path d={starPath(48, 16.25, 5, 1.25, 0.5)} />
      </g>
    </>
  ),
}

export const FLAG_CODES = Object.keys(FLAGS)

// True when `emoji` is a flag we can draw, so a caller can decide between the
// SVG and the emoji without rendering anything.
export function hasFlag(emoji) {
  const cc = flagEmojiToCode(emoji)
  return Boolean(cc && FLAGS[cc])
}

// Renders the flag for `code` (or for a flag emoji), or null if we have no
// drawing for it, so the caller can `?? emoji`.
export default function CountryFlag({ code, emoji, width = 24, className = '' }) {
  const id = useId()
  const cc = code || flagEmojiToCode(emoji)
  const Flag = cc && FLAGS[cc]
  if (!Flag) return null
  const height = width / 2
  return (
    <svg
      viewBox="0 0 60 30"
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={cc}
      data-flag={cc}
      style={{ borderRadius: 2, overflow: 'hidden', display: 'block' }}
    >
      <clipPath id={`${id}-r`}><rect width={60} height={30} rx={4} /></clipPath>
      <g clipPath={`url(#${id}-r)`}>
        <Flag id={id} />
      </g>
    </svg>
  )
}
