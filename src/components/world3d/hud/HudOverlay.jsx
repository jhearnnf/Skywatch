import LevelDisplay from './LevelDisplay'
import AirstarsHud from './AirstarsHud'
import InteractionPrompt from './InteractionPrompt'

// DOM overlay positioned absolutely over the Canvas. pointer-events: none on
// the wrapper so the canvas still receives clicks for pointer-lock; child
// chips/buttons that need clicks (e.g. action button) re-enable
// pointer-events themselves.

export default function HudOverlay() {
  return (
    <div className="fixed inset-0 z-30 pointer-events-none">
      <div className="absolute bottom-4 left-4">
        <LevelDisplay />
      </div>
      <div className="absolute top-4 right-4">
        <AirstarsHud />
      </div>
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2">
        <InteractionPrompt />
      </div>
    </div>
  )
}
