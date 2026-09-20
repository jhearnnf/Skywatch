// The "SUPPORTER" mark shown beside the name of someone who has donated.
//
// Mirrors <CbatPassedBadge> deliberately: same shape, same slot beside the
// name, same reasons. It is a word rather than a heart or a coin so nobody has
// to guess what it means, and it sits beside the NAME rather than on the
// picture because that is the one place every surface already has room.
//
// Amber rather than the Passed mark's green, so the two read as different kinds
// of fact when they sit side by side: one is something you did in a test room,
// the other is something you did for the site.
//
// The flag behind it (`User.supporter`) is derived from a signed-in donation
// recorded by the Stripe webhook. Someone who gave while logged out cannot be
// told apart from anyone else, so they never get the mark; that is a limit of
// the data, not a policy.
export default function SupporterBadge({ className = '' }) {
  return (
    <span
      role="img"
      aria-label="SkyWatch supporter"
      title="SkyWatch supporter"
      className={`shrink-0 text-[9px] font-bold px-1 py-px rounded bg-amber-200/60 text-amber-800 uppercase tracking-wide ${className}`}
    >
      Supporter
    </span>
  )
}
