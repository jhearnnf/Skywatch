import { AIRCRAFT_DEFAULT_COLOR, AIRCRAFT_GENERIC_COLOR, TEXT_FG } from '../colors';

// Prop — single component switching on type. All props are designed to be
// roughly 160 wide × 80 tall in local coords (except sky-bg / map which are
// stage-sized — those are rendered by the player as a background layer, not
// via this component).
//
// Use as: <g transform="translate(x,y)"><Prop type=... label=... /></g>

export default function Prop({ type, label }) {
  switch (type) {
    case 'laptop':           return <Laptop label={label} />;
    case 'document':         return <Document label={label} />;
    case 'flag':             return <Flag label={label} />;
    case 'aircraft-typhoon': return <Aircraft variant="typhoon" />;
    case 'aircraft-f35':     return <Aircraft variant="f35" />;
    case 'aircraft-generic': return <Aircraft variant="generic" />;
    case 'helicopter':       return <Helicopter />;
    case 'drone-uav':        return <Drone />;
    case 'missile':          return <Missile />;
    case 'building':         return <Building label={label} />;
    // sky-bg and map render as full-stage backgrounds, not via <Prop>.
    case 'sky-bg':           return null;
    case 'map':              return null;
    default:                 return null;
  }
}

function Laptop({ label }) {
  return (
    <g>
      <rect x={20} y={30} width={120} height={40} rx={4} fill="#102040" stroke="#5baaff" strokeWidth={2} />
      <rect x={28} y={36} width={104} height={28} fill="#0a1f3a" />
      <rect x={4}  y={68} width={152} height={6}  rx={2} fill="#1a3060" />
      {label && (
        <text x={80} y={55} textAnchor="middle" fill="#5baaff"
              fontSize={20} fontFamily="'JetBrains Mono',monospace"
              fontWeight={700} style={{ letterSpacing: '0.12em' }}>
          {label}
        </text>
      )}
    </g>
  );
}

function Document({ label }) {
  return (
    <g>
      <rect x={50} y={6} width={60} height={72} rx={3} fill="#e4ebf3" stroke="#1a3060" strokeWidth={1.5} />
      <line x1={58} y1={20} x2={102} y2={20} stroke="#1a3060" strokeWidth={1} />
      <line x1={58} y1={30} x2={102} y2={30} stroke="#1a3060" strokeWidth={1} />
      <line x1={58} y1={40} x2={92}  y2={40} stroke="#1a3060" strokeWidth={1} />
      {label && (
        <text x={80} y={62} textAnchor="middle" fill="#0c1829"
              fontSize={10} fontFamily="'JetBrains Mono',monospace"
              fontWeight={700} style={{ letterSpacing: '0.08em' }}>
          {label}
        </text>
      )}
    </g>
  );
}

function Flag({ label }) {
  return (
    <g>
      <line x1={20} y1={4} x2={20} y2={78} stroke={TEXT_FG} strokeWidth={2} strokeLinecap="round" />
      <path d="M 20 8 L 90 14 L 70 24 L 90 34 L 20 28 Z" fill="#5baaff" opacity={0.8} stroke="#1a3060" strokeWidth={1} />
      {label && (
        <text x={60} y={58} textAnchor="middle" fill={TEXT_FG}
              fontSize={11} fontFamily="'JetBrains Mono',monospace"
              fontWeight={700} style={{ letterSpacing: '0.1em' }}>
          {label}
        </text>
      )}
    </g>
  );
}

