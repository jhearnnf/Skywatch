import { Suspense, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import AircraftDisplay from '../props/AircraftDisplay'
import Interactable from '../interaction/Interactable'
import { getAircraftPlacements } from '../data/aircraftPlacement'
import { modal } from '../state/modalStore'

// All aircraft .glb files placed on plinths inside the bay. Each plinth is
// interactable; activating opens AircraftActionMenu which fetches the
// matching brief by title slug and offers the 2D entry points.

export default function AircraftBayHangar({ spec }) {
  const placements = useMemo(() => getAircraftPlacements(), [])

  // Preload all aircraft GLBs the first time the bay mounts; the existing
  // optimize-models pipeline keeps each one well under our texture/poly
  // budget so the upfront cost is small.
  useMemo(() => {
    for (const p of placements) useGLTF.preload(p.modelUrl)
  }, [placements])

  return (
    <>
      {placements.map((p) => (
        <group key={p.slug} position={[p.slot.x, 0, p.slot.z]}>
          <Suspense fallback={null}>
            <AircraftDisplay modelUrl={p.modelUrl} />
          </Suspense>
          <Interactable
            id={`aircraft-${p.slug}`}
            x={spec.center[0] + p.slot.x}
            z={spec.center[2] + p.slot.z}
            range={2.2}
            label={`Inspect ${p.title}`}
            onActivate={() => modal.open({ kind: 'aircraft', slug: p.slug, title: p.title })}
          />
        </group>
      ))}
    </>
  )
}
