import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { buildCumulativeThresholds } from '../utils/subscription'
import { SLIM_APP } from '../utils/appMode'
import { SLIM_LEARN_CATEGORIES } from '../../backend/constants/slimLearn.json'

const Ctx = createContext(null)
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'

// Cache the last successful settings/levels so CBAT (game gating, the Target
// aircraft allowlist, level XP bars) still works offline. Without this, an
// offline fetch failure would fall back to {} and lose the aircraft allowlist.
const SETTINGS_CACHE_KEY = 'sw_app_settings_cache'

function readSettingsCache() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY)) || null } catch { return null }
}
function writeSettingsCache(snapshot) {
  try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(snapshot)) } catch { /* ignore */ }
}

export function AppSettingsProvider({ children }) {
  const cached = readSettingsCache()
  const [settings,        setSettings]        = useState(cached?.settings ?? null)
  const [levels,          setLevels]          = useState(cached?.levels ?? null)
  const [levelThresholds, setLevelThresholds] = useState(
    cached?.levels ? buildCumulativeThresholds(cached.levels) : null,
  )
  const [loading, setLoading]                 = useState(true)

  const fetchSettings = useCallback(() => {
    return Promise.all([
      fetch(`${API}/api/settings`).then(r => r.ok ? r.json() : null),
      fetch(`${API}/api/users/levels`).then(r => r.ok ? r.json() : null),
    ])
      .then(([settingsData, levelsData]) => {
        const resolvedSettings = settingsData ?? {}
        const rawLevels = levelsData?.data?.levels ?? []
        setSettings(resolvedSettings)
        setLevels(rawLevels)
        setLevelThresholds(buildCumulativeThresholds(rawLevels))
        writeSettingsCache({ settings: resolvedSettings, levels: rawLevels })
      })
      .catch(() => {
        // Offline / server unreachable — keep the cached snapshot if we have one.
        const fallback = readSettingsCache()
        if (fallback?.settings) {
          setSettings(fallback.settings)
          setLevels(fallback.levels ?? null)
          setLevelThresholds(fallback.levels ? buildCumulativeThresholds(fallback.levels) : null)
        } else {
          setSettings({})
          setLevels(null)
          setLevelThresholds(null)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  // Slim mode opens Learn one category at a time (backend/constants/slimLearn.json).
  // Stamped onto the settings every consumer reads, so the lock helpers in
  // utils/subscription.js apply the slim rule wherever they are called, the
  // same way the backend's learnScope.js does. Worked out here rather than via
  // useSlimMode because that hook reads this context.
  const slim = SLIM_APP || Boolean(settings?.slimModeEnabled)
  // With the "Learn in Slim Mode" flag off the list is empty, closing everything.
  const scopedSettings = useMemo(
    () => (settings && slim
      ? { ...settings, learnCategoriesOverride: settings.slimLearnEnabled === false ? [] : SLIM_LEARN_CATEGORIES }
      : settings),
    [settings, slim],
  )

  return <Ctx.Provider value={{ settings: scopedSettings, levels, levelThresholds, loading, refreshSettings: fetchSettings }}>{children}</Ctx.Provider>
}

export const useAppSettings = () => useContext(Ctx)
