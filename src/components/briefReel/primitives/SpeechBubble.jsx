import { motion, AnimatePresence } from 'framer-motion';
import { BUBBLE_FILL, BUBBLE_STROKE, TEXT_FG } from '../colors';

// SpeechBubble — anchored at (0,0); the tail points DOWN to that point and
// the rest of the bubble floats directly above. Width auto-sizes to the
// text; longer strings wrap onto a second line and grow the bubble's height
// accordingly so nothing overflows. The prompt allows speak text up to 60
// characters — sized to comfortably hold that.

const FONT_SIZE  = 36;
const CHAR_W     = 19;      // approximate per-char width for the chosen font/size
const SOFT_BREAK = 22;      // characters per line before we wrap onto two lines

export default function SpeechBubble({ text, maxWidth = 720 }) {
  const hasText = !!text;
  const lines   = hasText ? wrapText(String(text), SOFT_BREAK) : [''];
  const longest = lines.reduce((m, ln) => Math.max(m, ln.length), 0);
  const width   = Math.max(180, Math.min(maxWidth, longest * CHAR_W + 60));
  const lineH   = FONT_SIZE + 18;
  const height  = lines.length * lineH + 26;
  const tailH   = 18;

  // AnimatePresence wraps the conditional render so the bubble runs its
  // exit animation when text empties. Returning null directly (the earlier
  // behaviour) bypassed exit entirely, causing the bubble to disappear in
  // a single frame at beat boundaries — perceived as a hard cut.
  return (
    <AnimatePresence>
      {hasText && (
      <motion.g
        key={text}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        exit   ={{ opacity: 0, scale: 0.6 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        style={{ transformOrigin: '0% 100%' }}
      >
        <rect
          x={-width / 2}
          y={-(height + tailH)}
          width={width}
          height={height}
          rx={20}
          fill={BUBBLE_FILL}
          stroke={BUBBLE_STROKE}
          strokeWidth={4}
        />
        <path
          d={`M -14 ${-tailH} L 14 ${-tailH} L 0 0 Z`}
          fill={BUBBLE_FILL}
          stroke={BUBBLE_STROKE}
          strokeWidth={4}
        />
        {lines.map((ln, i) => {
          // Centre each line vertically inside the bubble box. Bubble runs
          // from y=-(height+tailH) to y=-tailH; first line baseline sits
          // one line-height down from the top.
          const baseY = -(height + tailH) + 16 + (i + 1) * lineH - 8;
          return (
            <text
              key={i}
              x={0}
              y={baseY}
              textAnchor="middle"
              fill={TEXT_FG}
              fontSize={FONT_SIZE}
              fontFamily="'Inter',ui-sans-serif,system-ui,sans-serif"
              fontWeight={700}
            >
              {ln}
            </text>
          );
        })}
      </motion.g>
      )}
    </AnimatePresence>
  );
}

// Break the text into up to two lines, preferring whitespace near the
// midpoint. Anything short enough stays on one line. We deliberately don't
// split mid-word — if the only option is mid-word, we keep one long line
// and let the width grow.
function wrapText(s, softLimit) {
  if (!s) return [''];
  if (s.length <= softLimit) return [s];
  const target = Math.floor(s.length / 2);
  let breakAt = -1;
  for (let off = 0; off < s.length / 2; off++) {
    const a = target + off, b = target - off;
    if (a < s.length && s[a] === ' ') { breakAt = a; break; }
    if (b > 0 && s[b] === ' ')        { breakAt = b; break; }
  }
  if (breakAt < 0) return [s]; // no whitespace — single wide line
  return [s.slice(0, breakAt), s.slice(breakAt + 1)];
}
