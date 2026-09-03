import { describe, it, expect } from 'vitest'
import {
  CX,
  FACE_DEFAULTS,
  HAIR_STYLES,
  resolveFace,
  headMetrics,
  headPath,
  eyeGeometry,
  browPath,
  browPivot,
  nosePaths,
  mouthPaths,
  earGeometry,
  ageLines,
  hairlinePoints,
  hairPath,
  hairSides,
  hairStrands,
  bodyPaths,
  glassesPaths,
  facialHairPath,
} from '../faceGeometry'

const BASE = resolveFace({})

// Every path builder must emit something a browser will actually draw. A NaN
// anywhere in a path silently drops the whole shape, which is exactly the kind
// of failure that is invisible until someone looks at the portrait.
function isDrawablePath(d) {
  return typeof d === 'string' && d.length > 0 && !/NaN|Infinity|undefined/.test(d)
}

describe('resolveFace', () => {
  it('fills in every default so a partial descriptor is drawable', () => {
    const f = resolveFace({ faceWidth: 1.2 })
    expect(f.faceWidth).toBe(1.2)
    expect(f.jawWidth).toBe(FACE_DEFAULTS.jawWidth)
    expect(f.hairStyle).toBe(FACE_DEFAULTS.hairStyle)
  })

  it('copes with no descriptor at all', () => {
    expect(resolveFace(undefined)).toEqual(FACE_DEFAULTS)
  })
})

describe('headMetrics', () => {
  it('widens the head with faceWidth', () => {
    const narrow = headMetrics(resolveFace({ faceWidth: 0.9 }))
    const wide   = headMetrics(resolveFace({ faceWidth: 1.1 }))
    expect(wide.cheekHW).toBeGreaterThan(narrow.cheekHW)
  })

  it('lengthens the skull in both directions, not just downwards', () => {
    const short = headMetrics(resolveFace({ faceLength: 0.9 }))
    const long  = headMetrics(resolveFace({ faceLength: 1.1 }))
    expect(long.chinY).toBeGreaterThan(short.chinY)
    expect(long.topY).toBeLessThan(short.topY)
  })

  it('drops the nose and mouth with a longer face, so features stay in place', () => {
    const short = headMetrics(resolveFace({ faceLength: 0.9 }))
    const long  = headMetrics(resolveFace({ faceLength: 1.1 }))
    expect(long.noseY).toBeGreaterThan(short.noseY)
    expect(long.mouthY).toBeGreaterThan(short.mouthY)
  })

  it('keeps the features in anatomical order', () => {
    const m = headMetrics(BASE)
    expect(m.topY).toBeLessThan(m.eyeY)
    expect(m.eyeY).toBeLessThan(m.noseY)
    expect(m.noseY).toBeLessThan(m.mouthY)
    expect(m.mouthY).toBeLessThan(m.chinY)
  })
})

describe('headPath', () => {
  it('emits a closed, drawable outline', () => {
    const d = headPath(BASE)
    expect(isDrawablePath(d)).toBe(true)
    expect(d.trim().endsWith('Z')).toBe(true)
  })

  it('changes shape when the jaw is squared off', () => {
    expect(headPath(resolveFace({ jawSquare: 0.1 })))
      .not.toBe(headPath(resolveFace({ jawSquare: 0.9 })))
  })

  it('stays drawable across the whole plausible parameter range', () => {
    for (const faceWidth of [0.9, 1, 1.15]) {
      for (const faceLength of [0.9, 1, 1.1]) {
        for (const jawSquare of [0, 0.5, 1]) {
          const d = headPath(resolveFace({ faceWidth, faceLength, jawSquare }))
          expect(isDrawablePath(d), `${faceWidth}/${faceLength}/${jawSquare}`).toBe(true)
        }
      }
    }
  })
})

describe('eyeGeometry', () => {
  it('mirrors the two eyes about the centre line', () => {
    const l = eyeGeometry(BASE, -1)
    const r = eyeGeometry(BASE, 1)
    expect(CX - l.cx).toBeCloseTo(r.cx - CX)
    expect(l.cy).toBe(r.cy)
  })

  it('moves the eyes apart on a wider face', () => {
    const narrow = eyeGeometry(resolveFace({ faceWidth: 0.9 }), 1)
    const wide   = eyeGeometry(resolveFace({ faceWidth: 1.15 }), 1)
    expect(wide.cx).toBeGreaterThan(narrow.cx)
  })

  it('keeps the eyes inside the head at every width', () => {
    for (const faceWidth of [0.9, 1, 1.15]) {
      const f = resolveFace({ faceWidth })
      const m = headMetrics(f)
      const e = eyeGeometry(f, 1)
      expect(e.cx + e.rx).toBeLessThan(CX + m.cheekHW)
    }
  })

  it('drops the lid further as hooding increases', () => {
    const open   = eyeGeometry(resolveFace({ hooding: 0 }), 1)
    const hooded = eyeGeometry(resolveFace({ hooding: 0.8 }), 1)
    expect(open.lid).not.toBe(hooded.lid)
    expect(isDrawablePath(hooded.lid)).toBe(true)
  })

  it('gives three crows-feet strokes per eye', () => {
    expect(eyeGeometry(BASE, 1).crowsFeet).toHaveLength(3)
    for (const d of eyeGeometry(BASE, -1).crowsFeet) {
      expect(isDrawablePath(d)).toBe(true)
    }
  })
})

