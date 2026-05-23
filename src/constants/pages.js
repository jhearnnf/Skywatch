// Curated list of user-facing routes for the Update Notification admin editor.
// The admin picks a target page from this dropdown; the runtime matches it
// against location.pathname when deciding whether to show a notification.
// Empty-string value = "any page" (shown on the first page the user lands on
// after login, until acknowledged).
//
// Keep this list aligned with the <Route path="..."> entries in src/App.jsx.
// New routes won't auto-appear here — that's intentional, so the admin sees
// only stable, user-meaningful destinations.

export const PAGE_OPTIONS = [
  { value: '',          label: 'Any page (show on first load)' },
  { value: '/home',     label: 'Home' },
  { value: '/profile',  label: 'Profile' },
  { value: '/rankings', label: 'Rankings' },
  { value: '/play',     label: 'Play hub' },
  { value: '/cbat',     label: 'CBAT hub' },
  { value: '/case-files', label: 'Case Files' },
  { value: '/subscribe', label: 'Subscribe' },
  { value: '/airstar-history', label: 'Airstar history' },
  { value: '/game-history',    label: 'Game history' },
  { value: '/contact',  label: 'Contact' },
  { value: '/report',   label: 'Report a problem' },
];

export function pageLabelForValue(value) {
  const match = PAGE_OPTIONS.find(o => o.value === value);
  return match ? match.label : (value || 'Any page');
}
