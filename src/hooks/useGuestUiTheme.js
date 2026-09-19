import { useCallback, useEffect, useState } from 'react'
import { GUEST_UI_THEME_EVENT, GUEST_UI_THEME_KEY, readGuestUiTheme, saveGuestUiTheme } from '../lib/uiTheme'

// Keep a logged-out visitor's choice on this device. The custom event updates
// this tab immediately; the storage event keeps any other open tabs in sync.
export function useGuestUiTheme() {
  const [theme, setTheme] = useState(readGuestUiTheme)

  useEffect(() => {
    const sync = () => setTheme(readGuestUiTheme())
    const syncStorage = (event) => { if (event.key === GUEST_UI_THEME_KEY) sync() }
    window.addEventListener(GUEST_UI_THEME_EVENT, sync)
    window.addEventListener('storage', syncStorage)
    return () => {
      window.removeEventListener(GUEST_UI_THEME_EVENT, sync)
      window.removeEventListener('storage', syncStorage)
    }
  }, [])

  const choose = useCallback((nextTheme) => {
    const saved = saveGuestUiTheme(nextTheme)
    setTheme(saved)
    return saved
  }, [])

  return [theme, choose]
}

export default useGuestUiTheme