describe('brows', () => {
  it('emits a closed tapered shape rather than a stroke', () => {
    const d = browPath(BASE, -1)
    expect(isDrawablePath(d)).toBe(true)
    expect(d.trim().endsWith('Z')).toBe(true)
  })

  it('pivots about the outer end, which is what the expression rotates around', () => {
    const left  = browPivot(BASE, -1)
    const right = browPivot(BASE, 1)
    expect(left.x).toBeLessThan(CX)
    expect(right.x).toBeGreaterThan(CX)
    expect(left.y).toBe(right.y)
  })

  it('sits above the eye it belongs to', () => {
    expect(browPivot(BASE, 1).y).toBeLessThan(eyeGeometry(BASE, 1).cy)
  })
})

describe('nose and mouth', () => {
  it('builds every nose piece', () => {
    const n = nosePaths(BASE)
    for (const key of ['bridge', 'tip', 'wingL', 'wingR']) {
      expect(isDrawablePath(n[key]), key).toBe(true)
    }
    expect(n.nostrilL.cx).toBeLessThan(CX)
    expect(n.nostrilR.cx).toBeGreaterThan(CX)
  })

  it('curves the mouth up for a positive curve and down for a negative one', () => {
    const up   = mouthPaths(resolveFace({ mouthCurve: 0.5 }))
    const down = mouthPaths(resolveFace({ mouthCurve: -0.5 }))
    expect(up.lips).not.toBe(down.lips)
    expect(isDrawablePath(up.lips)).toBe(true)
    expect(isDrawablePath(down.lips)).toBe(true)
  })

  it('adds the expression delta to the descriptor rather than replacing it', () => {
    const resting = mouthPaths(resolveFace({ mouthCurve: 0.3 }), 0)
    const withDelta = mouthPaths(resolveFace({ mouthCurve: 0.3 }), 0.3)
    const asIfBase = mouthPaths(resolveFace({ mouthCurve: 0.6 }), 0)
    expect(withDelta.lips).toBe(asIfBase.lips)
    expect(withDelta.lips).not.toBe(resting.lips)
  })

  it('places the open mouth where the closed one is', () => {
    const m = mouthPaths(BASE)
    expect(m.open.cx).toBe(CX)
    expect(m.open.cy).toBeCloseTo(headMetrics(BASE).mouthY, 0)
  })
})

describe('ears', () => {
  it('breaks the head silhouette, or they would be skin drawn on skin', () => {
    const m = headMetrics(BASE)
    const ear = earGeometry(BASE, 1)
    expect(ear.cx + ear.rx).toBeGreaterThan(CX + m.cheekHW)
  })

  it('spans roughly brow to nose base', () => {
    const m = headMetrics(BASE)
    const ear = earGeometry(BASE, 1)
    expect(ear.cy - ear.ry).toBeLessThan(m.eyeY)
    expect(ear.cy + ear.ry).toBeGreaterThan(m.noseY - 3)
  })
})

describe('ageLines', () => {
  it('builds a fold on each side plus forehead lines', () => {
    const l = ageLines(BASE)
    expect(l.nasolabial).toHaveLength(2)
    expect(l.jowls).toHaveLength(2)
    expect(l.forehead.length).toBeGreaterThanOrEqual(2)
    for (const d of [...l.nasolabial, ...l.jowls, ...l.forehead, l.chinCrease]) {
      expect(isDrawablePath(d)).toBe(true)
    }
  })

  it('adds a third forehead line only to a heavily lined face', () => {
    expect(ageLines(resolveFace({ foreheadLines: 0.1 })).forehead).toHaveLength(2)
    expect(ageLines(resolveFace({ foreheadLines: 0.5 })).forehead).toHaveLength(3)
  })
})

