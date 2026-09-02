import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { updateCommunityMusic } from '../utils/communityMusic'

// Drives the Community soundtrack from a single place, mirroring
// <CbatMenuMusic>. Every Community surface counts as one zone — moving between
// the channel list, a thread and the console keeps the same track running
// rather than restarting it on each navigation.
//
export default function CommunityMusic() {
  const { pathname } = useLocation()

  useEffect(() => {
    const onCommunity = pathname === '/chat' || pathname.startsWith('/chat/')
    updateCommunityMusic(onCommunity ? 'community' : null)
  }, [pathname])

  // Belt-and-braces: stop the soundtrack if this ever unmounts.
  useEffect(() => () => updateCommunityMusic(null), [])

  return null
}
