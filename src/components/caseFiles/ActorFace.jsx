/**
 * ActorFace — a drawn, chest-up portrait of an interrogation actor that reacts
 * to what they just said.
 *
 * The interview stage used to be a name, a role and two coloured initials in a
 * box. Reading an answer meant reading text alone; there was nobody in the
 * room. This is the arcade-dialogue convention instead: the person you are
 * talking to is on screen, shoulders and up, and their face changes with the
 * answer — the eyes narrow when they deflect, the brows drop when they warn
 * you, and the mouth moves while the line is being delivered.
 *
 * Where the shapes come from
 *   Every path is built by faceGeometry.js from a numeric descriptor in
 *   actorAppearance.js: skull width and length, jaw squareness, how far the
 *   hairline has receded, how hooded the eyes are, how deep the lines from nose
 *   to mouth run. This component's job is only to stack those shapes in the
 *   right order with the right colours, and to apply the expression.
 *
 *   That split is what makes each figure their own face rather than a recolour
 *   of one template. The descriptors stay factual — these are real public
 *   figures, and the aim is a recognisable stand-in, never a caricature.
 *
 * Props
 *   actor     { id, name, systemPromptKey?, appearance?, faction? }
 *   mood      one of MOODS in actorMood.js — drives brows, eyes and mouth
 *   talking   boolean — animate the mouth (a line is being delivered)
 *   idle      boolean, default true — blink and breathe
 *   size      rendered width in px; height follows the 4:5 bust framing
 */

import React, { useId } from 'react'
import { resolveAppearance, factionAccent } from '../../utils/caseFiles/actorAppearance'
import {
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
  hairPath,
  hairSides,
  hairStrands,
  bodyPaths,
  glassesPaths,
  facialHairPath,
} from '../../utils/caseFiles/faceGeometry'

// ── Expression table ─────────────────────────────────────────────────────────
//
// Expressions are DELTAS on the descriptor, never absolutes: a firm Putin still
// has Putin's mouth, just pressed. That is the whole reason the resting set of
// each face lives in the descriptor.
//
// browTilt   degrees about each brow's OUTER end. Positive drops the inner end
//            (displeasure); negative raises it (concern).
// browLift   px the brow moves up.
// eyeOpen    multiplier on the eye's vertical scale.
// gaze       pupil offset in px — where the actor is looking.
// mouthCurve added to the descriptor's resting curve.

const EXPRESSIONS = {
  neutral: {
    browTilt: 0, browLift: 0, eyeOpen: 1, gaze: { x: 0, y: 0 }, mouthCurve: 0,
  },
  guarded: {
    // Narrowed, level, and looking slightly away — the face of a non-answer.
    browTilt: 2, browLift: -1, eyeOpen: 0.66, gaze: { x: -1.6, y: 0.2 },
    mouthCurve: -0.15, lipPress: 0.75,
  },
  firm: {
    browTilt: 9, browLift: -1.6, eyeOpen: 0.95, gaze: { x: 0, y: 0 },
    mouthCurve: -0.4, lipPress: 0.8,
  },
  grave: {
    browTilt: -8, browLift: 0.4, eyeOpen: 1.04, gaze: { x: 0, y: 0.6 },
    mouthCurve: -0.55,
  },
  wry: {
    // One brow up, and the mouth pulled to one side.
    browTilt: 0, browLift: 0, browLiftRight: 3.2, eyeOpen: 0.9,
    gaze: { x: 1.4, y: -0.4 }, mouthCurve: 0.3, mouthSkew: 2.4,
  },
  thinking: {
    // Eyes up and off to one side, which is what "hold on, let me answer that"
    // looks like on anyone.
    browTilt: -3, browLift: 1, eyeOpen: 0.9, gaze: { x: -2, y: -2 },
    mouthCurve: -0.05, lipPress: 0.85,
  },
}

function expressionFor(mood) {
  return EXPRESSIONS[mood] ?? EXPRESSIONS.neutral
}

// ── Eye ──────────────────────────────────────────────────────────────────────
// Declared at module level, not inside ActorFace: a component defined during a
// render is a different component every render, and React remounts it — which
// would restart the blink on every keystroke in the panel.
//
// Two nested groups on purpose. A CSS animation beats an inline style on the
// same property, so the blink would wipe out the expression's own narrowing if
// both lived on one element: the blink owns the outer group, the expression
// owns the inner one.

