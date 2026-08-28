// The "PASSED" mark shown beside the name of someone who has passed the CBAT.
//
// It is a word, not a tick. A green check in the corner of an avatar is the
// verified-account convention every social network uses, so that is what people
// read it as — "this is really them", not "they passed the test". Spelling it
// out costs a little width and removes the ambiguity entirely, which is also
// why it sits beside the NAME rather than on the picture: the name is the one
// place every surface already has room for a label.
//
// The flag behind it (`User.cbatPassed`) is set by hand by an admin, from the
// user telling us they passed. Nothing in the app can work it out — a Skywatch
// score is a practice result, not a real one — so this is only ever shown for a
// verified pass, never for anything the Aptitude Report estimates.
//
// Shown to signed-in agents only. Every caller reads the flag from an
// authenticated response, so a logged-out visitor is never sent it at all.
//
// Shaped like the "Bot" pill it sits alongside in chat, so a channel gains one
// more marker of a kind readers already know rather than a new species of
// decoration.
export default function CbatPassedBadge({ className = '' }) {
  return (
    <span
      role="img"
      aria-label="Passed the CBAT"
      title="Passed the CBAT"
      className={`shrink-0 text-[9px] font-bold px-1 py-px rounded bg-emerald-200/60 text-emerald-800 uppercase tracking-wide ${className}`}
    >
      Passed
    </span>
  )
}
