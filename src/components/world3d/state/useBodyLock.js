import { useEffect } from 'react'

export function useBodyLock(className = 'world3d-locked') {
  useEffect(() => {
    document.body.classList.add(className)
    return () => document.body.classList.remove(className)
  }, [className])
}
