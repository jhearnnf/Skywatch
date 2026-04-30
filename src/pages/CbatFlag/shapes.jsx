// Palette + button-icon helpers for the FLAG shape strike target.
//
// Each game uses a 3-entry palette of (colour, kind) pairs. The play field
// places 4 shapes from this palette — three unique entries plus one duplicate
// — with random rotation and width/height scaling so the duplicate pair still
// reads as visually distinct. The colour buttons in the controls panel render
// the same palette upright (no rotation, no stretch).

export const SHAPE_COLOURS = ['#5baaff', '#facc15', '#ef4444', '#22c55e']
export const SHAPE_KINDS = ['square', 'circle', 'triangle', 'diamond']

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function generatePalette() {
  const colours = shuffle(SHAPE_COLOURS).slice(0, 3)
  const kinds = shuffle(SHAPE_KINDS).slice(0, 3)
  return colours.map((color, i) => ({ color, kind: kinds[i] }))
}

export function ShapeIcon({ kind, color, size = 22 }) {
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.36
  const stroke = '#ffffff'
  const sw = 2
  let path = null
  if (kind === 'square') {
    path = <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={color} stroke={stroke} strokeWidth={sw} />
  } else if (kind === 'circle') {
    path = <circle cx={cx} cy={cy} r={r} fill={color} stroke={stroke} strokeWidth={sw} />
  } else if (kind === 'triangle') {
    const apex = (r * 2) / Math.sqrt(3)
    const base = r / Math.sqrt(3)
    path = <polygon points={`${cx},${cy - apex} ${cx - r},${cy + base} ${cx + r},${cy + base}`} fill={color} stroke={stroke} strokeWidth={sw} />
  } else if (kind === 'diamond') {
    path = <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={color} stroke={stroke} strokeWidth={sw} transform={`rotate(45 ${cx} ${cy})`} />
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {path}
    </svg>
  )
}
