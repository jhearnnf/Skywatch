import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function Overlay({
  zIndex = 50,
  backdrop = 'rgba(8, 14, 30, 0.88)',
  onDismiss,
  lockBodyScroll = false,
  respectSafeArea = true,
  className = '',
  style,
  children,
  'data-testid': testId,
}) {
  useEffect(() => {
    if (!lockBodyScroll || typeof document === 'undefined') return
    const body = document.body
    const scrollY = window.scrollY
    const prev = {
      position:           body.style.position,
      top:                body.style.top,
      left:               body.style.left,
      right:              body.style.right,
      width:              body.style.width,
      overflow:           body.style.overflow,
      touchAction:        body.style.touchAction,
      overscrollBehavior: body.style.overscrollBehavior,
    }
    body.style.position           = 'fixed'
    body.style.top                = `-${scrollY}px`
    body.style.left               = '0'
    body.style.right              = '0'
    body.style.width              = '100%'
    body.style.overflow           = 'hidden'
    body.style.touchAction        = 'none'
    body.style.overscrollBehavior = 'none'
    return () => {
      Object.assign(body.style, prev)
      window.scrollTo(0, scrollY)
    }
  }, [lockBodyScroll])

  if (typeof document === 'undefined') return null

  const baseStyle = {
    position: 'fixed',
    inset: 0,
    zIndex,
    ...(backdrop !== false && { background: backdrop }),
    ...style,
  }

  function handleClick(e) {
    if (onDismiss && e.target === e.currentTarget) onDismiss()
  }

  const el = (
    <div
      className={`${respectSafeArea ? 'safe-area-inset' : ''} ${className}`.trim()}
      style={baseStyle}
      onClick={handleClick}
      data-testid={testId}
    >
      {children}
    </div>
  )

  return createPortal(el, document.body)
}
