// Generates a per-submission client id used for idempotent offline sync.
// The backend dedupes on this id so a retried flush (after a dropped response)
// never creates a phantom duplicate row.
export function makeClientId(prefix = 'cri') {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
