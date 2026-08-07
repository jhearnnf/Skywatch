import { useEffect, useRef, useState } from 'react'
import { captureEvent } from '../lib/posthog'

function TikTokIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.94a8.16 8.16 0 0 0 4.77 1.52V7.05a4.85 4.85 0 0 1-1.84-.36z"/>
    </svg>
  )
}

function XIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  )
}

const SOCIAL_LINKS = [
  {
    platform: 'tiktok',
    label: 'TikTok',
    href: 'https://www.tiktok.com/@skywatch.academy',
    Icon: TikTokIcon,
    comingSoon: false,
  },
  {
    platform: 'x',
    label: 'X',
    href: 'https://x.com/SkyWatchAcademy',
    Icon: XIcon,
    comingSoon: false,
  },
]

export default function SocialLinks({ source, className = '' }) {
  const [openId, setOpenId] = useState(null)
  const containerRef = useRef(null)

  useEffect(() => {
    if (openId === null) return
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpenId(null)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [openId])

  function track(link) {
    captureEvent('social_click', {
      platform: link.platform,
      source,
      coming_soon: link.comingSoon,
    })
  }

  return (
    <div ref={containerRef} className={`flex items-center justify-center gap-4 ${className}`}>
      {SOCIAL_LINKS.map(link => {
        const { Icon } = link
        const isOpen = openId === link.platform

        if (link.comingSoon) {
          return (
            <div key={link.platform} className="relative">
              <button
                type="button"
                aria-label={`${link.label} — launching soon`}
                onClick={() => {
                  track(link)
                  setOpenId(prev => (prev === link.platform ? null : link.platform))
                }}
                onMouseEnter={() => setOpenId(link.platform)}
                onMouseLeave={() => setOpenId(prev => (prev === link.platform ? null : prev))}
                className="text-slate-500 hover:text-brand-600 transition-colors p-1.5 cursor-help"
              >
                <Icon className="w-5 h-5 opacity-60" />
              </button>
              {isOpen && (
                <span
                  role="tooltip"
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-surface-raised border border-slate-300 text-[10px] font-semibold uppercase tracking-wider text-slate-700 whitespace-nowrap pointer-events-none z-10"
                >
                  Launching soon
                </span>
              )}
            </div>
          )
        }

        return (
          <a
            key={link.platform}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={link.label}
            onClick={() => track(link)}
            className="text-slate-500 hover:text-brand-600 transition-colors p-1.5"
          >
            <Icon className="w-5 h-5" />
          </a>
        )
      })}
    </div>
  )
}
