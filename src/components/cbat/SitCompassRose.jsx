// The SIT compass rose. The red needle is north.
//
// Drawn in two places: beside each study layer, turned by the same amount as
// the layer, and over the bottom of the camera pass, where it turns with the
// camera. Every study layer carries one, turned or not, so a turned layer is
// told apart by where the needle points rather than by a rose suddenly
// appearing.
//
// `needleRef` is for the clip: the camera moves every frame, and re-rendering
// React sixty times a second to turn one SVG group would be waste. The scene
// writes the needle's transform ATTRIBUTE straight onto this group. It has to
// be the attribute, not a CSS transform: Safari ignores CSS transforms on SVG
// children (see the Instruments dials).
export default function SitCompassRose({
  rotation = 0,
  needleRef,
  testId = 'sit-compass',
  label,
}) {
  return (
    <svg
      viewBox="-20 -20 40 40"
      className="block w-full h-auto"
      role="img"
      aria-label={label ?? (rotation ? `Compass: this map is turned ${rotation} degrees` : 'Compass: north is up')}
      data-testid={testId}
      data-rotation={rotation}
    >
      <circle r={18} fill="var(--color-game-arena)" stroke="#13294a" strokeWidth={1.5} />
      <g ref={needleRef} transform={rotation ? `rotate(${rotation})` : undefined}>
        <polygon points="0,-13 3.5,0 -3.5,0" fill="#ef4444" />
        <polygon points="0,13 3.5,0 -3.5,0" fill="#64748b" />
        <polygon points="-13,0 0,-2.5 0,2.5" fill="#334155" />
        <polygon points="13,0 0,-2.5 0,2.5" fill="#334155" />
        <text x={0} y={-14.5} fill="#ef4444" fontSize={6} fontWeight="bold" textAnchor="middle">N</text>
      </g>
    </svg>
  )
}
