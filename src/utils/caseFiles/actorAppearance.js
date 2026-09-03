/**
 * actorAppearance.js
 * What each interrogation actor looks like, as a descriptor faceGeometry.js can
 * build a portrait from.
 *
 * Why drawn rather than photographed: the actors in Case Files are real, living
 * public figures. A drawn portrait needs no licensed photography, sits in the
 * dark intel theme the rest of the game uses, and can react to what was just
 * said. Every field below describes a documented, publicly visible feature —
 * face shape, hairline, colouring, glasses — and none is pushed to an extreme.
 * The goal is a recognisable stand-in, never a caricature.
 *
 * Resolution order, most specific first:
 *   1. actor.appearance      — a chapter can override anything per actor
 *   2. APPEARANCE_BY_KEY     — the figures shipped with the seeded chapters
 *   3. deterministic fallback — hashed from the actor's name, so an actor added
 *      to a chapter later still gets a stable, distinct face
 *
 * Anything a descriptor leaves out falls back to FACE_DEFAULTS in
 * faceGeometry.js, so an entry only has to state what makes that face itself.
 */

import { FACE_DEFAULTS, HAIR_STYLES } from './faceGeometry'

export { HAIR_STYLES }

// ── Palette for generated faces ──────────────────────────────────────────────

const SKIN_TONES = ['#f2cdaa', '#e9bd93', '#d9a077', '#c68a63', '#a9714b', '#8a5a3b']
const HAIR_TONES = ['#22222a', '#4a3a2c', '#6b5844', '#8b8f98', '#b9bcc4', '#d8dbe0']
const SUIT_TONES = ['#1a2434', '#232f42', '#2b3242', '#1f2a24', '#33323a']
const TIE_TONES  = ['#c0392b', '#2563eb', '#0f766e', '#7c3aed', '#b45309', '#334155']
const EYE_TONES  = ['#3b5773', '#4a6b4f', '#5a4632', '#2f4a5c']

const SHIRT = '#eef4fb'
const LIP   = '#b3847c'

// Faction accent, used for the panel behind the portrait and the lapel pin.
// Deliberately not national flag colours: this is a case-file UI, and every
// actor sits in the same dark intel theme.
export const FACTION_ACCENT = {
  RUS:  '#f87171',
  UKR:  '#4ade80',
  USA:  '#5baaff',
  NATO: '#38bdf8',
  EU:   '#a78bfa',
  PRC:  '#fbbf24',
}

export const DEFAULT_ACCENT = '#5baaff'

export function factionAccent(faction) {
  return FACTION_ACCENT[faction] ?? DEFAULT_ACCENT
}

// ── Known figures ────────────────────────────────────────────────────────────
//
// Keyed by systemPromptKey, which is the stable identifier the chapter content
// already carries for "which real person is this". Each entry is a short,
// factual reading of a widely photographed face.

