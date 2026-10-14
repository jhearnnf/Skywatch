import { createContext, useContext, useLayoutEffect } from 'react'

// The desktop CBAT chat dock's shared state (see CbatLoungeDock.jsx). null when
// there is no dock: phones, signed out, chat switched off, tests. The hub reads
// it for the open/split state the panel and its column share.
export const DockContext = createContext(null)
export const useLoungeDock = () => useContext(DockContext)

// Called by the three-column joystick layout while it is on screen: those pages
// need more width before the column fits, and lay themselves out differently
// beside it (see CbatStickLayout).
export function useRegisterStickLayout(active) {
  const dock = useLoungeDock()
  const register = dock?.registerStick
  const has = Boolean(register)
  useLayoutEffect(() => {
    if (!active || !has) return
    return register()
    // `register` is rebuilt every render; only presence matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, has])
  return {
    docked:       Boolean(dock?.docked),
    // The box above the docked chat the right-hand panel is portalled into,
    // and the ref the grid hands back so that box lines up with the card.
    upperEl:      dock?.upperEl ?? null,
    setStickGrid: dock?.setStickGrid,
  }
}
