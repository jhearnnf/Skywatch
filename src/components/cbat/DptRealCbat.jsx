import { memo, useRef } from 'react'
import { SCOPE_SIZE, SCOPE_HALF, bearingToVec } from '../../utils/cbat/dptPhysics'

// DPT under the Real CBAT theme: the screen of the real test software, drawn
// from a candidate's screenshot of it, rather than SkyWatch's neon arena.
//
//   - a north-up radar on a blue field, black range rings, a bearing every 10
//     degrees round the edge and a small + at the centre
//   - aircraft as radar symbols (a dot in a ring, callsign and height beside
//     it), never the 3D models, so there is no aircraft to pick
//   - gates as two orange dots joined by a thin line, lettered or numbered
//   - the key down the left: missions, UA, danger areas, range rings, the
//     separation rules, and how bearings and heights are written
//   - the black strip along the bottom: round, selected aircraft, and the
//     heading and height boxes the digits are typed into
//
// Nothing here changes how a run plays or scores. The page drives these with
// the same aircraft, gates and zones the SkyWatch arena draws.

const FONT = 'Arial, Helvetica, sans-serif'

// Dot colour inside each aircraft's ring. CA-A red and CA-N yellow are the
// real test's; the Fighter is SkyWatch's own addition (the real test has no
// interceptor), so it takes a colour the real key does not use.
const DPT_CBAT_COLORS = {
  'CA-A':    '#c8102e',
  'CA-N':    '#f4e23a',
  'Fighter': '#36c95a',
}
const UA_COLOR      = '#ffffff'
const GATE_DOT      = '#e8782c'
const GATE_LINE     = '#c9c9c9'
const ZONE_FILL     = '#6f0a0a'
const PROJ_HEADING  = '#e8202a'   // where the aircraft is pointing now
const PROJ_COMMAND  = '#1fb04a'   // the bearing it has been told to turn to
const RING_STROKE   = '#000000'
// Sampled from the reference screenshot: the radar is one flat dark navy.
const FIELD         = '#19194c'
const LABEL         = '#dcdce8'

// Range rings every 10 nm, where 5 nm is the lateral separation the run
// enforces (the 70-unit intercept ring), so the key's distances are true.
export const DPT_CBAT_RING_STEP = 140
const RING_RADII = [1, 2, 3, 4].map(i => i * DPT_CBAT_RING_STEP)
const BEARINGS   = Array.from({ length: 36 }, (_, i) => (i === 0 ? 360 : i * 10))
const EDGE_HALF  = SCOPE_HALF          // labels hug the radar's own edge
const TICK_LEN   = 14
const LABEL_IN   = 34

const pad3 = (n) => String(Math.round(n)).padStart(3, '0')

function edgeT(bearing) {
  const { dx, dy } = bearingToVec(bearing)
  const tx = Math.abs(dx) < 1e-9 ? Infinity : EDGE_HALF / Math.abs(dx)
  const ty = Math.abs(dy) < 1e-9 ? Infinity : EDGE_HALF / Math.abs(dy)
  return Math.min(tx, ty)
}

// ── Radar ───────────────────────────────────────────────────────────────────
const RadarChrome = memo(function RadarChrome() {
  return (
    <>
      <rect x={0} y={0} width={SCOPE_SIZE} height={SCOPE_SIZE} fill={FIELD} />
      {RING_RADII.map(r => (
        <circle key={r} cx={SCOPE_HALF} cy={SCOPE_HALF} r={r} fill="none" stroke={RING_STROKE} strokeWidth={1.6} />
      ))}
      {BEARINGS.map(b => {
        const { dx, dy } = bearingToVec(b)
        const t  = edgeT(b)
        const lt = t - LABEL_IN
        return (
          <g key={b}>
            <line
              x1={SCOPE_HALF + dx * (t - TICK_LEN)} y1={SCOPE_HALF + dy * (t - TICK_LEN)}
              x2={SCOPE_HALF + dx * t}              y2={SCOPE_HALF + dy * t}
              stroke="#ffffff" strokeWidth={2}
            />
            <text
              x={SCOPE_HALF + dx * lt} y={SCOPE_HALF + dy * lt}
              fill="#ffffff" fontSize={21} fontFamily={FONT}
              textAnchor="middle" dominantBaseline="middle"
            >
              {pad3(b)}
            </text>
          </g>
        )
      })}
      <g stroke="#c8cbe0" strokeWidth={1.5} opacity={0.8}>
        <line x1={SCOPE_HALF - 10} y1={SCOPE_HALF} x2={SCOPE_HALF + 10} y2={SCOPE_HALF} />
        <line x1={SCOPE_HALF} y1={SCOPE_HALF - 10} x2={SCOPE_HALF} y2={SCOPE_HALF + 10} />
      </g>
    </>
  )
})

