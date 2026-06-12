import { useAuth } from '../../../context/AuthContext'
import { useAppSettings } from '../../../context/AppSettingsContext'
import { getLevelInfo } from '../../../utils/levelUtils'

// Bottom-left HUD: agent name + level chip + XP bar. Mirrors the 2D
// Profile/Rankings styling so the player recognises their level at a glance.

export default function LevelDisplay() {
  const { user } = useAuth() ?? {}
  const { levels } = useAppSettings() ?? {}
  const info = getLevelInfo(user?.cycleAirstars ?? 0, levels)

  if (!user) return null

  const name = user.displayName || user.username || user.email?.split('@')[0] || 'Agent'

  return (
    <div className="pointer-events-none select-none flex flex-col gap-1.5 px-3 py-2.5 rounded-xl border border-brand-200 bg-slate-100/80 backdrop-blur-sm shadow-lg min-w-[160px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-brand-800 truncate">{name}</span>
        {info && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">
            L{info.level}
          </span>
        )}
      </div>
      {info && (
        <div className="h-1.5 rounded-full bg-slate-300 overflow-hidden">
          <div
            className="h-full bg-brand-600 transition-[width] duration-500"
            style={{ width: `${info.progress}%` }}
          />
        </div>
      )}
    </div>
  )
}