export const APPEARANCE_BY_KEY = {
  // Broad, square face and high cheekbones; a high forehead with the hairline
  // well back; fine pale hair; narrow, hooded blue eyes; a level, thin mouth.
  putin: {
    skin: '#f2cdaa', hair: '#b5b1a6', hairDark: '#918d82', brow: '#a29a8c',
    eye: '#5b7fa0', lip: '#bb8b81', suit: '#1a2434', shirt: SHIRT, tie: '#7f1d1d',
    faceWidth: 1.07, faceLength: 0.95, cheekbone: 1.05, foreheadHeight: 1.12,
    jawWidth: 0.87, jawSquare: 0.7, chinWidth: 0.4,
    eyeSize: 0.87, eyeSpacing: 1.03, hooding: 0.58, underEyeBag: 0.35,
    browThickness: 0.8, browHeight: 0.4, browArch: 0.7,
    noseLength: 1, noseWidth: 0.92,
    mouthWidth: 0.92, lipUpper: 0.68, lipLower: 0.78, mouthCurve: -0.22,
    foreheadLines: 0.22, nasolabial: 0.45, crowsFeet: 0.3, jowls: 0.32,
    hairStyle: 'combed', hairline: 36, recession: 0.72, hairVolume: 0.55,
    part: 'right', sideburns: 0.3,
    glasses: null, facialHair: null, build: 1,
  },

  // A long face with a heavy jaw; thick dark brows under a full head of grey
  // hair swept back; deep lines from nose to mouth; a set, downturned mouth.
  lavrov: {
    skin: '#e9bd93', hair: '#9aa0a8', hairDark: '#7b8189', brow: '#6f6a63',
    eye: '#5a4632', lip: '#ac7f77', suit: '#2a3140', shirt: SHIRT, tie: '#1e3a5f',
    faceWidth: 1.02, faceLength: 1.09, cheekbone: 0.99,
    jawWidth: 0.9, jawSquare: 0.62, chinWidth: 0.42,
    eyeSize: 0.9, hooding: 0.62, underEyeBag: 0.45,
    browThickness: 1.4, browHeight: -0.8, browArch: 0.7, browLength: 1.05,
    noseLength: 1.15, noseWidth: 1.1,
    mouthWidth: 0.95, lipUpper: 0.8, lipLower: 0.9, mouthCurve: -0.3,
    foreheadLines: 0.4, nasolabial: 0.55, crowsFeet: 0.35, jowls: 0.5,
    hairStyle: 'swept', hairline: 37, recession: 0.32, hairVolume: 1.2,
    part: 'left', sideburns: 0.6,
    glasses: null, facialHair: null, build: 1.02,
  },

  // A narrow, long face; white hair, thin on top with the temples back; strong
  // smile lines and a wide mouth that rests slightly turned up.
  biden: {
    skin: '#f0c6a0', hair: '#e4e6ea', hairDark: '#c6c9cf', brow: '#cfd2d6',
    eye: '#4a7fa5', lip: '#b98a82', suit: '#1a2434', shirt: SHIRT, tie: '#2563eb',
    faceWidth: 0.94, faceLength: 1.09, cheekbone: 0.95,
    jawWidth: 0.78, jawSquare: 0.45, chinWidth: 0.32,
    eyeSize: 0.92, hooding: 0.4, underEyeBag: 0.32,
    browThickness: 0.85, browHeight: 0.2, browArch: 0.9,
    noseLength: 1.05, noseWidth: 0.95,
    mouthWidth: 1.1, lipUpper: 0.65, lipLower: 0.7, mouthCurve: 0.3,
    foreheadLines: 0.35, nasolabial: 0.62, crowsFeet: 0.45, jowls: 0.3,
    hairStyle: 'thinning', hairline: 37, recession: 0.6, hairVolume: 0.45,
    part: 'left', sideburns: 0.45,
    glasses: null, facialHair: null, build: 0.97,
  },

  // An even, open face; silver-grey hair with a side parting; smile lines at
  // the eyes and a wide mouth.
  stoltenberg: {
    skin: '#f2cdaa', hair: '#b6bac2', hairDark: '#9298a0', brow: '#9aa0a8',
    eye: '#4a7fa5', lip: '#b98a82', suit: '#2b3242', shirt: SHIRT, tie: '#38bdf8',
    faceWidth: 1.0, faceLength: 1.0, cheekbone: 1.0,
    jawWidth: 0.85, jawSquare: 0.55, chinWidth: 0.36,
    eyeSize: 0.95, hooding: 0.34, underEyeBag: 0.22,
    browThickness: 0.9, browArch: 1.1,
    noseLength: 1, noseWidth: 1,
    mouthWidth: 1.06, lipUpper: 0.85, lipLower: 0.9, mouthCurve: 0.14,
    foreheadLines: 0.3, nasolabial: 0.5, crowsFeet: 0.38, jowls: 0.2,
    hairStyle: 'combed', hairline: 37, recession: 0.3, hairVolume: 0.95,
    part: 'left', sideburns: 0.5,
    glasses: null, facialHair: null, build: 1,
  },

  // A shorter, broader face; dark hair cut short; heavy brows; a close-cropped
  // beard he had grown by late 2021.
  zelensky: {
    skin: '#e7b98f', hair: '#4a3b2c', hairDark: '#332619', brow: '#3a2e22',
    eye: '#6b5138', lip: '#ab7d74', suit: '#20293a', shirt: '#e2eaf4', tie: '#3b4a55',
    faceWidth: 1.05, faceLength: 0.92, cheekbone: 1.03,
    jawWidth: 0.89, jawSquare: 0.62, chinWidth: 0.4,
    eyeSize: 1, hooding: 0.3, underEyeBag: 0.26,
    browThickness: 1.32, browHeight: 0.4, browArch: 0.85,
    noseLength: 0.95, noseWidth: 1.05,
    mouthWidth: 1, lipUpper: 0.9, lipLower: 1, mouthCurve: 0.08,
    foreheadLines: 0.2, nasolabial: 0.3, crowsFeet: 0.25, jowls: 0.12,
    hairStyle: 'cropped', hairline: 38, recession: 0.18, hairVolume: 0.7,
    part: 'left', sideburns: 0.85,
    glasses: null, facialHair: 'beard', facialHairDensity: 0.5, build: 1,
  },

  // The youngest of the group: an oval face, dark hair parted and swept, wide
  // open eyes, very little of the age lining the others carry.
  macron: {
    skin: '#f0c9a4', hair: '#4a3a2c', hairDark: '#33261b', brow: '#3b2f24',
    eye: '#4a6b8a', lip: '#b98a82', suit: '#1a2434', shirt: SHIRT, tie: '#2563eb',
    faceWidth: 0.96, faceLength: 1.0, cheekbone: 1.0,
    jawWidth: 0.82, jawSquare: 0.6, chinWidth: 0.34,
    eyeSize: 1.06, eyeSpacing: 0.98, hooding: 0.14, underEyeBag: 0.1,
    browThickness: 1, browHeight: 0.5, browArch: 1,
    noseLength: 1, noseWidth: 0.92,
    mouthWidth: 1, lipUpper: 0.75, lipLower: 0.8, mouthCurve: 0.04,
    foreheadLines: 0.12, nasolabial: 0.32, crowsFeet: 0.18, jowls: 0.05,
    hairStyle: 'combed', hairline: 37, recession: 0.22, hairVolume: 1.05,
    part: 'right', sideburns: 0.55,
    glasses: null, facialHair: null, build: 0.98,
  },

  // Bald but for the grey round the sides; thin rimless glasses; a compact
  // mouth and a notably level, unmoved set to the face.
  scholz: {
    skin: '#f2cdaa', hair: '#9aa0a8', hairDark: '#7e848c', brow: '#8b9098',
    eye: '#4a7fa5', lip: '#b98a82', suit: '#232f42', shirt: SHIRT, tie: '#1e3a5f',
    faceWidth: 1.03, faceLength: 0.96, cheekbone: 1.01, foreheadHeight: 1.1,
    jawWidth: 0.86, jawSquare: 0.5, chinWidth: 0.38,
    eyeSize: 0.9, hooding: 0.42, underEyeBag: 0.3,
    browThickness: 0.85, browArch: 0.8,
    noseLength: 0.95, noseWidth: 1,
    mouthWidth: 0.88, lipUpper: 0.7, lipLower: 0.75, mouthCurve: -0.05,
    foreheadLines: 0.3, nasolabial: 0.45, crowsFeet: 0.3, jowls: 0.3,
    hairStyle: 'bald', hairline: 30, recession: 1, hairVolume: 0.4,
    part: 'left', sideburns: 0.7,
    glasses: 'rimless', facialHair: null, build: 1.02,
  },

  // A broad, full face and a wide jaw; thick black hair combed back off a high
  // forehead; heavy dark brows; a heavier build than the others.
  xi: {
    skin: '#e9bd93', hair: '#22222a', hairDark: '#12121a', brow: '#1c1c24',
    eye: '#3a2f26', lip: '#ab7d74', suit: '#1a2434', shirt: SHIRT, tie: '#b91c1c',
    faceWidth: 1.13, faceLength: 0.94, cheekbone: 1.07, foreheadHeight: 1.08,
    jawWidth: 0.93, jawSquare: 0.56, chinWidth: 0.44,
    eyeSize: 0.92, eyeSpacing: 1.04, hooding: 0.5, underEyeBag: 0.3,
    browThickness: 1.2, browHeight: 0.5, browArch: 0.7,
    noseLength: 1, noseWidth: 1.08,
    mouthWidth: 0.95, lipUpper: 0.8, lipLower: 0.85, mouthCurve: 0,
    foreheadLines: 0.18, nasolabial: 0.4, crowsFeet: 0.25, jowls: 0.35,
    hairStyle: 'swept', hairline: 36, recession: 0.1, hairVolume: 1.0,
    part: 'left', sideburns: 0.35,
    glasses: null, facialHair: null, build: 1.09,
  },
}

