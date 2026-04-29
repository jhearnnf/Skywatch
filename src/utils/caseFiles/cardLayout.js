/**
 * cardLayout.js
 * Auto-layout for the mobile corkboard view of EvidenceWallStage.
 *
 * Cards are clustered by `category` so related items sit near each other
 * (so red strings between connected items feel intentional, not random).
 * Each cluster is laid out on a soft sub-grid and items are jittered
 * deterministically using a hash of the item id — so positions are stable
 * across re-renders/remounts.
 *
 * No DOM dependencies — pure math, easy to unit test.
 */

const CARD_WIDTH         = 150
const CARD_HEIGHT        = 200
const BOARD_PADDING      = 80   // edge margin around all clusters
const CLUSTER_GAP        = 100  // breathing room between clusters
const CARD_GAP           = 24   // gap between cards within a cluster
const JITTER_PX          = 18   // max jitter per axis from hash

// Stable string-hash used to seed jitter & cluster ordering. Same algorithm
// used elsewhere for rotation hashes — produces a uint32.
function hashStr(s = '') {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h
}

// Map a uint32 to a float in [-1, +1] (consumes 16 bits).
function unitJitter(h, axis) {
  const n = (h >> (axis === 'x' ? 0 : 16)) & 0xffff
  return (n / 0xffff) * 2 - 1
}

/**
 * computeCardPositions(items, options?)
 *
 * Returns:
 *   {
 *     positions: Map<itemId, { x, y }>   ← top-left corner of each card
 *     boardSize: { width, height }
 *     cardSize:  { width, height }
 *   }
 *
 * Coordinates are top-left of each card (NOT center) — the consumer can
 * derive centers as `x + cardWidth/2, y + cardHeight/2`.
 */
export function computeCardPositions(items, options = {}) {
  const cardW   = options.cardWidth  ?? CARD_WIDTH
  const cardH   = options.cardHeight ?? CARD_HEIGHT
  const padding = options.padding    ?? BOARD_PADDING
  const cGap    = options.clusterGap ?? CLUSTER_GAP
  const iGap    = options.cardGap    ?? CARD_GAP
  const jitter  = options.jitter     ?? JITTER_PX

  const positions = new Map()
  if (!items || items.length === 0) {
    return {
      positions,
      boardSize: { width: 600, height: 600 },
      cardSize:  { width: cardW, height: cardH },
    }
  }

  // ── 1. Group items by category ────────────────────────────────────────
  const groups = new Map() // category → items[]
  for (const item of items) {
    const key = (item.category || 'uncategorized').toString()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }

  // Stable cluster order: alphabetical by category name
  const clusters = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))

  // ── 2. Per-cluster sub-grid dimensions ────────────────────────────────
  const clusterDims = clusters.map(([, clusterItems]) => {
    const cols = Math.ceil(Math.sqrt(clusterItems.length))
    const rows = Math.ceil(clusterItems.length / cols)
    return {
      cols,
      rows,
      width:  cols * cardW + (cols - 1) * iGap,
      height: rows * cardH + (rows - 1) * iGap,
    }
  })

  // ── 3. Cluster layout: soft grid of clusters ─────────────────────────
  const numClusters = clusters.length
  const clusterCols = Math.max(1, Math.ceil(Math.sqrt(numClusters)))
  const clusterRows = Math.ceil(numClusters / clusterCols)

  // Row heights / column widths to fit the largest cluster in each row/col
  const colWidths  = new Array(clusterCols).fill(0)
  const rowHeights = new Array(clusterRows).fill(0)
  clusterDims.forEach((dim, idx) => {
    const col = idx % clusterCols
    const row = Math.floor(idx / clusterCols)
    if (dim.width  > colWidths[col])  colWidths[col]  = dim.width
    if (dim.height > rowHeights[row]) rowHeights[row] = dim.height
  })

  // ── 4. Compute total board size ───────────────────────────────────────
  const totalContentW =
    colWidths.reduce((s, w) => s + w, 0) + cGap * (clusterCols - 1)
  const totalContentH =
    rowHeights.reduce((s, h) => s + h, 0) + cGap * (clusterRows - 1)

  const boardWidth  = padding * 2 + totalContentW
  const boardHeight = padding * 2 + totalContentH

  // ── 5. Place each card within its cluster, with deterministic jitter ──
  clusters.forEach(([, clusterItems], clusterIdx) => {
    const dim = clusterDims[clusterIdx]
    const col = clusterIdx % clusterCols
    const row = Math.floor(clusterIdx / clusterCols)

    // Cluster top-left origin
    const clusterX0 =
      padding +
      colWidths.slice(0, col).reduce((s, w) => s + w, 0) +
      cGap * col +
      // Center the cluster within its column slot
      (colWidths[col] - dim.width) / 2

    const clusterY0 =
      padding +
      rowHeights.slice(0, row).reduce((s, h) => s + h, 0) +
      cGap * row +
      (rowHeights[row] - dim.height) / 2

    clusterItems.forEach((item, i) => {
      const cellCol = i % dim.cols
      const cellRow = Math.floor(i / dim.cols)

      const baseX = clusterX0 + cellCol * (cardW + iGap)
      const baseY = clusterY0 + cellRow * (cardH + iGap)

      const h = hashStr(item.id || `i${clusterIdx}-${i}`)
      const jx = unitJitter(h, 'x') * jitter
      const jy = unitJitter(h, 'y') * jitter

      // Clamp into the board so jitter can't push a card off-edge
      const x = Math.max(padding / 2, Math.min(boardWidth  - cardW - padding / 2, baseX + jx))
      const y = Math.max(padding / 2, Math.min(boardHeight - cardH - padding / 2, baseY + jy))

      positions.set(item.id, { x, y })
    })
  })

  return {
    positions,
    boardSize: { width: boardWidth, height: boardHeight },
    cardSize:  { width: cardW, height: cardH },
  }
}
