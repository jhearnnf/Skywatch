import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { listenForTaps, refreshDevice } from '../lib/pushNotifications'

// App-level glue for push notifications. Renders nothing.
//  - Tapping a notification opens the chat it is about.
//  - On sign in, a device that already has notifications on re-sends its
//    address, so a rotated token or a change of account is picked up.
export default function PushNotificationBridge() {
  const navigate = useNavigate()
  const { user, API, apiFetch } = useAuth()
  const userId = user?._id ?? null

  useEffect(() => listenForTaps((url) => navigate(url)), [navigate])

  useEffect(() => {
    if (!userId) return
    refreshDevice({ API, apiFetch })
    // Once per signed-in account per app start; apiFetch identity is not a
    // reason to re-register.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  return null
}
