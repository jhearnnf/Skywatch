import { motion } from 'framer-motion';
import { factionColor } from '../colors';
import RankBadge from '../../RankBadge';

// Stickman — anchored at (0,0) with head at top, feet at y≈134.
// The viewBox-friendly local coordinate space is 80 wide × 160 tall.
// Use a wrapping <g transform="translate(x,y) scale(...)"> when placing on stage.
//
// Articulation:
//   Each limb is split at a mid-joint so the figure can bend like a real
//   stickman drawing. Arms: shoulder → elbow → hand. Legs: hip → knee →
//   foot. The resting pose keeps every joint nearly straight, so a non-
//   moving stickman looks the same as the old jointless version — the
//   joints only become visible when an animation pulls a limb out of line.
//
// Modes:
//   'standing'  — default
//   'saluting'  — right arm bends at elbow, hand goes to forehead (one-
//                 shot via saluteCount key bump)
//   'arguing'   — both forearms raised in fists-up agitation pose
//   'piloting'  — body hidden, just head + helmet (rest is the aircraft)
//
// Walk cycle:
//   When walkCount bumps (driven by ActorOnStage detecting position
//   changes), the legs play a 2-step cycle keyframe over ~0.6s — matches
//   the framer-motion translate that's moving the actor across stage,
//   so feet step while the body slides. After the cycle, legs settle
//   back into the resting pose.

// ── Fixed anchors ───────────────────────────────────────────────────────────
const HEAD_CY     = 28;
const HEAD_R      = 14;
const NECK_Y      = 42;
const SHOULDER_Y  = 55;
const SHOULDER_X  = 40;
const HIP_X       = 40;
const HIP_Y       = 95;

// ── Resting joint positions ─────────────────────────────────────────────────
// Arms hang straight down with a barely-perceptible outward angle so the
// elbows are visible as line breaks. Legs are nearly straight, knees at
// the midpoint of the thigh-to-foot run.
const REST = {
  // Arms
  leftElbow:  { x: 28, y: 73 },
  leftHand:   { x: 24, y: 90 },
  rightElbow: { x: 52, y: 73 },
  rightHand:  { x: 56, y: 90 },
  // Legs — feet planted wider than the body, knees on the centreline of
  // each leg so the figure stands stable.
  leftKnee:   { x: 32, y: 114 },
  leftFoot:   { x: 28, y: 134 },
  rightKnee:  { x: 48, y: 114 },
  rightFoot:  { x: 52, y: 134 },
};

// ── Arguing pose ────────────────────────────────────────────────────────────
// Both forearms raised, fists in front of chest. Combined with the outer
// motion.g rotational shake, reads as "agitated debate".
const ARGUE = {
  leftElbow:  { x: 30, y: 70 },
  leftHand:   { x: 34, y: 56 },
  rightElbow: { x: 50, y: 70 },
  rightHand:  { x: 46, y: 56 },
};

// ── Salute (right-arm-only one-shot) ────────────────────────────────────────
// Keyframe ARRAYS the right elbow + right hand visit during the salute.
// Times [0, 0.18, 0.65, 1] match the existing 1.4s cadence: snap up at
// 18%, hold at-forehead until 65%, drop back to rest by 100%.
//
//   t=0     resting → arm down
//   t=0.18  elbow up-out, hand pulled in toward forehead
//   t=0.65  hold position
//   t=1     back to rest
const SALUTE_KEYFRAMES = {
  rightElbowX: [REST.rightElbow.x, 60, 60, REST.rightElbow.x],
  rightElbowY: [REST.rightElbow.y, 50, 50, REST.rightElbow.y],
  rightHandX:  [REST.rightHand.x,  46, 46, REST.rightHand.x],
  rightHandY:  [REST.rightHand.y,  32, 32, REST.rightHand.y],
};