export function DptCbatRadar({ children }) {
  return (
    <svg
      viewBox={`0 0 ${SCOPE_SIZE} ${SCOPE_SIZE}`}
      className="absolute inset-0 w-full h-full"
      aria-hidden="true"
      textRendering="geometricPrecision"
      data-dpt-cbat-radar
    >
      <RadarChrome />
      {children}
    </svg>
  )
}

// ── Gates and danger areas ──────────────────────────────────────────────────
export const DptCbatGate = memo(function DptCbatGate({ gate }) {
  const { p1, p2, id, hit } = gate
  const cx = (p1.x + p2.x) / 2
  const cy = (p1.y + p2.y) / 2
  // The label sits off the gate line on the side away from the centre of the
  // radar, clear of both the line and the dots.
  const nx = -(p2.y - p1.y), ny = p2.x - p1.x
  const nl = Math.hypot(nx, ny) || 1
  const away = (nx * (cx - SCOPE_HALF) + ny * (cy - SCOPE_HALF)) >= 0 ? 1 : -1
  const lx = cx + (nx / nl) * 22 * away
  const ly = cy + (ny / nl) * 22 * away
  return (
    <g opacity={hit ? 0.25 : 1} data-dpt-cbat-gate={id}>
      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={GATE_LINE} strokeWidth={2} />
      <circle cx={p1.x} cy={p1.y} r={7} fill={GATE_DOT} />
      <circle cx={p2.x} cy={p2.y} r={7} fill={GATE_DOT} />
      <text x={lx} y={ly} fill="#ffffff" fontSize={22} fontFamily={FONT}
            textAnchor="middle" dominantBaseline="middle">{id}</text>
    </g>
  )
})

export const DptCbatZone = memo(function DptCbatZone({ zone }) {
  const { position, band, radius } = zone
  return (
    <circle
      cx={position.x} cy={position.y} r={radius}
      fill={ZONE_FILL} fillOpacity={0.92}
      stroke={band === '2k' ? '#ffffff' : '#000000'} strokeWidth={4}
    />
  )
})

// ── Aircraft ────────────────────────────────────────────────────────────────
// Copied from the real test screen: a thin grey ring with nothing inside it
// but the mission dot (red or yellow, outlined in black), the callsign and
// height in pale grey beside the ring, and a trail of short yellow dashes
// square to the track, stepping back from the ring and fading with distance.
// The dashes shimmer outward one after another (dpt-cbat-trail-dash in
// main.css). A UA is a plain white ring with its height and no callsign.
const DPT_CBAT_RING_R = 18
const TRAIL = Array.from({ length: 6 }, (_, i) => ({
  y: DPT_CBAT_RING_R + 2 + i * 6.5,          // behind the aircraft (+y once rotated)
  half: 9,
  fade: 1 - i * 0.13,
}))

export function DptCbatAircraft({ aircraft, active, dim }) {
  const { position, id, altitudeFt, kind, headingDeg } = aircraft
  const tx  = Math.round(position.x * 10) / 10
  const ty  = Math.round(position.y * 10) / 10
  const alt = pad3(altitudeFt / 100)
  const R   = DPT_CBAT_RING_R

  if (kind === 'Enemy') {
    return (
      <g transform={`translate(${tx}, ${ty})`} data-dpt-cbat-aircraft="UA">
        <circle r={9} fill="none" stroke={UA_COLOR} strokeWidth={3} />
        <text x={16} y={8} fill={LABEL} fontSize={22} fontFamily={FONT} dominantBaseline="middle">{alt}</text>
      </g>
    )
  }

  return (
    <g transform={`translate(${tx}, ${ty})`} opacity={dim ? 0.35 : 1}
       data-dpt-cbat-aircraft={id} data-active={active ? 'true' : undefined}>
      <g transform={`rotate(${headingDeg})`}>
        {TRAIL.map((d, i) => (
          <g key={i} opacity={d.fade}>
            <line
              className="dpt-cbat-trail-dash"
              style={{ animationDelay: `${(i * 0.16).toFixed(2)}s` }}
              x1={-d.half} y1={d.y} x2={d.half} y2={d.y}
              stroke="#d2c828" strokeWidth={1.8} strokeDasharray="7 3"
            />
          </g>
        ))}
      </g>
      <circle r={R} fill="none" stroke={active ? '#5d6092' : '#45487a'} strokeWidth={2.2} />
      <circle r={8} fill={DPT_CBAT_COLORS[kind] ?? '#ffffff'} stroke="#000000" strokeWidth={3} />
      <text x={R + 8} y={-16} fill={LABEL} fontSize={22} fontFamily={FONT} dominantBaseline="middle">{id}</text>
      <text x={R + 8} y={7} fill={LABEL} fontSize={22} fontFamily={FONT} dominantBaseline="middle">{alt}</text>
    </g>
  )
}

