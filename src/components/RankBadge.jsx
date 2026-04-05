/**
 * RankBadge — SVG insignia for each RAF rank.
 * AC (rankNumber 1) has no badge — caller shows abbreviation instead.
 *
 * Rank groups:
 *   1        — Aircraftman (AC)            — no badge
 *   2–3      — LAC, SAC                    — 2/3-blade propeller
 *   4–5      — Cpl, Sgt                    — 2/3 chevrons
 *   6        — Chief Technician            — 3 chevrons + 4-blade propeller above
 *   7        — Flight Sergeant             — crown + 3 chevrons
 *   8        — Warrant Officer             — crown only (simplified Royal Arms)
 *   9–14     — Junior/Senior Officers      — thin/normal rings per rank
 *   15–18    — Air Officers                — wide band + 0–3 thin stripes above
 *   19       — Marshal of the RAF          — crossed batons + crown
 */
export default function RankBadge({ rankNumber, size = 28, className = '', color = '#5baaff' }) {
  if (!rankNumber || rankNumber === 1) return null

  const s  = size
  const cx = s / 2
  const cy = s / 2

  // ── LAC / SAC — stylised propeller ─────────────────────────────────────────
  if (rankNumber === 2 || rankNumber === 3) {
    const blades = rankNumber === 2 ? 2 : 3
    const step   = 360 / blades
    const bladeEls = Array.from({ length: blades }, (_, i) => {
      const angle = (i * step - 90) * (Math.PI / 180)
      const bx = cx + Math.cos(angle) * (s * 0.3)
      const by = cy + Math.sin(angle) * (s * 0.3)
      return (
        <ellipse
          key={i}
          cx={bx} cy={by}
          rx={s * 0.09} ry={s * 0.22}
          transform={`rotate(${i * step}, ${bx}, ${by})`}
          fill={color}
          opacity="0.9"
        />
      )
    })
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true" className={className}>
        {bladeEls}
        <circle cx={cx} cy={cy} r={s * 0.07} fill={color} />
      </svg>
    )
  }

  // ── NCO ranks (4–8) ─────────────────────────────────────────────────────────
  if (rankNumber >= 4 && rankNumber <= 8) {
    // Cpl=2, Sgt=3, ChTech=3+prop, FS=3+crown, WO=crown only
    const chevronCount =
      rankNumber === 4 ? 2 :
      rankNumber === 5 ? 3 :
      rankNumber === 6 ? 3 :   // Ch Tech: 3 chevrons + 4-blade propeller above
      rankNumber === 7 ? 3 : 0 // WO: crown only

    const hasCrown = rankNumber >= 7
    const hasProp  = rankNumber === 6
    const sw       = s * 0.07

    const baseY          = (hasCrown || hasProp) ? cy + s * 0.18 : cy + s * 0.28
    const chevronHeight  = s * 0.16
    const chevronSpacing = s * 0.13
    const chevronWidth   = s * 0.7

    const chevronEls = Array.from({ length: chevronCount }, (_, i) => {
      const y  = baseY - i * chevronSpacing
      const x0 = cx - chevronWidth / 2
      const x1 = cx + chevronWidth / 2
      return (
        <polyline
          key={i}
          points={`${x0},${y} ${cx},${y - chevronHeight} ${x1},${y}`}
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )
    })

    // Simple stylised crown (FS / WO)
    const crownEl = hasCrown ? (() => {
      const cw   = s * 0.5
      const cx0  = cx - cw / 2
      const cy0  = cy - s * 0.32
      const ptH  = s * 0.14
      return (
        <g key="crown">
          <rect x={cx0} y={cy0} width={cw} height={s * 0.12} fill={color} rx={s * 0.03} />
          <polygon points={`${cx0},${cy0} ${cx0},${cy0 - ptH * 0.6} ${cx0 + cw * 0.25},${cy0}`}         fill={color} />
          <polygon points={`${cx - cw * 0.12},${cy0} ${cx},${cy0 - ptH} ${cx + cw * 0.12},${cy0}`}     fill={color} />
          <polygon points={`${cx0 + cw * 0.75},${cy0} ${cx0 + cw},${cy0 - ptH * 0.6} ${cx0 + cw},${cy0}`} fill={color} />
        </g>
      )
    })() : null

    // 4-blade propeller for Ch Tech (small, above chevrons)
    const propEl = hasProp ? (() => {
      const pr  = s * 0.22
      const pcy = cy - s * 0.26
      return (
        <g key="prop">
          {Array.from({ length: 4 }, (_, i) => {
            const angle = (i * 90 - 45) * (Math.PI / 180)
            const bx    = cx + Math.cos(angle) * (pr * 0.55)
            const by    = pcy + Math.sin(angle) * (pr * 0.55)
            return (
              <ellipse
                key={i}
                cx={bx} cy={by}
                rx={pr * 0.22} ry={pr * 0.5}
                transform={`rotate(${i * 90 - 45}, ${bx}, ${by})`}
                fill={color}
                opacity="0.9"
              />
            )
          })}
          <circle cx={cx} cy={pcy} r={pr * 0.12} fill={color} />
        </g>
      )
    })() : null

    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true" className={className}>
        {crownEl}
        {propEl}
        {chevronEls}
      </svg>
    )
  }

  // ── Junior / Senior Officers (9–14) — horizontal rings ─────────────────────
  // Accurate RAF stripe counts:
  //   Plt Off(9)=1 thin, Fg Off(10)=1 normal, Flt Lt(11)=2,
  //   Sqn Ldr(12)=3 with thin center, Wg Cdr(13)=3 equal, Gp Capt(14)=4
  if (rankNumber >= 9 && rankNumber <= 14) {
    const RING_COUNTS = { 9: 1, 10: 1, 11: 2, 12: 3, 13: 3, 14: 4 }
    const ringCount = RING_COUNTS[rankNumber]

    const normalSW   = s * 0.07
    const thinSW     = s * 0.032
    const ringSpacing = s * 0.16
    const ringW      = s * 0.72
    const totalH     = (ringCount - 1) * ringSpacing
    const startY     = cy - totalH / 2

    const ringEls = Array.from({ length: ringCount }, (_, i) => {
      // Plt Off: single thin ring
      // Sqn Ldr: middle ring (index 1 of 0-2) is thin
      const isPltOff     = rankNumber === 9
      const isSqnLdrMid  = rankNumber === 12 && i === 1
      const sw = (isPltOff || isSqnLdrMid) ? thinSW : normalSW
      return (
        <line
          key={i}
          x1={cx - ringW / 2} y1={startY + i * ringSpacing}
          x2={cx + ringW / 2} y2={startY + i * ringSpacing}
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
        />
      )
    })

    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true" className={className}>
        {ringEls}
      </svg>
    )
  }

  // ── Marshal of the RAF (19) — crossed batons + crown ───────────────────────
  if (rankNumber === 19) {
    const bsw    = s * 0.09
    const batonR = s * 0.3
    // Crown
    const cw  = s * 0.32
    const cx0 = cx - cw / 2
    const cy0 = cy - s * 0.38
    const ptH = s * 0.1
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true" className={className}>
        {/* Crown */}
        <rect x={cx0} y={cy0} width={cw} height={s * 0.09} fill={color} rx={s * 0.02} />
        <polygon points={`${cx0},${cy0} ${cx0},${cy0 - ptH * 0.6} ${cx0 + cw * 0.25},${cy0}`}          fill={color} />
        <polygon points={`${cx - cw * 0.12},${cy0} ${cx},${cy0 - ptH} ${cx + cw * 0.12},${cy0}`}      fill={color} />
        <polygon points={`${cx0 + cw * 0.75},${cy0} ${cx0 + cw},${cy0 - ptH * 0.6} ${cx0 + cw},${cy0}`} fill={color} />
        {/* Crossed batons */}
        <line x1={cx - batonR} y1={cy + batonR * 0.6} x2={cx + batonR} y2={cy - batonR * 0.6} stroke={color} strokeWidth={bsw} strokeLinecap="round" />
        <line x1={cx + batonR} y1={cy + batonR * 0.6} x2={cx - batonR} y2={cy - batonR * 0.6} stroke={color} strokeWidth={bsw} strokeLinecap="round" />
        {/* Baton end caps */}
        <circle cx={cx - batonR} cy={cy + batonR * 0.6} r={bsw * 0.75} fill={color} />
        <circle cx={cx + batonR} cy={cy + batonR * 0.6} r={bsw * 0.75} fill={color} />
        <circle cx={cx + batonR} cy={cy - batonR * 0.6} r={bsw * 0.75} fill={color} />
        <circle cx={cx - batonR} cy={cy - batonR * 0.6} r={bsw * 0.75} fill={color} />
      </svg>
    )
  }

  // ── Air Officers (15–18) — wide band + thin stripes above ──────────────────
  // Air Cdre(15)=wide only, AVM(16)=wide+1, AM(17)=wide+2, ACM(18)=wide+3
  const thinCount  = rankNumber - 15   // 0, 1, 2, 3
  const wideH      = s * 0.15
  const thinH      = s * 0.05
  const spacing    = s * 0.06
  const ringW      = s * 0.72

  // Stack: thin stripes (top) → spacing → wide band (bottom), centred vertically
  const totalH = thinCount * (thinH + spacing) + wideH
  const topY   = cy - totalH / 2

  const thinEls = Array.from({ length: thinCount }, (_, i) => (
    <rect
      key={i}
      x={cx - ringW / 2}
      y={topY + i * (thinH + spacing)}
      width={ringW}
      height={thinH}
      fill={color}
      rx={thinH * 0.4}
    />
  ))

  const wideY = topY + thinCount * (thinH + spacing)

  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true" className={className}>
      {thinEls}
      <rect x={cx - ringW / 2} y={wideY} width={ringW} height={wideH} fill={color} rx={s * 0.03} />
    </svg>
  )
}