// ── Walk cycle ─────────────────────────────────────────────────────────────
// Two-step gait over the actor's translate duration. Left foot lifts and
// plants forward, then right foot lifts and plants. Knees bend visibly
// during the lift phase (knee Y moves UP, knee X tilts forward over the
// foot). Foot Y dips up briefly on lift, back to ground on plant.
//
// Times distribute evenly across the cycle so the legs read as a real
// stride rather than a single hop.
const WALK_T = [0, 0.18, 0.36, 0.54, 0.72, 0.9, 1];
const WALK_KEYFRAMES = {
  // LEFT leg lifts first (frames 1-2), then plants and pushes (3-4),
  // then RIGHT leg lifts (5-6).
  leftKneeX:  [32, 30, 34, 36, 34, 32, 32],
  leftKneeY:  [114, 106, 110, 114, 116, 115, 114],
  leftFootX:  [28, 22, 32, 36, 32, 28, 28],
  leftFootY:  [134, 122, 130, 134, 132, 133, 134],
  rightKneeX: [48, 50, 48, 46, 50, 52, 48],
  rightKneeY: [114, 116, 115, 114, 106, 110, 114],
  rightFootX: [52, 56, 52, 48, 58, 50, 52],
  rightFootY: [134, 132, 133, 134, 122, 130, 134],
};
const WALK_DURATION_S = 0.6;

