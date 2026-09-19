// CBAT games that can be played without an account. Keep this list shared by
// routing and the hub so access and presentation cannot drift apart.
export const PUBLIC_CBAT_GAME_KEYS = Object.freeze([
  'target',
  'ant',
  'symbols',
  'code-duplicates',
])

export const isPublicCbatGame = (key) => PUBLIC_CBAT_GAME_KEYS.includes(key)
