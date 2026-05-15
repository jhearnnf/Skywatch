import { motion } from 'framer-motion';
import { LABEL_FILL, BUBBLE_STROKE, TEXT_FG } from '../colors';

// Stat / date / text badges for the persistent side ticker. Each variant
// emphasises a different kind of fact:
//   - 'stat':  big value (number/percent/£), small caption beneath
//   - 'date':  date stamp with "EST" hairline above
//   - 'text':  plain text pill, optionally crossed-out
//
// All anchor at (cx, cy) (top-left) and self-size from their content.

export default function StatBadge({ kind = 'text', value, label, text, crossed = false, x = 0, y = 0 }) {
  if (kind === 'stat')  return <StatVariant value={value} label={label} x={x} y={y} />;
  if (kind === 'date')  return <DateVariant date={value || text} x={x} y={y} />;
  return <TextVariant text={text || value || ''} crossed={crossed} x={x} y={y} />;
}

function StatVariant({ value, label, x, y }) {
  const v = String(value ?? '');
  const l = String(label ?? '');
  const width = Math.max(220, Math.max(v.length * 38, l.length * 14) + 48);
  const height = 130;

  return (
    <motion.g
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit   ={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <rect x={x} y={y} width={width} height={height} rx={18}
            fill={LABEL_FILL} stroke={BUBBLE_STROKE} strokeWidth={3} />
      <text x={x + width / 2} y={y + 62}
            textAnchor="middle" fill="#5baaff"
            fontSize={56} fontWeight={800}
            fontFamily="'JetBrains Mono','Fira Code',ui-monospace,monospace">
        {v}
      </text>
      <text x={x + width / 2} y={y + 102}
            textAnchor="middle" fill={TEXT_FG}
            fontSize={22} fontWeight={600}
            fontFamily="'Inter',ui-sans-serif,system-ui,sans-serif"
            style={{ letterSpacing: '0.02em' }}>
        {l}
      </text>
    </motion.g>
  );
}

function DateVariant({ date, x, y }) {
  const d = String(date ?? '');
  const width = Math.max(180, d.length * 26 + 48);
  const height = 90;

  return (
    <motion.g
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit   ={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <rect x={x} y={y} width={width} height={height} rx={14}
            fill={LABEL_FILL} stroke="#f5c542" strokeWidth={3} />
      <text x={x + width / 2} y={y + 26}
            textAnchor="middle" fill="#f5c542"
            fontSize={14} fontWeight={700}
            fontFamily="'JetBrains Mono','Fira Code',ui-monospace,monospace"
            style={{ letterSpacing: '0.18em' }}>
        DATE
      </text>
      <text x={x + width / 2} y={y + 68}
            textAnchor="middle" fill={TEXT_FG}
            fontSize={36} fontWeight={700}
            fontFamily="'JetBrains Mono','Fira Code',ui-monospace,monospace">
        {d}
      </text>
    </motion.g>
  );
}

function TextVariant({ text, crossed, x, y }) {
  const t = String(text ?? '');
  const fontSize = 28;
  const width = Math.max(180, t.length * 16 + 40);
  const height = 64;
  return (
    <motion.g
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: crossed ? 0.6 : 1, x: 0 }}
      exit   ={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <rect x={x} y={y} width={width} height={height} rx={height / 2}
            fill={LABEL_FILL} stroke={BUBBLE_STROKE} strokeWidth={3} />
      <text x={x + width / 2} y={y + fontSize + 12}
            textAnchor="middle" fill={TEXT_FG}
            fontSize={fontSize} fontWeight={600}
            fontFamily="'Inter',ui-sans-serif,system-ui,sans-serif">
        {t}
      </text>
      {crossed && (
        <motion.line
          x1={x + 12} x2={x + width - 12} y1={y + height / 2} y2={y + height / 2}
          stroke="#ef4444" strokeWidth={5} strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      )}
    </motion.g>
  );
}