export default function Stickman({
  faction = 'civilian',
  headgear = 'none',
  mode = 'standing',
  saluteCount = 0,
  walkCount   = 0,
  rank,
  shortLabel,
}) {
  const c = factionColor(faction);

  // Pick the static pose targets for non-walk-cycle joints. Walking
  // overrides the legs via keyframes below; arguing overrides the arms.
  const isArguing  = mode === 'arguing';
  const isSaluting = saluteCount > 0 && !isArguing;

  const armPose = isArguing ? ARGUE : REST;

  // Cap badge — only for peaked caps (cap-acm / cap-officer) on RAF actors
  // with a rank ≥ 2. Rendered INSIDE the Stickman so it scales with the
  // figure and tracks every gesture/breath/walk transform. Earlier the
  // badge lived outside and was sized to the wrapper rather than the cap
  // band, which made it look like a separate disc floating on the head.
  const hasCapBadge =
    rank != null && rank > 1 &&
    (faction === 'raf-primary' || faction === 'raf-secondary') &&
    (headgear === 'cap-acm' || headgear === 'cap-officer');

  return (
    <g>
      {/* head */}
      <circle cx={SHOULDER_X} cy={HEAD_CY} r={HEAD_R}
              fill="none" stroke={c} strokeWidth={3} />

      {/* headgear */}
      <Headgear type={headgear} color={c} />

      {/* Cap badge — small gold insignia mounted on the crown band. The
          dark navy ellipse simulates the cloth/leather backing of a real
          metal cap badge; the gold rim hints at the badge's metal edge.
          Both the backing and the insignia render in the stickman's local
          coordinate space, so the ACTOR_SCALE outside scales them
          together with the cap — keeps the badge feeling welded to the
          hat rather than mounted on the wrapper. */}
      {hasCapBadge && (
        <g>
          <ellipse cx={40} cy={15} rx={6} ry={4.5}
                   fill="#06101e" stroke="#f5c542" strokeWidth={0.4} opacity={0.94} />
          <g transform="translate(35, 10)">
            <RankBadge rankNumber={rank} size={10} color="#f5c542" />
          </g>
        </g>
      )}

      {mode !== 'piloting' && (
        <>
          {/* spine */}
          <line x1={SHOULDER_X} y1={NECK_Y} x2={HIP_X} y2={HIP_Y}
                stroke={c} strokeWidth={3} strokeLinecap="round" />

          {/* LEFT ARM — upper (shoulder→elbow) + forearm (elbow→hand).
              Arguing animates BOTH segments to the agitated pose. */}
          <motion.line
            x1={SHOULDER_X} y1={SHOULDER_Y}
            animate={{ x2: armPose.leftElbow.x, y2: armPose.leftElbow.y }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            stroke={c} strokeWidth={3} strokeLinecap="round"
          />
          <motion.line
            animate={{
              x1: armPose.leftElbow.x, y1: armPose.leftElbow.y,
              x2: armPose.leftHand.x,  y2: armPose.leftHand.y,
            }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            stroke={c} strokeWidth={3} strokeLinecap="round"
          />

          {/* RIGHT ARM — same split, plus the salute one-shot. During a
              salute we override the keyframed motion onto both segments;
              when not saluting we drive to the resting/arguing pose. The
              key={saluteCount} pattern remounts on each new salute so the
              keyframe array replays from frame 0. */}
          <motion.line
            key={`r-upper-${saluteCount}`}
            x1={SHOULDER_X} y1={SHOULDER_Y}
            initial={{ x2: armPose.rightElbow.x, y2: armPose.rightElbow.y }}
            animate={
              isSaluting
                ? { x2: SALUTE_KEYFRAMES.rightElbowX, y2: SALUTE_KEYFRAMES.rightElbowY }
                : { x2: armPose.rightElbow.x, y2: armPose.rightElbow.y }
            }
            transition={
              isSaluting
                ? { duration: 1.4, times: [0, 0.18, 0.65, 1], ease: 'easeOut' }
                : { duration: 0.35, ease: 'easeOut' }
            }
            stroke={c} strokeWidth={3} strokeLinecap="round"
          />
          <motion.line
            key={`r-fore-${saluteCount}`}
            initial={{
              x1: armPose.rightElbow.x, y1: armPose.rightElbow.y,
              x2: armPose.rightHand.x,  y2: armPose.rightHand.y,
            }}
            animate={
              isSaluting
                ? {
                    x1: SALUTE_KEYFRAMES.rightElbowX, y1: SALUTE_KEYFRAMES.rightElbowY,
                    x2: SALUTE_KEYFRAMES.rightHandX,  y2: SALUTE_KEYFRAMES.rightHandY,
                  }
                : {
                    x1: armPose.rightElbow.x, y1: armPose.rightElbow.y,
                    x2: armPose.rightHand.x,  y2: armPose.rightHand.y,
                  }
            }
            transition={
              isSaluting
                ? { duration: 1.4, times: [0, 0.18, 0.65, 1], ease: 'easeOut' }
                : { duration: 0.35, ease: 'easeOut' }
            }
            stroke={c} strokeWidth={3} strokeLinecap="round"
          />

          {/* LEGS — walk cycle when walkCount bumps, otherwise rest.
              Each leg has thigh (hip→knee) and shin (knee→foot). All four
              segments animate in sync so the knee and ankle move together. */}
          <motion.line
            key={`l-thigh-${walkCount}`}
            x1={HIP_X} y1={HIP_Y}
            initial={{ x2: REST.leftKnee.x, y2: REST.leftKnee.y }}
            animate={
              walkCount > 0
                ? { x2: WALK_KEYFRAMES.leftKneeX, y2: WALK_KEYFRAMES.leftKneeY }
                : { x2: REST.leftKnee.x, y2: REST.leftKnee.y }
            }
            transition={
              walkCount > 0
                ? { duration: WALK_DURATION_S, times: WALK_T, ease: 'easeInOut' }
                : { duration: 0.3, ease: 'easeOut' }
            }
            stroke={c} strokeWidth={3} strokeLinecap="round"
          />
          <motion.line
            key={`l-shin-${walkCount}`}
            initial={{
              x1: REST.leftKnee.x, y1: REST.leftKnee.y,
              x2: REST.leftFoot.x, y2: REST.leftFoot.y,
            }}
            animate={
              walkCount > 0
                ? {
                    x1: WALK_KEYFRAMES.leftKneeX, y1: WALK_KEYFRAMES.leftKneeY,
                    x2: WALK_KEYFRAMES.leftFootX, y2: WALK_KEYFRAMES.leftFootY,
                  }
                : {
                    x1: REST.leftKnee.x, y1: REST.leftKnee.y,
                    x2: REST.leftFoot.x, y2: REST.leftFoot.y,
                  }
            }
            transition={
              walkCount > 0
                ? { duration: WALK_DURATION_S, times: WALK_T, ease: 'easeInOut' }
                : { duration: 0.3, ease: 'easeOut' }
            }
            stroke={c} strokeWidth={3} strokeLinecap="round"
          />
          <motion.line
            key={`r-thigh-${walkCount}`}
            x1={HIP_X} y1={HIP_Y}
            initial={{ x2: REST.rightKnee.x, y2: REST.rightKnee.y }}
            animate={
              walkCount > 0
                ? { x2: WALK_KEYFRAMES.rightKneeX, y2: WALK_KEYFRAMES.rightKneeY }
                : { x2: REST.rightKnee.x, y2: REST.rightKnee.y }
            }
            transition={
              walkCount > 0
                ? { duration: WALK_DURATION_S, times: WALK_T, ease: 'easeInOut' }
                : { duration: 0.3, ease: 'easeOut' }
            }
            stroke={c} strokeWidth={3} strokeLinecap="round"
          />
          <motion.line
            key={`r-shin-${walkCount}`}
            initial={{
              x1: REST.rightKnee.x, y1: REST.rightKnee.y,
              x2: REST.rightFoot.x, y2: REST.rightFoot.y,
            }}
            animate={
              walkCount > 0
                ? {
                    x1: WALK_KEYFRAMES.rightKneeX, y1: WALK_KEYFRAMES.rightKneeY,
                    x2: WALK_KEYFRAMES.rightFootX, y2: WALK_KEYFRAMES.rightFootY,
                  }
                : {
                    x1: REST.rightKnee.x, y1: REST.rightKnee.y,
                    x2: REST.rightFoot.x, y2: REST.rightFoot.y,
                  }
            }
            transition={
              walkCount > 0
                ? { duration: WALK_DURATION_S, times: WALK_T, ease: 'easeInOut' }
                : { duration: 0.3, ease: 'easeOut' }
            }
            stroke={c} strokeWidth={3} strokeLinecap="round"
          />
        </>
      )}

      {/* short label under feet */}
      {shortLabel && (
        <text
          x={SHOULDER_X} y={152}
          textAnchor="middle"
          fill="#ddeaf8"
          fontSize={11}
          fontFamily="'JetBrains Mono','Fira Code',ui-monospace,monospace"
          opacity={0.78}
          style={{ letterSpacing: '0.04em' }}
        >
          {shortLabel}
        </text>
      )}
    </g>
  );
}

function Headgear({ type, color }) {
  switch (type) {
    case 'cap-acm':
      return (
        <g>
          <path d="M 22 16 L 58 16 L 56 22 L 24 22 Z" fill={color} />
          <rect x={24} y={11} width={32} height={6} fill={color} />
          <rect x={24} y={11} width={32} height={1.5} fill="#ddeaf8" opacity={0.7} />
          <line x1={24} y1={20} x2={56} y2={20} stroke="#f5c542" strokeWidth={1.2} />
        </g>
      );
    case 'cap-officer':
      return (
        <g>
          <path d="M 24 17 L 56 17 L 54 22 L 26 22 Z" fill={color} />
          <rect x={26} y={12} width={28} height={6} fill={color} />
        </g>
      );
    case 'beret':
      return (
        <g>
          <path d="M 22 18 Q 38 6 56 12 Q 52 22 28 22 Z" fill={color} />
        </g>
      );
    case 'flight-helmet':
      return (
        <g>
          <path d="M 24 26 Q 24 8 40 8 Q 56 8 56 26 Z" fill={color} opacity={0.88} />
          <rect x={26} y={22} width={28} height={6} fill="#1a3a5c" />
          <rect x={26} y={22} width={28} height={2} fill="#5baaff" opacity={0.55} />
        </g>
      );
    case 'combat-helmet':
      return (
        <path d="M 22 26 Q 22 12 40 12 Q 58 12 58 26 Z" fill={color} opacity={0.85} />
      );
    case 'hardhat':
      return (
        <g>
          <path d="M 24 24 Q 24 14 40 14 Q 56 14 56 24 Z" fill="#f5c542" />
          <rect x={22} y={23} width={36} height={3} fill="#f5c542" />
        </g>
      );
    case 'civilian-hat':
      return (
        <g>
          <ellipse cx={40} cy={20} rx={18} ry={2.5} fill={color} />
          <rect x={30} y={12} width={20} height={8} fill={color} />
        </g>
      );
    case 'none':
    default:
      return null;
  }
}
