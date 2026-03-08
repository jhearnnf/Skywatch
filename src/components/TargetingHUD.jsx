import { useMemo } from 'react'

const HUD_W = 196
const HUD_H = 308
const GAP   = 18

function AmmoBlock({ active }) {
  return (
    <span className={`hud-ammo-block ${active ? 'hud-ammo-block--live' : 'hud-ammo-block--spent'}`}>
      {active ? '■' : '□'}
    </span>
  )
}

export default function TargetingHUD({ side, below = false, descRect, scrollY = 0, mainOffsetY = 0, ammoRemaining, ammoMax, description, keywordCount, loggedIn = true, onLoginClick, scanWord }) {
  // In below mode the HUD is in normal page flow — no absolute positioning needed.
  // In side mode: position:absolute inside <main position:relative>.
  // descRect.top is viewport-relative; adding scrollY gives document-absolute position.
  // Subtract mainOffsetY (main.offsetTop ≈ navbar height) to get main-relative coords.
  const docTop = (descRect.top + scrollY - mainOffsetY) + descRect.height / 2 - HUD_H / 2

  const style = below ? {} : side === 'left'
    ? { position: 'absolute', width: HUD_W, height: HUD_H, top: docTop, left: descRect.left - HUD_W - GAP, zIndex: 150 }
    : { position: 'absolute', width: HUD_W, height: HUD_H, top: docTop, left: descRect.right + GAP,        zIndex: 150 }

  // Pull deterministic fragments from the description for the right-panel data ghost
  const fragments = useMemo(() => {
    if (!description) return []
    const words    = description.replace(/[.!?,;:]/g, '').split(/\s+/).filter(w => w.length > 3)
    const prefixes = ['>>', '//', '--', '::', '##', '>>']
    const offsets  = [0, 3, 7, 11, 15, 20, 24, 29, 33, 38, 43, 47]
    return offsets.map((off, i) => {
      if (off >= words.length) return null
      const take = (i % 3) + 1
      return { text: words.slice(off, off + take).join(' '), prefix: prefixes[i % prefixes.length], indent: (i % 3) * 9 }
    }).filter(Boolean).slice(0, 11)
  }, [description])

  const isUnlimited = ammoMax >= 9999
  const maxBlocks   = isUnlimited ? 10 : Math.min(ammoMax || 10, 10)
  const isDepleted  = !isUnlimited && ammoRemaining === 0

  if (side === 'left') {
    return (
      <div className="targeting-hud targeting-hud--left" style={style} aria-hidden="true">
        <div className="hud-scan-line" />
        <div className="hud-corner hud-corner--tl" />
        <div className="hud-corner hud-corner--br" />

        <div className="hud-header">▸ TARGETING ACTIVE</div>
        <div className="hud-rule" />

        {loggedIn ? (
          <>
            <div className="hud-ammo-display">
              <span className={`hud-ammo-num ${isDepleted ? 'hud-ammo-num--depleted' : ''}`}>
                {isUnlimited ? '∞' : String(ammoRemaining).padStart(2, '0')}
              </span>
              <span className="hud-ammo-label">{isUnlimited ? 'UNLIMITED' : 'RDS REMAINING'}</span>
            </div>

            {!isUnlimited && maxBlocks > 0 && (
              <div className="hud-ammo-blocks">
                {Array.from({ length: maxBlocks }, (_, i) => (
                  <AmmoBlock key={i} active={i < ammoRemaining} />
                ))}
              </div>
            )}

            <div className="hud-rule" />

            <div className="hud-row">
              <span className="hud-key">STATUS</span>
              <span className={`hud-val ${isDepleted ? 'hud-val--red' : 'hud-val--green'}`}>
                {isUnlimited ? 'UNLIMITED' : isDepleted ? 'DEPLETED' : 'ACTIVE'}
              </span>
            </div>
            <div className="hud-row">
              <span className="hud-key">MODE</span>
              <span className="hud-val">LIVE INTEL</span>
            </div>
            <div className="hud-row">
              <span className="hud-key">KWDS</span>
              <span className="hud-val">{keywordCount ?? 0} LOCKED</span>
            </div>
          </>
        ) : (
          <>
            <div className="hud-ammo-display">
              <span className="hud-ammo-num hud-ammo-num--depleted">--</span>
              <span className="hud-ammo-label">AMMUNITION LOCKED</span>
            </div>

            <div className="hud-rule" />

            <div className="hud-login-prompt">
              <p className="hud-login-msg">⚠ CLEARANCE REQUIRED</p>
              <p className="hud-login-sub">Log in to load ammunition and unlock keyword targeting.</p>
              <button className="hud-login-btn" onClick={onLoginClick}>LOG IN</button>
            </div>

            <div className="hud-rule" />

            <div className="hud-row">
              <span className="hud-key">STATUS</span>
              <span className="hud-val hud-val--red">LOCKED</span>
            </div>
            <div className="hud-row">
              <span className="hud-key">KWDS</span>
              <span className="hud-val">{keywordCount ?? 0} LOCKED</span>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="targeting-hud targeting-hud--right" style={style} aria-hidden="true">
      <div className="hud-scan-line" />
      <div className="hud-corner hud-corner--tl" />
      <div className="hud-corner hud-corner--br" />

      <div className="hud-header">▸ INTEL ANALYSIS</div>
      <div className="hud-rule" />

      {scanWord && (
        <div className="hud-scan-word">
          <span className="hud-scan-word__label">SCANNING</span>
          <span className="hud-scan-word__value">
            <span className="hud-scan-word__count">{scanWord.count}x</span>
            {scanWord.word.toUpperCase()}
          </span>
        </div>
      )}

      <div className="hud-fragments">
        {fragments.map((f, i) => (
          <div
            key={i}
            className="hud-fragment"
            style={{ paddingLeft: f.indent, opacity: 0.07 + (i % 5) * 0.023 }}
          >
            <span className="hud-fragment-prefix">{f.prefix}</span>{' '}{f.text}
          </div>
        ))}
      </div>

      <div className="hud-rule" />

      <div className="hud-row">
        <span className="hud-key">SOURCE</span>
        <span className="hud-val">CLASSIFIED</span>
      </div>
      <div className="hud-row">
        <span className="hud-key">STATUS</span>
        <span className="hud-val hud-val--green">VERIFIED</span>
      </div>
    </div>
  )
}
