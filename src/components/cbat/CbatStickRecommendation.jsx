import { RECOMMENDED_STICK, RECOMMENDED_PEDALS, storeLink } from '../../utils/cbat/recommendedStick'
import { useHardwareStore } from '../../utils/cbat/hardwareStore'

async function recordClick(item, store) {
  try {
    await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/affiliate/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item, store }),
      keepalive: true,
    })
  } catch { /* A failed stat must never prevent opening the shop. */ }
}

// The hardware recommendation: a third arcade cabinet that stacks under the
// joystick panel while no stick is plugged in.
//
// The joystick panel above it is in attract mode at that point, blinking
// NO JOYSTICK DETECTED in amber. This cabinet is the answer to that: here is
// the stick, and it is the one the official test is flown on. So it borrows
// the JOYSTICK DETECTED pulse for its headline (slow, blue, unhurried) rather
// than the attract blink. One thing on the rail snaps for attention; the thing
// underneath it, which the player has to read and click, holds steady.
//
// Each item is only listed while that device is missing. A player already
// holding the stick does not need to be sold it, and the pitch would be
// sitting under a panel that has just told them their hardware works. With
// nothing left to recommend the cabinet renders nothing at all.
//
// `stick` and `pedals` say which items to list. ACT and RTT pass the stick
// alone. SMA is the only test flown on pedals (its lateral axis is on the
// feet) and the only game that reads them, so it is the only page that ever
// lists them, and it lists each of the two independently of the other: a
// stick plugged in still leaves the pedals to recommend, and vice versa.
//
// The Amazon links are affiliate links, and the disclosure line under them
// is not optional: Amazon's programme requires it on the page the links are
// on, and a reader is owed it anyway.
//
// Which Amazon depends on where the player is. Nearly everyone gets the UK
// store; a player in Canada gets the amazon.ca listing instead, because the
// UK one will not ship to them and we are enrolled there separately.

export default function CbatStickRecommendation({ stick = true, pedals = false, className = '' }) {
  const store = useHardwareStore()
  const items = [stick && RECOMMENDED_STICK, pedals && RECOMMENDED_PEDALS].filter(Boolean)
  if (!items.length) return null

  const intro = stick && pedals
    ? 'The stick and pedals the official test is flown on.'
    : stick
      ? 'The stick the official test is flown on.'
      : 'The pedals the official test is flown on.'

  return (
    <div
      data-stick-recommendation
      data-hardware-store={store}
      className={[
        'cbat-arcade-panel rounded-lg border-2 border-brand-600/40 p-3 text-left',
        className,
      ].filter(Boolean).join(' ')}
    >
      {/* Marquee, matching the joystick cabinet above it. */}
      <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b-2 border-[#12283f]">
        <span className="font-mono text-[10px] font-extrabold uppercase tracking-[0.22em] text-brand-600">
          Hardware
        </span>
        <span className="text-base leading-none" aria-hidden="true">{'\u{1F579}️'}</span>
      </div>

      <p className="cbat-stick-recommend mb-2 text-center font-mono text-base font-extrabold uppercase tracking-[0.16em] leading-tight text-brand-600">
        <span aria-hidden="true" className="mr-1.5">{'▸'}</span>
        Practise like the real thing
        <span aria-hidden="true" className="ml-1.5">{'◂'}</span>
      </p>

      <p className="mb-2 text-xs text-game-muted leading-snug">{intro}</p>

      {/* Each item is set like the device id readout on the joystick panel, so
          the two cabinets read as the same machine, with its own button. */}
      <ul className="mb-2 space-y-1.5">
        {items.map(item => (
          <li key={item.key} data-hardware-item={item.key} className="rounded border border-[#12283f] bg-game-panel px-2 py-1.5">
            <p className="font-mono text-[11px] font-extrabold uppercase tracking-wide text-game-text">
              {item.name}
            </p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-game-muted">
                {item.edition}
              </span>
              <a
                href={storeLink(item, store)}
                onClick={() => { void recordClick(item.key, store) }}
                onAuxClick={event => { if (event.button === 1) void recordClick(item.key, store) }}
                target="_blank"
                rel="sponsored noopener noreferrer"
                className="cbat-arcade-btn shrink-0 rounded bg-brand-600 hover:bg-brand-700 border-b-[#1f5da8] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white cursor-pointer"
              >
                View on Amazon
                <span aria-hidden="true" className="ml-1">{'↗'}</span>
              </a>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-game-muted leading-snug">
        {stick && 'Plug the stick in over USB and ACT, RTT and SMA fly on it, calibrated from the Joystick panel in about twenty seconds.'}
        {stick && pedals && ' '}
        {pedals && 'Plug the pedals in, calibrate them in the Pedals panel, and they take the left and right axis here, as on the test.'}
      </p>

      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        Affiliate link. SkyWatch earns a small commission if you buy, at no extra cost to you.
      </p>
    </div>
  )
}
