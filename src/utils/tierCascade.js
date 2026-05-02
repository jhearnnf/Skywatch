// Tier hierarchy: free ⊆ silver ⊆ gold
// Checking a lower tier forces higher tiers on; unchecking a higher tier forces lower tiers off.
export function applyTierCascade(currentTiers, clickedTier, willBeChecked) {
  const next = new Set(currentTiers)
  if (willBeChecked) {
    next.add(clickedTier)
    if (clickedTier === 'free')   { next.add('silver'); next.add('gold') }
    if (clickedTier === 'silver') { next.add('gold') }
  } else {
    next.delete(clickedTier)
    if (clickedTier === 'gold')   { next.delete('silver'); next.delete('free') }
    if (clickedTier === 'silver') { next.delete('free') }
  }
  return [...next]
}