describe('hair', () => {
  it('runs the hairline lower at the temples than at the crown when nothing has receded', () => {
    const pts = hairlinePoints(resolveFace({ recession: 0 }))
    expect(pts).toHaveLength(5)
    // Temples below the centre: a flat or lifted hairline reads as balding.
    expect(pts[0].y).toBeGreaterThan(pts[2].y)
  })

  it('lifts the temples back as recession increases', () => {
    const full     = hairlinePoints(resolveFace({ recession: 0 }))
    const receding = hairlinePoints(resolveFace({ recession: 0.8 }))
    expect(receding[0].y).toBeLessThan(full[0].y)
    // ...without moving the centre, which is what makes it a receding hairline
    // rather than a higher one.
    expect(receding[2].y).toBe(full[2].y)
  })

  it('brings the centre down for a widow’s peak', () => {
    const flat = hairlinePoints(resolveFace({ peak: 0 }))
    const peak = hairlinePoints(resolveFace({ peak: 1 }))
    expect(peak[2].y).toBeGreaterThan(flat[2].y)
  })

  it('turns the hairline in well inside the widest point of the skull', () => {
    const f = resolveFace({})
    const m = headMetrics(f)
    const pts = hairlinePoints(f)
    // Too close to the edge and the hair over the temples is a sliver.
    expect(pts[0].x).toBeLessThan(CX + m.cheekHW * 0.85)
  })

  it('emits a closed hair shape for every style but bald', () => {
    for (const hairStyle of HAIR_STYLES) {
      const d = hairPath(resolveFace({ hairStyle }))
      if (hairStyle === 'bald') {
        expect(d).toBe(null)
      } else {
        expect(isDrawablePath(d), hairStyle).toBe(true)
        expect(d.trim().endsWith('Z')).toBe(true)
      }
    }
  })

  it('gives a bald head the band round the sides instead', () => {
    expect(isDrawablePath(hairSides(resolveFace({ hairStyle: 'bald' })))).toBe(true)
  })

  it('draws strands for hair and none for a bald head', () => {
    expect(hairStrands(resolveFace({ hairStyle: 'combed' })).length).toBeGreaterThan(0)
    expect(hairStrands(resolveFace({ hairStyle: 'bald' }))).toEqual([])
    for (const d of hairStrands(resolveFace({ hairStyle: 'swept' }))) {
      expect(isDrawablePath(d)).toBe(true)
    }
  })

  it('sweeps the strands the other way when the part changes side', () => {
    const left  = hairStrands(resolveFace({ part: 'left' }))
    const right = hairStrands(resolveFace({ part: 'right' }))
    expect(left).not.toEqual(right)
  })
})

describe('bodyPaths', () => {
  it('builds every piece of the bust', () => {
    const b = bodyPaths(BASE)
    for (const key of ['neck', 'neckShade', 'shoulders', 'shirt', 'collarL', 'collarR', 'tieKnot', 'tie', 'lapelL', 'lapelR']) {
      expect(isDrawablePath(b[key]), key).toBe(true)
    }
    expect(b.pin.r).toBeGreaterThan(0)
  })

  it('widens the shoulders with build but leaves the head alone', () => {
    const slight = bodyPaths(resolveFace({ build: 0.95 }))
    const heavy  = bodyPaths(resolveFace({ build: 1.1 }))
    expect(slight.shoulders).not.toBe(heavy.shoulders)
    expect(headPath(resolveFace({ build: 0.95 }))).toBe(headPath(resolveFace({ build: 1.1 })))
  })

  it('hangs the collar off the chin, so a longer face does not float', () => {
    const shortFace = bodyPaths(resolveFace({ faceLength: 0.9 }))
    const longFace  = bodyPaths(resolveFace({ faceLength: 1.1 }))
    expect(shortFace.shoulders).not.toBe(longFace.shoulders)
  })
})

describe('glasses and facial hair', () => {
  it('sizes the frames off the eyes', () => {
    const g = glassesPaths(BASE, 'thin')
    const e = eyeGeometry(BASE, -1)
    expect(g.left.x).toBeLessThan(e.cx)
    expect(g.left.x + g.left.w).toBeGreaterThan(e.cx)
    for (const key of ['bridge', 'armL', 'armR', 'lowerL', 'lowerR']) {
      expect(isDrawablePath(g[key]), key).toBe(true)
    }
  })

  it('reports the frame style back so the component can draw rimless ones', () => {
    expect(glassesPaths(BASE, 'rimless').kind).toBe('rimless')
    expect(glassesPaths(BASE).kind).toBe('thin')
  })

  it('keeps a beard on the jaw rather than up over the cheeks', () => {
    const d = facialHairPath(BASE, 'beard')
    expect(isDrawablePath(d)).toBe(true)
    const m = headMetrics(BASE)
    // The highest y in the path must sit below the eyes, or it reads as a mask.
    const ys = [...d.matchAll(/-?\d+(?:\.\d+)?\s+(-?\d+(?:\.\d+)?)/g)].map((x) => Number(x[1]))
    expect(Math.min(...ys)).toBeGreaterThan(m.eyeY + 5)
  })

  it('draws a moustache above the mouth', () => {
    const d = facialHairPath(BASE, 'moustache')
    expect(isDrawablePath(d)).toBe(true)
    expect(d).not.toBe(facialHairPath(BASE, 'beard'))
  })
})
