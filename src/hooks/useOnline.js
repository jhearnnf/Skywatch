import { useEffect, useState } from 'react'
import { isOnline, onNetworkChange } from '../lib/net'

export default function useOnline() {
  const [online, setOnline] = useState(isOnline)
  useEffect(() => {
    const unsubscribe = onNetworkChange(setOnline)
    setOnline(isOnline())
    return unsubscribe
  }, [])
  return online
}