// ── Projection lines ────────────────────────────────────────────────────────
// Drawn from the selected aircraft: red along the heading it is flying now,
// green along the bearing it has been told to turn to, each labelled with its
// bearing at the far end. The green line goes when the turn is complete.
//
// Near the edge a full-length line would carry its label off the radar, and
// the label is where the bearing is written on the radar. So the line stops
// short of the bearing scale round the edge, and the label is held inside the
// radar whatever happens.
const PROJ_LEN      = 300
const PROJ_MIN      = 50
const EDGE_KEEP_OUT = 80     // the bearing ticks and labels round the edge
const LABEL_GAP     = 24
const LABEL_MARGIN  = 46     // label centre never nearer the radar's edge than this

// How far from (x, y) along (dx, dy) to the radar's edge.
function distanceToEdge(x, y, dx, dy) {
  const tx = dx > 1e-9 ? (SCOPE_SIZE - x) / dx : dx < -1e-9 ? -x / dx : Infinity
  const ty = dy > 1e-9 ? (SCOPE_SIZE - y) / dy : dy < -1e-9 ? -y / dy : Infinity
  return Math.min(tx, ty)
}
const clampLabel = (v) => Math.max(LABEL_MARGIN, Math.min(SCOPE_SIZE - LABEL_MARGIN, v))

function projLine(at, bearing, color, key) {
  const { dx, dy } = bearingToVec(bearing)
  const len = Math.max(PROJ_MIN, Math.min(PROJ_LEN, distanceToEdge(at.x, at.y, dx, dy) - EDGE_KEEP_OUT))
  // From the edge of the aircraft's ring, as on the real screen.
  const from = { x: at.x + dx * DPT_CBAT_RING_R, y: at.y + dy * DPT_CBAT_RING_R }
  const ex = at.x + dx * len
  const ey = at.y + dy * len
  const lx = clampLabel(at.x + dx * (len + LABEL_GAP))
  const ly = clampLabel(at.y + dy * (len + LABEL_GAP))
  return (
    <g key={key} data-dpt-cbat-projection={key}>
      <line x1={from.x} y1={from.y} x2={ex} y2={ey} stroke={color} strokeWidth={4} />
      <text x={lx} y={ly} fill={color} fontSize={22} fontFamily={FONT}
            textAnchor="middle" dominantBaseline="middle">{pad3(bearing)}</text>
    </g>
  )
}

export function DptCbatProjection({ aircraft }) {
  if (!aircraft) return null
  const { position, headingDeg, targetHeadingDeg } = aircraft
  return (
    <g pointerEvents="none">
      {targetHeadingDeg != null && projLine(position, targetHeadingDeg, PROJ_COMMAND, 'command')}
      {projLine(position, headingDeg, PROJ_HEADING, 'heading')}
    </g>
  )
}

// ── Key (left column) ───────────────────────────────────────────────────────
function Dot({ color, ring = '#000000', size = 12, hollow = false }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size, height: size,
        background: hollow ? 'transparent' : color,
        border: `2px solid ${hollow ? color : ring}`,
      }}
    />
  )
}

function KeyRow({ label, children }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{children}</td>
    </tr>
  )
}

