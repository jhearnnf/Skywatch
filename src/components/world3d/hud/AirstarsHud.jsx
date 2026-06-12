import { useAuth } from '../../../context/AuthContext'

// Top-right HUD: airstar count. Visual match to the TopBar airstars chip so
// the player has continuity between the 2D app and the world.

export default function AirstarsHud() {
  const { user } = useAuth() ?? {}
  if (!user) return null
  return (
    <div className="pointer-events-none select-none flex items-center gap-1.5 bg-slate-200/80 backdrop-blur-sm rounded-full px-3 py-1.5 border border-slate-300 shadow-lg">
      <span className="text-base star-silver">⭐</span>
      <span className="text-sm font-bold text-white">{user.totalAirstars ?? 0}</span>
    </div>
  )
}