function Eye({ geo, look, expr, blinkClass }) {
  const px = geo.cx + expr.gaze.x
  const py = geo.cy + expr.gaze.y
  const irisR = 2.75 * (look.eyeSize ?? 1)

  return (
    <g className={blinkClass} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
      <g style={{ transform: `scaleY(${expr.eyeOpen})`, transformBox: 'fill-box', transformOrigin: 'center' }}>
        {/* Socket shadow, so the eye sits in the face rather than on it */}
        <path d={geo.outline} fill="#000000" opacity="0.16" transform="translate(0 -0.8)" />
        <path d={geo.outline} fill="#edf2f8" />
        <circle cx={px} cy={py} r={irisR} fill={look.eye} />
        <circle cx={px} cy={py} r={irisR} fill="#000000" opacity="0.22" />
        <circle cx={px} cy={py} r={irisR * 0.52} fill="#0d1420" />
        {/* Catchlight. Two pixels of white is the whole difference between a
            face that is looking at you and a mask. */}
        <circle cx={px + 1.2} cy={py - 1.2} r="0.85" fill="#ffffff" opacity="0.92" />
        {/* Hooded upper lid, in skin, drawn over the eye */}
        <path d={geo.lid} fill={look.skin} />
        <path d={geo.lid} fill="#000000" opacity="0.07" />
        {/* Lash line along the lid's lower edge */}
        <path d={geo.lashLine} fill="none" stroke="#2a2118" strokeOpacity="0.6" strokeWidth="1.35" strokeLinecap="round" />
      </g>
    </g>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ActorFace({
  actor,
  mood = 'neutral',
  talking = false,
  idle = true,
  size = 120,
  className = '',
}) {
  const uid    = useId().replace(/:/g, '')
  const look   = resolveAppearance(actor)
  const face   = resolveFace(look)
  const accent = factionAccent(actor?.faction)
  const expr   = expressionFor(mood)

  const m        = headMetrics(face)
  const head     = headPath(face)
  const body     = bodyPaths(face)
  const lines    = ageLines(face)
  const nose     = nosePaths(face)
  const leftEye  = eyeGeometry(face, -1)
  const rightEye = eyeGeometry(face, 1)
  const leftEar  = earGeometry(face, -1)
  const rightEar = earGeometry(face, 1)

  // The expression presses the lips as well as curving them, which is most of
  // what separates "guarded" from "grave".
  const pressed = expr.lipPress ?? 1
  const mouth = mouthPaths(
    { ...face, lipUpper: face.lipUpper * pressed, lipLower: face.lipLower * pressed },
    expr.mouthCurve
  )

  const hair    = hairPath(face)
  const strands = hairStrands(face)
  const glasses = look.glasses ? glassesPaths(face, look.glasses) : null
  const beard   = look.facialHair ? facialHairPath(face, look.facialHair) : null
  const beardOpacity =
    look.facialHair === 'stubble' ? 0.3
      : look.facialHair === 'beard' ? (look.facialHairDensity ?? 0.85)
        : 0.9

  const clipId = `cf-head-${uid}`
  const rimId  = `cf-rim-${uid}`
  const suitId = `cf-suit-${uid}`

  const eyeClass  = idle ? 'cf-portrait-eye' : undefined
  const bodyClass = idle ? 'cf-portrait-body' : undefined

  const pivotL = browPivot(face, -1)
  const pivotR = browPivot(face, 1)

  return (
    <svg
      viewBox="0 0 120 150"
      width={size}
      height={size * 1.25}
      className={className}
      data-testid="actor-face"
      data-mood={mood}
      data-hair={face.hairStyle}
      role="img"
      aria-label={actor?.name ? `Portrait of ${actor.name}` : 'Portrait'}
    >
      <defs>
        {/* Referenced from inside the head group, so it is already in that
            group's coordinate system and needs no transform of its own. */}
        <clipPath id={clipId}>
          <path d={head} />
        </clipPath>
        {/* Rim light down one side of the figure — the single strongest thing
            that makes a flat cutout read as lit from somewhere. */}
        <clipPath id={rimId}>
          <rect x="72" y="0" width="48" height="150" />
        </clipPath>
        {/* Beards have no hard edge. Without this the jaw shape read as a
            chinstrap painted on. */}
        <filter id={`cf-soft-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
        <linearGradient id={suitId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={look.suit} />
          <stop offset="100%" stopColor="#0b1424" />
        </linearGradient>
      </defs>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <g className={bodyClass}>
        <path d={body.shoulders} fill={`url(#${suitId})`} />
        <path d={body.neck} fill={look.skin} />
        {/* The shadow the jaw casts on the neck */}
        <path d={body.neckShade} fill="#000000" opacity="0.17" />
        <path d={body.shirt} fill={look.shirt} />
        <path d={body.collarL} fill={look.shirt} />
        <path d={body.collarR} fill={look.shirt} />
        <path d={body.collarL} fill="#000000" opacity="0.10" />
        <path d={body.tie} fill={look.tie} />
        <path d={body.tieKnot} fill={look.tie} />
        <path d={body.tieKnot} fill="#ffffff" opacity="0.12" />
        <path d={body.lapelL} fill="#000000" opacity="0.24" />
        <path d={body.lapelR} fill="#000000" opacity="0.24" />
        {/* Faction pin — a quiet nod to who they speak for, and the only place
            the accent colour appears on the figure itself. */}
        <circle cx={body.pin.cx} cy={body.pin.cy} r={body.pin.r} fill={accent} opacity="0.85" />
      </g>

      {/* ── Head ──────────────────────────────────────────────────────────── */}
      <g>
        <path d={head} fill={look.skin} />

        {/* Modelling, all clipped to the skull */}
        <g clipPath={`url(#${clipId})`}>
          {/* Shading down one cheek */}
          <path d={head} fill="#000000" opacity="0.09" transform="translate(-15 0)" />
          {/* Warmth across the cheeks */}
          <ellipse cx={leftEye.cx} cy={m.noseY - 2} rx="9" ry="6" fill="#c1614f" opacity="0.10" />
          <ellipse cx={rightEye.cx} cy={m.noseY - 2} rx="9" ry="6" fill="#c1614f" opacity="0.10" />
          {/* Temple hollows, which is where a forehead stops being a dome */}
          <ellipse cx={60 - m.cheekHW * 0.78} cy={m.eyeY - 8} rx="5" ry="7" fill="#000000" opacity="0.07" />
          <ellipse cx={60 + m.cheekHW * 0.78} cy={m.eyeY - 8} rx="5" ry="7" fill="#000000" opacity="0.07" />

          {beard && (
            <path
              d={beard}
              fill={look.hairDark ?? look.hair}
              opacity={beardOpacity}
              filter={`url(#cf-soft-${uid})`}
            />
          )}
        </g>

        {/* Nose. Shadow down the bridge, a filled shadow under the tip, then
            the wings and nostrils — at portrait size a single stroke simply
            disappeared and the face read as having no nose at all. */}
        <path d={nose.bridge} fill="none" stroke="#000000" strokeOpacity="0.2" strokeWidth="1.6" strokeLinecap="round" />
        <path d={nose.tip} fill="#000000" opacity="0.2" />
        <path d={nose.wingL} fill="none" stroke="#000000" strokeOpacity="0.24" strokeWidth="1.3" strokeLinecap="round" />
        <path d={nose.wingR} fill="none" stroke="#000000" strokeOpacity="0.24" strokeWidth="1.3" strokeLinecap="round" />
        <ellipse cx={nose.nostrilL.cx} cy={nose.nostrilL.cy} rx={nose.nostrilL.rx} ry={nose.nostrilL.ry} fill="#000000" opacity="0.38" />
        <ellipse cx={nose.nostrilR.cx} cy={nose.nostrilR.cy} rx={nose.nostrilR.rx} ry={nose.nostrilR.ry} fill="#000000" opacity="0.38" />

        {/* Age lines. Each is drawn at the strength its descriptor asks for, so
            a younger face simply gets nothing rather than a special case. */}
        <g fill="none" stroke="#000000" strokeLinecap="round">
          {lines.nasolabial.map((d, i) => (
            <path key={`nl${i}`} d={d} strokeOpacity={face.nasolabial * 0.38} strokeWidth="1.4" />
          ))}
          {lines.forehead.map((d, i) => (
            <path key={`fh${i}`} d={d} strokeOpacity={face.foreheadLines * 0.32} strokeWidth="1" />
          ))}
          {lines.jowls.map((d, i) => (
            <path key={`jw${i}`} d={d} strokeOpacity={face.jowls * 0.3} strokeWidth="1.1" />
          ))}
          <path d={lines.chinCrease} strokeOpacity="0.12" strokeWidth="1.1" />
          {[leftEye, rightEye].flatMap((eye, e) =>
            eye.crowsFeet.map((d, i) => (
              <path key={`cf${e}-${i}`} d={d} strokeOpacity={face.crowsFeet * 0.38} strokeWidth="0.9" />
            ))
          )}
        </g>

        {/* Under-eye folds sit above the lines but below the eyes themselves */}
        <path d={leftEye.bag} fill="none" stroke="#000000" strokeOpacity={face.underEyeBag * 0.4} strokeWidth="1.2" strokeLinecap="round" />
        <path d={rightEye.bag} fill="none" stroke="#000000" strokeOpacity={face.underEyeBag * 0.4} strokeWidth="1.2" strokeLinecap="round" />

        <Eye geo={leftEye}  look={look} expr={expr} blinkClass={eyeClass} />
        <Eye geo={rightEye} look={look} expr={expr} blinkClass={eyeClass} />

        {/* Lid creases, above the eyes and under the brows */}
        <path d={leftEye.crease} fill="none" stroke="#000000" strokeOpacity="0.18" strokeWidth="1" strokeLinecap="round" />
        <path d={rightEye.crease} fill="none" stroke="#000000" strokeOpacity="0.18" strokeWidth="1" strokeLinecap="round" />

        {/* Brows, rotated about their OUTER ends so the inner ends are what
            move — which is where a face actually carries anger and worry. */}
        <path
          d={browPath(face, -1)}
          fill={look.brow}
          transform={`translate(0 ${-expr.browLift}) rotate(${-expr.browTilt} ${pivotL.x} ${pivotL.y})`}
        />
        <path
          d={browPath(face, 1)}
          fill={look.brow}
          transform={`translate(0 ${-(expr.browLiftRight ?? expr.browLift)}) rotate(${expr.browTilt} ${pivotR.x} ${pivotR.y})`}
        />

        {/* Mouth. While a line is being delivered the closed mouth is replaced
            by an open one that flaps — the arcade convention, and the clearest
            possible signal for "this person is the one speaking right now". */}
        <g transform={expr.mouthSkew ? `translate(${expr.mouthSkew} 0)` : undefined}>
          {talking ? (
            <>
              <ellipse
                cx={mouth.open.cx}
                cy={mouth.open.cy}
                rx={mouth.open.rx}
                ry={mouth.open.ry}
                fill="#40202a"
                className="cf-portrait-mouth-talking"
              />
              <path d={mouth.line} fill="none" stroke="#000000" strokeOpacity="0.35" strokeWidth="1.2" strokeLinecap="round" />
            </>
          ) : (
            <>
              <path d={mouth.lips} fill={look.lip} />
              <path d={mouth.lips} fill="#000000" opacity="0.14" />
              <path d={mouth.line} fill="none" stroke="#5c2f33" strokeOpacity="0.75" strokeWidth="1.5" strokeLinecap="round" />
            </>
          )}
        </g>

        {look.facialHair === 'moustache' && (
          <path d={facialHairPath(face, 'moustache')} fill={look.hairDark ?? look.hair} opacity="0.9" />
        )}

        {/* Glasses, over the face and under the hair */}
        {glasses && (
          <g
            fill="none"
            stroke={glasses.kind === 'thick' ? '#2b3340' : '#a8b2c0'}
            strokeWidth={glasses.kind === 'thick' ? 2.4 : 1.5}
            opacity="0.92"
          >
            {glasses.kind === 'rimless' ? (
              <>
                <path d={glasses.lowerL} />
                <path d={glasses.lowerR} />
              </>
            ) : (
              <>
                <rect x={glasses.left.x}  y={glasses.left.y}  width={glasses.left.w}  height={glasses.left.h}  rx={glasses.left.rBase} />
                <rect x={glasses.right.x} y={glasses.right.y} width={glasses.right.w} height={glasses.right.h} rx={glasses.right.rBase} />
              </>
            )}
            <path d={glasses.bridge} />
            <path d={glasses.armL} />
            <path d={glasses.armR} />
          </g>
        )}

        {/* Hair last, over the forehead */}
        {hair ? (
          <g>
            <path d={hair} fill={look.hair} />
            <path d={hair} fill="none" stroke="#000000" strokeOpacity="0.2" strokeWidth="1" />
            {/* Crown highlight, offset to the lit side */}
            <ellipse cx={60 - m.cheekHW * 0.3} cy={m.topY + 7} rx={m.cheekHW * 0.42} ry="5.5" fill="#ffffff" opacity="0.07" />
            <g fill="none" stroke={look.hairDark ?? look.hair} strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round">
              {strands.map((d, i) => <path key={i} d={d} />)}
            </g>
          </g>
        ) : (
          <g>
            <path d={hairSides(face)} fill={look.hair} />
            <path d={hairSides(face)} fill="#000000" opacity="0.12" />
          </g>
        )}

        {/* Ears, drawn after the hair. Anatomically the hair covers the top of
            the ear, but at this size that hid them completely and the head lost
            its silhouette. */}
        {[leftEar, rightEar].map((ear, i) => (
          <g key={i}>
            <ellipse cx={ear.cx} cy={ear.cy} rx={ear.rx} ry={ear.ry} fill={look.skin} />
            <ellipse cx={ear.cx} cy={ear.cy} rx={ear.rx} ry={ear.ry} fill="#000000" opacity="0.09" />
            <path d={ear.inner} fill="none" stroke="#000000" strokeOpacity="0.22" strokeWidth="1.1" strokeLinecap="round" />
          </g>
        ))}

        {/* Rim light, clipped to one side, over everything on the head */}
        <g clipPath={`url(#${rimId})`} pointerEvents="none">
          <path d={head} fill="none" stroke={accent} strokeOpacity="0.22" strokeWidth="1.6" />
        </g>
      </g>
    </svg>
  )
}
