import { Suspense, useCallback, useState } from 'react'
import Lighting from './Lighting'
import ImmerseModel from './ImmerseModel'
import PerimeterColliders from './PerimeterColliders'
import SceneColliders from './SceneColliders'
import CharacterController from '../character/CharacterController'
import { SPAWN } from '../data/sceneColliders'

// Set ?colliders=1 on /immerse to draw every collision box as a wireframe.
// Read per render rather than at module load so arriving on the route by a
// client-side navigation picks it up, not just a full page load.
function debugColliders() {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('colliders') === '1'
}

// Whole-world scene graph. Lighting + the authored scene.glb (auto-fitted to a
// sensible scale, floor at y=0, centred on the origin) + the player. Once the
// model reports its fit, two collider sets are registered: the hangar shell and
// its props (SceneColliders), plus a perimeter at the model's outer footprint
// that backstops the player inside the world should the shell ever not.

export default function BaseScene() {
  const [fit, setFit] = useState(null)
  const onFit = useCallback((f) => setFit(f), [])

  return (
    <>
      <Lighting />
      {/* Dark backdrop floor so no void shows through any gaps in the model. */}
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[300, 300]} />
        <meshStandardMaterial color="#06101e" roughness={1} />
      </mesh>
      <Suspense fallback={null}>
        <ImmerseModel onFit={onFit} />
      </Suspense>
      {fit ? <PerimeterColliders footprint={fit.footprint} /> : null}
      {fit ? <SceneColliders fit={fit} debug={debugColliders()} /> : null}
      <CharacterController spawn={SPAWN} />
    </>
  )
}
