// Operating systems an Update Notification can be aimed at. `value` must match
// the OS keys the backend stamps on the heartbeat and infers from the
// User-Agent — see backend/constants/clientPlatforms.js (OS_KEYS). Order is
// display order: desktop families first, then mobile.
//
// Selecting none means "every OS", not "no OS". That's the default, and it's
// what every notification written before OS targeting existed behaves as.

export const TARGET_OS_OPTIONS = [
  { value: 'windows', label: 'Windows' },
  { value: 'mac',     label: 'macOS'   },
  { value: 'linux',   label: 'Linux'   },
  { value: 'ios',     label: 'iOS'     },
  { value: 'android', label: 'Android' },
];

export function osLabelForValue(value) {
  return TARGET_OS_OPTIONS.find(o => o.value === value)?.label ?? value;
}

// Short summary of a notification's OS targeting, for the admin list rows.
export function osSummary(targetOs) {
  if (!Array.isArray(targetOs) || targetOs.length === 0) return 'All OSes';
  return targetOs.map(osLabelForValue).join(', ');
}
