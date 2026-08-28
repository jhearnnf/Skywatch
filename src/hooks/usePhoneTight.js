import { useEffect } from 'react'

// Halves .app-shell-content's py-6 at phone width, for the pages that have to fit
// the viewport instead of scrolling. 48px of padding is a third of a CBAT tile
// row, or two lines of the report form's textarea, and both pages have plenty of
// whitespace around their heading and their last element to give it back from.
//
// A body class rather than a prop on AppShell because .app-shell-content's
// padding is a Tailwind utility, and only an unlayered rule in main.css reliably
// beats one — the same reason .cbat-route and .cbat-dpt-fullwidth are written
// this way. The rule itself lives in main.css; see `body.phone-tight`.
//
// Any page using this and then pinning its own height to the viewport should
// deduct 10rem plus the safe area: topbar 3.5rem, the tightened 0.75rem above
// and below, and .app-shell-main's 5rem BottomNav reservation.
export function usePhoneTight() {
  useEffect(() => {
    document.body.classList.add('phone-tight')
    return () => document.body.classList.remove('phone-tight')
  }, [])
}
