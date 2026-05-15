import { lazy } from 'react'

// Ordered scenes for the Intel Brief preview window.
// `gate(settings, user)` returns true when the scene should appear. Scenes are
// lazy-loaded so the landing page doesn't pull every game's atoms upfront.
//
// To add a new scene: drop a file in ../scenes/, add an entry here, and the
// PreviewWindow picks it up. Order is the playback order.
const IntelRecallScene    = lazy(() => import('../scenes/IntelRecallScene'))
const PriorityPathwayScene = lazy(() => import('../scenes/PriorityPathwayScene'))
const FlashcardsScene      = lazy(() => import('../scenes/FlashcardsScene'))
const WhosAtAircraftScene  = lazy(() => import('../scenes/WhosAtAircraftScene'))
const BattleOfOrderScene   = lazy(() => import('../scenes/BattleOfOrderScene'))
const AptitudeSyncScene    = lazy(() => import('../scenes/AptitudeSyncScene'))
const CaseFilesScene       = lazy(() => import('../scenes/CaseFilesScene'))

export function buildIntelBriefScenes(settings, user) {
  const s = settings ?? {}
  const isAdmin = !!user?.isAdmin
  const all = [
    {
      id: 'priority-pathway',
      title: 'CHOOSE YOUR TOPIC',
      subtitle: 'Pick a category. Climb the path.',
      durationMs: 4200,
      accent: '#5baaff',
      Component: PriorityPathwayScene,
      gate: () => true,
    },
    {
      id: 'intel-recall',
      title: 'PASS THE INTEL RECALL',
      subtitle: 'Multi-choice questions tied to every brief',
      durationMs: 5800,
      accent: '#5baaff',
      Component: IntelRecallScene,
      gate: () => true,
    },
    {
      id: 'flashcards',
      title: 'COLLECT FLASHCARDS',
      subtitle: 'Read the brief, name it from memory',
      durationMs: 4500,
      accent: '#f59e0b',
      Component: FlashcardsScene,
      gate: () => true,
    },
    {
      id: 'whos-at-aircraft',
      title: 'GROW AIRCRAFT KNOWLEDGE',
      subtitle: "Spot the aircraft, pin its home base",
      durationMs: 4800,
      accent: '#ef4444',
      Component: WhosAtAircraftScene,
      gate: () => true,
    },
    {
      id: 'battle-of-order',
      title: 'WIN THE BATTLE OF ORDER',
      subtitle: 'Sequence aircraft, ranks and missions',
      durationMs: 4500,
      accent: '#a78bfa',
      Component: BattleOfOrderScene,
      gate: () => true,
    },
    {
      id: 'aptitude-sync',
      title: 'SYNC YOUR KNOWLEDGE',
      subtitle: 'Aptitude-style interview challenge',
      durationMs: 4500,
      accent: '#22c55e',
      Component: AptitudeSyncScene,
      // Aptitude Sync respects feature + tier gating
      gate: (s, u) => {
        if (!s.aptitudeSyncEnabled) return false
        if (u?.isAdmin) return true
        // Public landing visitor (no user) — show only if not locked behind a tier.
        // If tier list is non-empty and admin-only, hide for public visitors.
        const tiers = Array.isArray(s.aptitudeSyncTiers) ? s.aptitudeSyncTiers : []
        if (!u && (tiers.length === 0 || (tiers.length === 1 && tiers[0] === 'admin'))) return false
        return true
      },
    },
    {
      id: 'case-files',
      title: 'GATHER INTELLIGENCE',
      subtitle: 'Investigate cases, interrogate suspects',
      durationMs: 4800,
      accent: '#fbbf24',
      Component: CaseFilesScene,
      gate: (s) => !!s.caseFilesEnabled,
    },
  ]
  return all.filter(scene => scene.gate(s, user))
}