function Aircraft({ variant }) {
  const color = variant === 'generic' ? AIRCRAFT_GENERIC_COLOR : AIRCRAFT_DEFAULT_COLOR;
  if (variant === 'typhoon') {
    // delta wing — wide wings, narrow nose
    return (
      <g>
        <path d="M 10 40 L 70 32 L 140 38 L 150 40 L 140 42 L 70 48 Z" fill={color} stroke="#1a3060" strokeWidth={1.2} />
        <path d="M 40 40 L 70 18 L 78 18 L 70 40 Z" fill={color} stroke="#1a3060" strokeWidth={1.2} />
        <path d="M 40 40 L 70 62 L 78 62 L 70 40 Z" fill={color} stroke="#1a3060" strokeWidth={1.2} />
        <circle cx={130} cy={40} r={4} fill="#0a1f3a" stroke={color} strokeWidth={1.5} />
      </g>
    );
  }
  if (variant === 'f35') {
    // stealth profile — angular, swept
    return (
      <g>
        <path d="M 20 40 L 60 30 L 130 36 L 150 40 L 130 44 L 60 50 Z" fill={color} stroke="#1a3060" strokeWidth={1.2} />
        <path d="M 50 40 L 90 22 L 110 22 L 95 40 Z" fill={color} stroke="#1a3060" strokeWidth={1.2} />
        <path d="M 50 40 L 90 58 L 110 58 L 95 40 Z" fill={color} stroke="#1a3060" strokeWidth={1.2} />
        <circle cx={130} cy={40} r={3.5} fill="#0a1f3a" stroke={color} strokeWidth={1.5} />
      </g>
    );
  }
  // generic — simple swept silhouette
  return (
    <g>
      <ellipse cx={80} cy={40} rx={70} ry={4} fill={color} stroke="#1a3060" strokeWidth={1.2} />
      <path d="M 50 40 L 80 22 L 90 22 L 80 40 Z" fill={color} stroke="#1a3060" strokeWidth={1.2} />
      <path d="M 50 40 L 80 58 L 90 58 L 80 40 Z" fill={color} stroke="#1a3060" strokeWidth={1.2} />
      <circle cx={138} cy={40} r={3.5} fill="#0a1f3a" stroke={color} strokeWidth={1.5} />
    </g>
  );
}

function Helicopter() {
  const color = AIRCRAFT_DEFAULT_COLOR;
  return (
    <g>
      <line x1={20} y1={20} x2={140} y2={20} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <ellipse cx={70} cy={44} rx={36} ry={12} fill={color} stroke="#1a3060" strokeWidth={1.2} />
      <line x1={106} y1={44} x2={150} y2={44} stroke={color} strokeWidth={3} strokeLinecap="round" />
      <path d="M 144 38 L 154 44 L 144 50 Z" fill={color} />
      <line x1={70} y1={22} x2={70} y2={32} stroke={color} strokeWidth={1.5} />
      <circle cx={86} cy={44} r={3} fill="#0a1f3a" stroke={color} strokeWidth={1} />
    </g>
  );
}

function Drone() {
  const color = AIRCRAFT_DEFAULT_COLOR;
  return (
    <g>
      <ellipse cx={80} cy={40} rx={42} ry={3} fill={color} stroke="#1a3060" strokeWidth={1} />
      <path d="M 40 40 L 80 28 L 90 28 L 80 40 Z" fill={color} stroke="#1a3060" strokeWidth={1} />
      <path d="M 40 40 L 80 52 L 90 52 L 80 40 Z" fill={color} stroke="#1a3060" strokeWidth={1} />
      <line x1={120} y1={36} x2={130} y2={36} stroke={color} strokeWidth={1.5} />
      <line x1={120} y1={44} x2={130} y2={44} stroke={color} strokeWidth={1.5} />
    </g>
  );
}

function Missile() {
  const color = '#b8484e';
  return (
    <g>
      <path d="M 10 40 L 130 40 L 150 36 L 150 44 Z" fill={color} stroke="#1a3060" strokeWidth={1.2} />
      <path d="M 30 40 L 50 28 L 58 40 Z" fill={color} stroke="#1a3060" strokeWidth={1} />
      <path d="M 30 40 L 50 52 L 58 40 Z" fill={color} stroke="#1a3060" strokeWidth={1} />
    </g>
  );
}

function Building({ label }) {
  return (
    <g>
      <rect x={30} y={10} width={100} height={70} fill="#1a3060" stroke="#5baaff" strokeWidth={1.2} />
      <rect x={40} y={20} width={12} height={12} fill="#5baaff" opacity={0.4} />
      <rect x={60} y={20} width={12} height={12} fill="#5baaff" opacity={0.4} />
      <rect x={80} y={20} width={12} height={12} fill="#5baaff" opacity={0.4} />
      <rect x={100} y={20} width={12} height={12} fill="#5baaff" opacity={0.4} />
      <rect x={40} y={40} width={12} height={12} fill="#5baaff" opacity={0.4} />
      <rect x={60} y={40} width={12} height={12} fill="#5baaff" opacity={0.4} />
      <rect x={80} y={40} width={12} height={12} fill="#5baaff" opacity={0.4} />
      <rect x={100} y={40} width={12} height={12} fill="#5baaff" opacity={0.4} />
      <rect x={70} y={60} width={20} height={20} fill="#0c1829" stroke="#5baaff" strokeWidth={1} />
      {label && (
        <text x={80} y={94} textAnchor="middle" fill={TEXT_FG}
              fontSize={11} fontFamily="'JetBrains Mono',monospace"
              fontWeight={700} style={{ letterSpacing: '0.1em' }}>
          {label}
        </text>
      )}
    </g>
  );
}
