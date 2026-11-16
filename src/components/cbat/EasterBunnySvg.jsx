// The Easter theme's bunny (see CbatHolidayTheme): side-on, facing right. The
// caller mirrors it for a leftward hop.
export default function EasterBunnySvg() {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.45))' }}>
      {/* ears: far one shaded, near one with a pink inner */}
      <ellipse cx="24" cy="7.5" rx="2.2" ry="6" transform="rotate(14 24 7.5)" fill="#e2e8f0" />
      <ellipse cx="20" cy="7" rx="2.4" ry="6.5" transform="rotate(-12 20 7)" fill="#f8fafc" />
      <ellipse cx="20" cy="7.5" rx="1.1" ry="4.8" transform="rotate(-12 20 7.5)" fill="#f9a8d4" />
      {/* back foot, body, tail */}
      <ellipse cx="9" cy="27.5" rx="5" ry="2" fill="#e2e8f0" />
      <ellipse cx="13" cy="21" rx="9.5" ry="7.5" fill="#f8fafc" />
      <circle cx="3.8" cy="18.5" r="2.8" fill="#ffffff" />
      {/* head, front paw */}
      <circle cx="23" cy="16" r="6" fill="#f8fafc" />
      <ellipse cx="20" cy="28" rx="2.6" ry="1.6" fill="#e2e8f0" />
      {/* eye, nose, cheek */}
      <circle cx="25.2" cy="14.8" r="1.1" fill="#0f172a" />
      <circle cx="28.6" cy="17" r="0.9" fill="#ec4899" />
      <circle cx="24.5" cy="18.4" r="1.3" fill="#fbcfe8" opacity="0.8" />
    </svg>
  )
}
