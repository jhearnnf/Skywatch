import { describe, it, expect } from 'vitest'
import config from '../../capacitor.config.ts'

// The Android GoogleAuth plugin resolves its client ID as:
//   androidClientId → clientId → R.string.server_client_id
// serverClientId is NOT in that chain (it's the iOS/offline key), so a config with
// only serverClientId silently falls back to the plugin's placeholder string
// resource ("Your Web Client Key") and every sign-in fails with DEVELOPER_ERROR.
describe('capacitor.config — GoogleAuth', () => {
  const google = config.plugins.GoogleAuth

  it('sets a client ID key the Android plugin actually reads', () => {
    expect(google.androidClientId ?? google.clientId).toMatch(/\.apps\.googleusercontent\.com$/)
  })

  it('uses the same Web client ID for Android and the server', () => {
    // requestIdToken() must mint a token whose audience matches the backend's
    // GOOGLE_CLIENT_ID, so these cannot drift apart.
    expect(google.androidClientId).toBe(google.serverClientId)
  })
})
