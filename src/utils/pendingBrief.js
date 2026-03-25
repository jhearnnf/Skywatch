export const PENDING_BRIEF_KEY = 'sw_pending_brief'

/**
 * If a guest was reading a brief before signing in, complete it on their behalf
 * and store the coin/streak data for BriefReader to display.
 *
 * Returns the brief ID if one was consumed, otherwise null.
 */
export async function consumePendingBrief({ API, setUser, navigate }) {
  const id = localStorage.getItem(PENDING_BRIEF_KEY)
  if (!id) return null
  try {
    const res  = await fetch(`${API}/api/briefs/${id}/complete`, { method: 'POST', credentials: 'include' })
    const data = await res.json()
    if (res.ok && data?.data) {
      // Fetch succeeded — remove from localStorage now so BriefReader's fallback doesn't re-fire
      localStorage.removeItem(PENDING_BRIEF_KEY)
      sessionStorage.setItem('sw_brief_coins', JSON.stringify(data.data))
      sessionStorage.setItem('sw_brief_just_completed', id)
      if (data.data.loginStreak !== undefined && setUser) {
        setUser(u => u ? {
          ...u,
          loginStreak:    data.data.loginStreak,
          lastStreakDate: data.data.lastStreakDate ?? u.lastStreakDate,
        } : u)
      }
    }
    // If fetch returned non-ok, leave localStorage intact so BriefReader's fallback fires
  } catch { /* non-fatal — localStorage stays so BriefReader fallback can award coins */ }
  return id
}