// `hard` adds what only the Hard rounds contain: the Fighter, UAs and danger
// areas. An Easier run never meets them, so its key does not list them.
export function DptCbatLegend({ hard }) {
  return (
    <div data-dpt-cbat-legend>
      <div className="dpt-cbat-box">
        <table className="dpt-cbat-key">
          <tbody>
            <KeyRow label={<>CA<br />Mission</>}>
              <div className="dpt-cbat-key-line"><Dot color={DPT_CBAT_COLORS['CA-A']} /> CA-A : Alphabetical Order</div>
              <div className="dpt-cbat-key-line"><Dot color={DPT_CBAT_COLORS['CA-N']} /> CA-N : Numerical Order</div>
              {hard && (
                <div className="dpt-cbat-key-line"><Dot color={DPT_CBAT_COLORS.Fighter} /> Fighter : Intercept UA</div>
              )}
            </KeyRow>
            {hard && (
              <KeyRow label="UA">
                <div className="dpt-cbat-key-line"><Dot color="#ffffff" ring="#000000" /></div>
              </KeyRow>
            )}
            {hard && (
              <KeyRow label={<>Danger<br />Areas</>}>
                <div className="dpt-cbat-key-line"><Dot color={ZONE_FILL} ring="#ffffff" size={20} /> 2000 ft (020)</div>
                <div className="dpt-cbat-key-line"><Dot color={ZONE_FILL} ring="#000000" size={24} /> 3000 ft (030)</div>
              </KeyRow>
            )}
            <KeyRow label={<>Range<br />Rings</>}>
              <svg viewBox="0 0 120 44" className="dpt-cbat-rings" aria-hidden="true">
                {[20, 64, 108].map(x => (
                  <path key={x} d={`M ${x} 2 Q ${x + 8} 22 ${x} 42`} fill="none" stroke="#000" strokeWidth={1.2} />
                ))}
                <line x1={24} y1={22} x2={66} y2={22} stroke="#c0141a" strokeWidth={1} markerStart="url(#dpt-cbat-arr)" markerEnd="url(#dpt-cbat-arr)" />
                <line x1={70} y1={30} x2={90} y2={30} stroke="#1f8a2a" strokeWidth={1} markerStart="url(#dpt-cbat-arr)" markerEnd="url(#dpt-cbat-arr)" />
                <defs>
                  <marker id="dpt-cbat-arr" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                    <path d="M0,0 L6,3 L0,6 z" fill="currentColor" />
                  </marker>
                </defs>
                <text x={44} y={16} fontSize={8} textAnchor="middle" fontFamily={FONT}>10 nms</text>
                <text x={80} y={41} fontSize={8} textAnchor="middle" fontFamily={FONT}>5 nms</text>
              </svg>
            </KeyRow>
          </tbody>
        </table>
        <div className="dpt-cbat-rules">
          {hard && <p>Avoid Danger Areas vertically by 1000 ft (010).</p>}
          <p>Avoid other aircraft laterally by 5 nms.</p>
          <p>Avoid other aircraft vertically by 3000 ft (030).</p>
        </div>
      </div>

      <div className="dpt-cbat-box dpt-cbat-notes">
        <p>Bearings are given in degrees:</p>
        <ul>
          <li>1° will show as 001.</li>
          <li>10° will show as 010.</li>
          <li>100° will show as 100.</li>
        </ul>
        <p>Height is given in hundreds of feet:</p>
        <ul>
          <li>100ft will show as 001.</li>
          <li>1000ft will show as 010.</li>
          <li>10000ft will show as 100.</li>
        </ul>
      </div>

      <div className="dpt-cbat-box dpt-cbat-notes dpt-cbat-keys-help">
        <p>Keys:</p>
        <ul>
          <li>&larr; &rarr; choose which way to turn.</li>
          <li>Type 3 digits for the new bearing.</li>
          <li>&darr; then 3 digits for a new height, &uarr; back to bearing.</li>
          <li>A, N, F select CA-A, CA-N, Fighter.</li>
        </ul>
      </div>
    </div>
  )
}

// ── Bottom strip ────────────────────────────────────────────────────────────
// "Round 2 of 4", the aircraft (tap one to select it), then the heading and
// height boxes. The box being typed into shows the digits so far; otherwise
// each shows the selected aircraft's bearing or height as it stands. The
// arrow in front of the heading box is the turn direction and taps to flip.
function Digits({ value }) {
  return (
    <span className="dpt-cbat-digits">
      {[0, 1, 2].map(i => <b key={i}>{value[i] ?? ''}</b>)}
    </span>
  )
}

