// The Community count badge, in one place so the sidebar, the bottom nav and
// the conversation rail all cap and label it the same way.

// Past this the exact figure stops being information and starts being wallpaper
// — "12" and "40" prompt the same shrug — so the badge stops counting and says
// "lots" instead. It also keeps the pill from outgrowing the nav emoji it sits
// on.
export const MAX_BADGE_COUNT = 9

export const badgeText = (count) =>
  count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count)

// Screen readers get the real number, uncapped: "9+" is a layout compromise,
// not a fact about the mailbox.
export const badgeLabel = (count) =>
  `${count} new message${count === 1 ? '' : 's'} for you`

// The admin support queue counts THREADS waiting on a staff reply, not
// messages — one thread can hold several. Worded separately so the console
// badge says what it actually counts.
export const supportQueueLabel = (count) =>
  `${count} support thread${count === 1 ? '' : 's'} waiting for a reply`
