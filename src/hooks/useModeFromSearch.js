import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

// Lets a link name which mode of a multi-mode game page to open.
//
// Trace and Visualisation both remember the mode you last played, which is
// right when you navigate in yourself and wrong when something linked you to a
// specific one — the landing page's game wall has a tile per mode, and without
// this, tapping "Trace Practise 3D" opened Trace 1.
//
// Deliberately narrow:
//   • applied once per mount, so it can't fight the admin-gating fallback that
//     moves you off a disabled mode;
//   • unknown values are ignored rather than passed to the setter, which would
//     validate them down to the default and wipe a real stored preference;
//   • `apply` of null (a demo mount, where the mode is pinned by prop) makes
//     the whole thing a no-op.
//
// The value is written through the page's own setter, so it persists exactly
// as picking the mode by hand does.
export function useModeFromSearch(validModes, apply) {
  const [searchParams] = useSearchParams()
  const requested = searchParams.get('mode')
  const appliedRef = useRef(false)

  useEffect(() => {
    if (appliedRef.current || !apply) return
    if (!requested || !validModes.includes(requested)) return
    appliedRef.current = true
    apply(requested)
  }, [requested, validModes, apply])
}

export default useModeFromSearch
