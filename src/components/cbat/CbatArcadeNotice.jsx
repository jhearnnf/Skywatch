// An arcade-cabinet notice for something a player really ought to do before
// they press Start.
//
// The joystick panel showed that a blinking cabinet gets read where a quiet
// tinted box does not. ACT's headphones warning is the other thing on the site
// worth interrupting someone for — the whole test is audio cues, and a player
// on laptop speakers is not finding their callsign — so it gets the same
// treatment rather than the amber note it used to be, which sat between two
// other boxes and was skipped straight past.
//
// The headline blinks; the explanation underneath does not. Same rule as
// attract mode on the joystick panel: the thing a player has to READ must hold
// still. See .cbat-notice-attract and .cbat-notice-idle in main.css.
//
// EMERALD, not the joystick panel's amber. ACT shows both cabinets at once, and
// two amber things blinking at each other is noise — at a glance you could not
// tell which one was talking to you. Green is the furthest hue from amber here,
// and it is the right register anyway: this is a recommendation, not a fault.
// Put headphones on and you are set. Neither panel leans on colour alone; both
// say their piece in words.

export default function CbatArcadeNotice({ title, headline, icon, children, className = '' }) {
  return (
    <div
      className={[
        'cbat-arcade-panel cbat-notice-idle rounded-lg border-2 border-[#1a3a5c] p-3 text-left',
        className,
      ].filter(Boolean).join(' ')}
    >
      <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b-2 border-[#12283f]">
        <span className="font-mono text-[10px] font-extrabold uppercase tracking-[0.22em] text-[#34d399]">
          {title}
        </span>
        {icon && <span className="text-base leading-none" aria-hidden="true">{icon}</span>}
      </div>

      <p className="cbat-notice-attract mb-2 text-center font-mono text-base font-extrabold uppercase tracking-[0.16em] leading-tight">
        <span aria-hidden="true" className="mr-1.5">{'▸'}</span>
        {headline}
        <span aria-hidden="true" className="ml-1.5">{'◂'}</span>
      </p>

      <p className="text-xs text-[#8a9bb5] leading-snug">{children}</p>
    </div>
  )
}
