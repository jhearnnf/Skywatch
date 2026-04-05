import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function LoadingOverlay() {
  const { isLoading, loadingStartTime } = useAuth()
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!isLoading) { setElapsed(0); return }
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - loadingStartTime) / 100) / 10)
    }, 100)
    return () => clearInterval(id)
  }, [isLoading, loadingStartTime])

  if (!isLoading) return null

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 9500, background: 'rgba(6,16,30,0.88)', backdropFilter: 'blur(6px)' }}
    >
      <div className="flex flex-col items-center gap-6">
        {/* Radar scope */}
        <div className="relative flex items-center justify-center">
          {/* Expanding pulse rings */}
          <div
            className="absolute rounded-full border border-brand-600/15"
            style={{ width: 160, height: 160, animation: 'radar-ring 2s ease-out infinite' }}
          />
          <div
            className="absolute rounded-full border border-brand-600/20"
            style={{ width: 120, height: 120, animation: 'radar-ring 2s ease-out infinite', animationDelay: '0.6s' }}
          />

          {/* Radar sweep disc */}
          <div
            className="relative rounded-full overflow-hidden border border-brand-600/40"
            style={{
              width: 88, height: 88,
              background: 'radial-gradient(circle at center, #0f2040 0%, #06101e 100%)',
              boxShadow: '0 0 24px rgba(91,170,255,0.12), inset 0 0 12px rgba(91,170,255,0.05)',
            }}
          >
            {/* Rotating sweep */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'conic-gradient(from 0deg, transparent 0%, transparent 65%, rgba(91,170,255,0.25) 80%, rgba(91,170,255,0.7) 100%)',
                animation: 'radar-sweep 1.6s linear infinite',
              }}
            />

            {/* Grid lines */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-full h-px" style={{ background: 'rgba(91,170,255,0.15)' }} />
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="h-full w-px" style={{ background: 'rgba(91,170,255,0.15)' }} />
            </div>

            {/* Inner circle ring */}
            <div
              className="absolute rounded-full border border-brand-600/20"
              style={{ inset: '25%' }}
            />

            {/* Center dot */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-brand-600" style={{ boxShadow: '0 0 6px rgba(91,170,255,0.8)' }} />
            </div>
          </div>
        </div>

        {/* Status text */}
        <div className="text-center flex flex-col items-center gap-1">
          <p
            className="text-brand-600 font-mono font-semibold tracking-[0.35em] uppercase text-xs"
            style={{ textShadow: '0 0 12px rgba(91,170,255,0.5)' }}
          >
            Processing
          </p>
          <p className="text-brand-700 font-mono text-xs tabular-nums">
            {elapsed.toFixed(1)}s
          </p>
          {elapsed >= 8 && (
            <p className="text-text-muted text-xs mt-2 max-w-[180px] text-center leading-relaxed">
              Taking longer than expected.<br />You can refresh if needed.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