// ── Deterministic fallback ───────────────────────────────────────────────────

/**
 * hashString(str)
 * FNV-1a, 32-bit. Any stable non-cryptographic hash would do; the only
 * requirement is that the same name always picks the same face.
 */
export function hashString(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < String(str).length; i += 1) {
    h ^= String(str).charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function pick(list, seed, salt) {
  return list[(seed + salt) % list.length]
}

// Spreads a hash over a range in fixed steps, so two similar names do not land
// on visibly identical measurements.
function spread(h, shift, min, max, steps) {
  return min + (((h >>> shift) % steps) * (max - min)) / (steps - 1)
}

/**
 * generatedAppearance(seedText)
 * A stable, plausible face for an actor with no entry in APPEARANCE_BY_KEY.
 * It varies the same parameters the hand-written entries do, so a generated
 * face sits in the same visual family rather than looking like a placeholder.
 */
export function generatedAppearance(seedText) {
  const h    = hashString(seedText)
  const hair = pick(HAIR_TONES, h, 3)

  return {
    skin:     pick(SKIN_TONES, h, 0),
    hair,
    hairDark: hair,
    brow:     hair,
    eye:      pick(EYE_TONES, h, 7),
    lip:      LIP,
    suit:     pick(SUIT_TONES, h, 13),
    shirt:    SHIRT,
    tie:      pick(TIE_TONES, h, 17),

    faceWidth:  spread(h, 3,  0.94, 1.1,  7),
    faceLength: spread(h, 7,  0.93, 1.08, 7),
    jawWidth:   spread(h, 11, 0.78, 0.92, 5),
    jawSquare:  spread(h, 15, 0.4,  0.7,  5),
    hooding:    spread(h, 19, 0.15, 0.55, 5),
    browThickness: spread(h, 23, 0.8, 1.35, 5),
    noseWidth:  spread(h, 5,  0.9,  1.1,  5),
    mouthWidth: spread(h, 9,  0.92, 1.08, 5),
    mouthCurve: spread(h, 21, -0.2, 0.25, 5),
    nasolabial: spread(h, 25, 0.2,  0.55, 4),
    recession:  spread(h, 27, 0,    0.6,  5),
    hairVolume: spread(h, 17, 0.5,  1.15, 5),

    hairStyle:  pick(HAIR_STYLES, h, 11),
    part:       h % 2 === 0 ? 'left' : 'right',
    glasses:    h % 5 === 0 ? 'thin' : null,
    facialHair: h % 7 === 0 ? 'stubble' : null,
    build:      spread(h, 13, 0.95, 1.06, 4),
  }
}

/**
 * resolveAppearance(actor)
 * The single entry point ActorFace calls. Always returns a complete descriptor:
 * the face parameters fall back to FACE_DEFAULTS, so a partial entry is fine.
 */
export function resolveAppearance(actor) {
  const seed = actor?.systemPromptKey || actor?.id || actor?.name || 'unknown'
  const base = APPEARANCE_BY_KEY[actor?.systemPromptKey] ?? generatedAppearance(seed)
  return { ...FACE_DEFAULTS, ...base, ...(actor?.appearance ?? {}) }
}
