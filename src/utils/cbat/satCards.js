// Turns a generated SAT situation into the ordered queue of single-fact cards
// the observe phase plays through.
//
// The game used to show the grid, the controller-aircraft panel and the radio
// ticker all at once for a fixed 28s, with the panel listing all four of an
// aircraft's fields together. That made it a divided-attention task. The real
// SAT is serial: one piece of information is on screen, it vanishes, the next
// one appears — "most things are one or two pieces of info at a time, rather
// than everything" (candidate feedback, Aug 2026, after passing the real test
// while scoring badly here).
//
// So both difficulties now present serially and the difficulty is carried by how
// MANY cards there are and how long each one holds (`cardMs` in satDifficulty).
//
// Pure and deterministic — no rng — so a seeded situation produces a seeded
// queue and the tests can pin the ordering.
//
//   buildSatCards(situation, aircraftFields)
//     → [{ kind: 'unit',  unit }
//       |{ kind: 'field', callsign, field, aircraft }
//       |{ kind: 'radio', comm }]

// Round-robin the groups by always taking from whichever still has the most
// left, ties going to the earlier group. That spreads each kind across the whole
// window instead of letting one clump at the front or the tail — a player must
// keep switching what they're encoding, which is the point of the test.
function interleave(groups) {
  const remaining = groups.map(g => [...g]).filter(g => g.length)
  const total = remaining.reduce((n, g) => n + g.length, 0)
  const out = []
  while (out.length < total) {
    let best = 0
    for (let i = 1; i < remaining.length; i++) {
      if (remaining[i].length > remaining[best].length) best = i
    }
    out.push(remaining[best].shift())
  }
  return out
}

export function buildSatCards(situation, aircraftFields) {
  const { units = [], aircraft = [], comms = [] } = situation || {}
  const fields = aircraftFields || []

  const unitCards = units.map(unit => ({ kind: 'unit', unit }))

  // Field-major, not aircraft-major: every aircraft's altitude, then every
  // aircraft's channel. Grouping a callsign's fields together would let the
  // player chunk them into one memory ("York is 250 on Bravo heading D4"), which
  // is exactly the crutch showing them separately is meant to remove.
  const fieldCards = []
  for (const field of fields) {
    for (const ac of aircraft) {
      fieldCards.push({ kind: 'field', callsign: ac.callsign, field, aircraft: ac })
    }
  }

  const radioCards = comms.map(comm => ({ kind: 'radio', comm }))

  return interleave([fieldCards, unitCards, radioCards])
}

// How long the whole observe phase runs for this situation. Derived from the
// queue rather than fixed, because the number of facts is what a difficulty
// tunes — pinning a total instead would silently squeeze Hard's cards down to
// something unreadable.
export function satObserveMs(cards, cardMs) {
  return Math.max(1, cards.length) * cardMs
}
