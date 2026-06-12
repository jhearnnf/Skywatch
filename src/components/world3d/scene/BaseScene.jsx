import { Suspense, useCallback, useState } from 'react'
import Lighting from './Lighting'
import ImmerseModel from './ImmerseModel'
import PerimeterColliders from './PerimeterColliders'
import CharacterController from '../character/CharacterController'

const SPAWN = [0, 0, 0]

// Whole-world scene graph. Lighting + the authored scene.glb (auto-fitted to a
// sensible scale, floor at y=0, centred on the origin) + the player. A perimeter
// boundary is registered once the model reports its footprint so the player can
// roam the floor but not walk out of the shell. No interactables are wired up to
// the new scene yet — that comes later.

export default function BaseScene() {
  const [footprint, setFootprint] = useState(null)
  const onFit = useCallback((fit) => setFootprint(fit.footprint), [])

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
      {footprint ? <PerimeterColliders footprint={footprint} /> : null}
      <CharacterController spawn={SPAWN} />
    </>
  )
}
