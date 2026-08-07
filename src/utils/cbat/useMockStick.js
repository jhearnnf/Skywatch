import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { wantsMockStick, installMockStick } from './mockGamepad'

// Installs the synthetic joystick when an admin loads a CBAT game with
// ?stick=mock. See mockGamepad.js for what it pretends to be and why.
//
// Reads window.location directly rather than through the router, for the same
// reason useAdminRoundParam does: it is read once, needs no reactivity, and
// every CBAT page test stubs react-router-dom by hand.
//
// Returns true while the mock is installed, so an intro screen can say so.
// Nothing renders during play — a debug badge over a running game is exactly
// the overlay the CBAT games do not have.
export function useMockStick() {
  const { user } = useAuth()
  const isAdmin = !!user?.isAdmin

  // Read once, in a lazy initialiser, rather than setting state from the
  // effect: the URL cannot change under a mounted game, so a state update
  // announcing what it said on mount is a cascading render for nothing.
  const [wanted] = useState(() => (
    wantsMockStick(typeof window === 'undefined' ? '' : window.location.search)
  ))
  const active = isAdmin && wanted

  useEffect(() => {
    if (!active) return
    const mock = installMockStick()
    return () => mock.dispose()
  }, [active])

  return active
}
