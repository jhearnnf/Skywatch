export const AUTH_TOKEN_KEY          = 'sw_auth_token'
export const PENDING_BRIEF_KEY       = 'sw_pending_brief'
export const PENDING_ONBOARDING_KEY  = 'sw_pending_onboarding'
export const POST_LOGIN_DEST_KEY     = 'sw_post_login_destination'
export const BRIEF_COINS_KEY         = 'sw_brief_coins'
export const BRIEF_JUST_COMPLETED_KEY = 'sw_brief_just_completed'
export const CRO_FIRST_BRIEF_KEY     = 'sw_cro_first_brief'

export const briefSectionKey    = (briefId) => `sw_brief_sec_${briefId}`
export const tutorialKey        = (userId, name) => `sw_tut_v2_${userId}_${name}`
export const tutorialClearedKey = (userId) => `sw_tut_cleared_at_${userId}`
export const lastSeenStreakKey  = (userId) => `sw_last_seen_streak_${userId}`

// CRO "first brief" flag — set when the user picks a category in the welcome
// flow so BriefReader can suppress in-brief navigation that would derail the
// funnel. TTL keeps a stale flag from leaking into a later session.
const CRO_FIRST_BRIEF_TTL_MS = 30 * 60 * 1000

export function setCroFirstBrief() {
  try { sessionStorage.setItem(CRO_FIRST_BRIEF_KEY, String(Date.now())) } catch { /* storage unavailable */ }
}

export function isCroFirstBriefActive() {
  try {
    const raw = sessionStorage.getItem(CRO_FIRST_BRIEF_KEY)
    if (!raw) return false
    const ts = Number(raw)
    if (!Number.isFinite(ts) || ts <= 0) return false
    if (Date.now() - ts > CRO_FIRST_BRIEF_TTL_MS) {
      sessionStorage.removeItem(CRO_FIRST_BRIEF_KEY)
      return false
    }
    return true
  } catch { return false }
}

export function clearCroFirstBrief() {
  try { sessionStorage.removeItem(CRO_FIRST_BRIEF_KEY) } catch { /* storage unavailable */ }
}
