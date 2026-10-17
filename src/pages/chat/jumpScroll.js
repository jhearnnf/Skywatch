// Centre a message row inside the list that scrolls it.
//
// Not scrollIntoView: that scrolls every scrollable ancestor too, and the CBAT
// lounge lives in a fixed dock beside a page with its own scroller. A jump to a
// search result should move the chat and nothing else.
export function centerInScroller(scroller, row) {
  if (!scroller || !row) return false
  const box = scroller.getBoundingClientRect()
  const at  = row.getBoundingClientRect()
  scroller.scrollTop += (at.top - box.top) - (scroller.clientHeight - at.height) / 2
  return true
}

// How long a jumped-to message stays tinted. Long enough to find it on screen,
// short enough that it does not read as a standing state like a mention.
export const JUMP_HIGHLIGHT_MS = 2500
