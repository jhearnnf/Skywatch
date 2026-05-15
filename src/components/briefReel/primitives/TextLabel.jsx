import { motion } from 'framer-motion';
import { LABEL_FILL, BUBBLE_STROKE, TEXT_FG } from '../colors';

// TextLabel — used for show-name and show-text actions. Renders a pill with
// the text inside; supports a strikethrough state for the 'crossout' action.
// Anchored at (cx, cy) — the centre of the pill.

export default function TextLabel({ text, cx, cy, crossed = false, big = false }) {
  if (!text) return null;
  const fontSize = big ? 52 : 34;
  const padX = big ? 32 : 22;
  const padY = big ? 18 : 12;
  const width  = Math.max(140, text.length * (big ? 28 : 18) + padX * 2);
  const height = fontSize + padY * 2;

  return (
    <motion.g
      initial={{ opacity: 0, y: -10, scale: 0.85 }}
      animate={{ opacity: 1, y: 0,    scale: 1    }}
      exit   ={{ opacity: 0, y: -6,   scale: 0.9  }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <rect
        x={cx - width / 2}
        y={cy - height / 2}
        width={width}
        height={height}
        rx={height / 2}
        fill={LABEL_FILL}
        stroke={BUBBLE_STROKE}
        strokeWidth={3}
      />
      <text
        x={cx}
        y={cy + fontSize / 3}
        textAnchor="middle"
        fill={TEXT_FG}
        fontSize={fontSize}
        fontFamily="'Inter',ui-sans-serif,system-ui,sans-serif"
        fontWeight={big ? 700 : 600}
      >
        {text}
      </text>
      {crossed && (
        <motion.line
          x1={cx - width / 2 + 12}
          x2={cx + width / 2 - 12}
          y1={cy}
          y2={cy}
          stroke="#ef4444"
          strokeWidth={6}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      )}
    </motion.g>
  );
}