export function DptCbatStrip({
  roundLabel, aircraftList, activeId, onSelectActive,
  inputMode, onInputMode, turnDir, onTurnDir, bearingInput,
}) {
  const players = aircraftList.filter(a => a.kind !== 'Enemy')
  const active  = players.find(a => a.id === activeId) ?? null
  const heading = active ? pad3(active.targetHeadingDeg ?? active.headingDeg) : ''
  const height  = active ? pad3((active.targetAltitudeFt ?? active.altitudeFt) / 100) : ''
  // Digits being typed take the box over; until the first one, it shows where
  // the aircraft is pointing (or climbing to), so the heading can always be
  // read here even when the radar is short of room for its label.
  const brg = inputMode === 'BRG' && bearingInput ? bearingInput : heading
  const alt = inputMode === 'ALT' && bearingInput ? bearingInput : height
  return (
    <div className="dpt-cbat-strip" data-dpt-cbat-strip>
      <span className="dpt-cbat-strip-round">{roundLabel}</span>
      <span className="dpt-cbat-strip-aircraft" role="group" aria-label="Aircraft">
        {players.map(a => (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelectActive(a.id)}
            aria-pressed={a.id === activeId}
            className={a.id === activeId ? 'is-active' : undefined}
            data-dpt-cbat-select={a.id}
          >
            <i style={{ background: DPT_CBAT_COLORS[a.kind] }} />
            {a.id}
          </button>
        ))}
      </span>
      <span className="dpt-cbat-strip-fields">
        <span className={`dpt-cbat-field${inputMode === 'BRG' ? ' is-active' : ''}`}>
          <button
            type="button"
            className="dpt-cbat-field-icon"
            onClick={() => { onInputMode('BRG'); onTurnDir(turnDir === 'L' ? 'R' : 'L') }}
            aria-label={`Turn ${turnDir === 'L' ? 'left' : 'right'}. Tap to change`}
            data-dpt-cbat-turn={turnDir}
          >
            {turnDir === 'L' ? '←' : '→'}
          </button>
          <button type="button" className="dpt-cbat-field-value" onClick={() => onInputMode('BRG')} aria-label="Type a bearing">
            <Digits value={brg} />
          </button>
        </span>
        <span className={`dpt-cbat-field${inputMode === 'ALT' ? ' is-active' : ''}`}>
          <button type="button" className="dpt-cbat-field-icon" onClick={() => onInputMode('ALT')} aria-label="Type a height">
            ↑
          </button>
          <button type="button" className="dpt-cbat-field-value" onClick={() => onInputMode('ALT')} aria-label="Type a height">
            <Digits value={alt} />
          </button>
        </span>
      </span>
    </div>
  )
}

// ── Touch keypad ────────────────────────────────────────────────────────────
// The real test is played on a keyboard, so on a desktop the arrows and digit
// keys are the controls and nothing is drawn. Touch screens get these keys:
// in the key column on a tablet, under the strip on a phone (CSS decides).
// Digits fire on pointerdown, as on the SkyWatch numpad, so a busy frame loop
// cannot swallow a tap.
export function DptCbatKeypad({ turnDir, onTurnDir, inputMode, onInputMode, onDigit, className = '' }) {
  const last = useRef({ label: '', t: 0 })
  const key = (label, fire, extra = '', aria) => (
    <button
      key={label}
      type="button"
      aria-label={aria}
      className={`cbat-keycap dpt-cbat-key ${extra}`}
      onPointerDown={(e) => { e.preventDefault(); last.current = { label, t: Date.now() }; fire() }}
      onClick={() => {
        const r = last.current
        if (r.label === label && Date.now() - r.t < 500) return
        fire()
      }}
    >
      {label}
    </button>
  )
  return (
    <div className={`dpt-cbat-keypad ${className}`} data-dpt-cbat-keypad>
      <div className="dpt-cbat-keypad-row">
        {key('← L', () => { onInputMode('BRG'); onTurnDir('L') }, inputMode === 'BRG' && turnDir === 'L' ? 'is-on' : '', 'Turn left')}
        {key('BRG', () => onInputMode('BRG'), inputMode === 'BRG' ? 'is-on' : '', 'Type a bearing')}
        {key('ALT', () => onInputMode('ALT'), inputMode === 'ALT' ? 'is-on' : '', 'Type a height')}
        {key('R →', () => { onInputMode('BRG'); onTurnDir('R') }, inputMode === 'BRG' && turnDir === 'R' ? 'is-on' : '', 'Turn right')}
      </div>
      <div className="dpt-cbat-keypad-digits">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => key(d, () => onDigit(d)))}
        <span />
        {key('0', () => onDigit('0'))}
        <span />
      </div>
    </div>
  )
}
