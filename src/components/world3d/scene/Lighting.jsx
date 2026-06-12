// Three-point lighting tuned for flat-shaded toon-style geometry. Ambient
// lifts the shadow side off black; the key light gives volumetric contrast;
// the fill keeps backlit faces readable. No shadow maps — convention.

export default function Lighting() {
  return (
    <>
      <ambientLight intensity={0.55} color="#7090b0" />
      <directionalLight position={[15, 20, 8]} intensity={1.1} color="#ffe9c2" />
      <directionalLight position={[-12, 8, -10]} intensity={0.45} color="#5baaff" />
      <hemisphereLight args={['#82c4ff', '#04101f', 0.3]} />
    </>
  )
}
