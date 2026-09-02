export const AUTH_TOKEN_KEY          = 'sw_auth_token'
export const USER_CACHE_KEY          = 'sw_user_cache'
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

// Remembers the user's most recent weekly-leaderboard rank per CBAT game, so the
// leaderboard page can animate their row from its previous position to the new
// one after they finish a game. Written each time the board shows their rank.
export const cbatLastRankKey    = (gameKey) => `sw_cbat_last_rank_${gameKey}`

// Admin-only: whether CBAT boards are shown in the admin view (emails) or the
// ordinary agent view. Absent/'1' = admin view, '0' = agent view. Toggled from
// the CBAT hub; see src/utils/cbatAdminView.js.
export const CBAT_ADMIN_VIEW_KEY = 'sw_cbat_admin_view'

// FLAG's difficulty selection ('easier' | 'hard'). Defaults to 'easier'; once a
// user switches, their most recent choice is what the instructions screen opens
// on next visit.
export const CBAT_FLAG_DIFFICULTY_KEY = 'sw_cbat_flag_difficulty'

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

// Whether the native app has already shown its one-time intro (the landing
// page) on launch. Set the first time a signed-out launch lands there; from
// then on the app opens straight on the CBAT games page. See
// src/hooks/useNativeLaunch.js.
export const NATIVE_INTRO_SEEN_KEY = 'sw_native_intro_seen'

// Defaults to "seen" when storage is unavailable. A user whose storage is
// blocked should get the app, not the sales pitch on every single launch.
export function nativeIntroSeen() {
  try { return localStorage.getItem(NATIVE_INTRO_SEEN_KEY) === '1' } catch { return true }
}

export function markNativeIntroSeen() {
  try { localStorage.setItem(NATIVE_INTRO_SEEN_KEY, '1') } catch { /* storage unavailable */ }
}
