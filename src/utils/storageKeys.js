export const AUTH_TOKEN_KEY          = 'sw_auth_token'
export const PENDING_BRIEF_KEY       = 'sw_pending_brief'
export const PENDING_ONBOARDING_KEY  = 'sw_pending_onboarding'
export const POST_LOGIN_DEST_KEY     = 'sw_post_login_destination'
export const BRIEF_COINS_KEY         = 'sw_brief_coins'
export const BRIEF_JUST_COMPLETED_KEY = 'sw_brief_just_completed'

export const briefSectionKey    = (briefId) => `sw_brief_sec_${briefId}`
export const tutorialKey        = (userId, name) => `sw_tut_v2_${userId}_${name}`
export const tutorialClearedKey = (userId) => `sw_tut_cleared_at_${userId}`
