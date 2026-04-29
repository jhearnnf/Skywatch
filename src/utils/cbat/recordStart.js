export async function recordCbatStart(gameKey, apiFetch, API) {
  try {
    await apiFetch(`${API}/api/games/cbat/${gameKey}/start`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // swallow — game start must never fail because of this call
  }
}
