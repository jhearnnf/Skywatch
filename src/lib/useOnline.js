import { useEffect, useState } from 'react'
import { isOnline, onNetworkChange } from './net'

// Whether the device has a connection, kept live. Same source the send queue
// uses (lib/net.js), so the two never disagree.
export function useOnline() {
  const [online, setOnline] = useState(() => isOnline())
  useEffect(() => onNetworkChange(setOnline), [])
  return online
}
