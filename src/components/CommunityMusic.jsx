import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { NATIVE_APP } from '../utils/appMode'
import { updateCommunityMusic } from '../utils/communityMusic'

// Drives the Community soundtrack from a single place, mirroring
// <CbatMenuMusic>. Every Community surface counts as one zone — moving between
// the channel list, a thread and the console keeps the same track running
// rather than restarting it on each navigation.
//
// Silent inside the native app for the same reason Community is hidden there
// at all: there is no Community to score.
export default function CommunityMusic() {
  const { pathname } = useLocation()

  useEffect(() => {
    const onCommunity =
      !NATIVE_APP && (pathname === '/chat' || pathname.startsWith('/chat/'))
    updateCommunityMusic(onCommunity ? 'community' : null)
  }, [pathname])

  // Belt-and-braces: stop the soundtrack if this ever unmounts.
  useEffect(() => () => updateCommunityMusic(null), [])

  return null
}
