import { PLAY_STORE_URL } from '../utils/appUpdate'

// Takes the whole Profile area when the device is running an older build than
// the newest one we know of: the store's on Android, the live deploy's
// (/version.json) on web. Profile is where people look for
// their version and settings, so an out-of-date app is stopped there and sent
// to the store rather than left to find the small link in the footer.
//
// `onDismiss` backs the "Not now" link; Profile decides how long that lasts.
// `preview` is the admin-only ?previewUpdate=web|android view: same cover plus a note, so
// the design can be checked on web or an up-to-date phone. There "Not now"
// leaves the preview.
//
// The action follows the platform, like the footer control: on web nothing
// stands in the way but the service worker's cached bundle, so the button runs
// `onWebUpdate` (the force refresh) instead of sending anyone to the Play Store.
export default function AppUpdateCover({
  platform, currentVersion, latestVersion, currentBuild, latestBuild,
  preview = false, onDismiss, onWebUpdate, webUpdateBusy = false,
}) {
  const isWeb = platform === 'web'
  // Two web deploys often share a version number, and "v1.2.54 · Latest:
  // v1.2.54" reads as a mistake, so the build id tells them apart.
  const sameVersion = currentVersion && currentVersion === latestVersion
  const label = (v, b) => `v${v}${sameVersion && b ? ` (${b})` : ''}`
  return (
    <div className="max-w-lg mx-auto min-h-[calc(100dvh-10.75rem)] flex items-center justify-center">
      <div
        role="dialog"
        aria-labelledby="app-update-cover-title"
        className="w-full rounded-2xl p-6 card-shadow border border-brand-300/40 text-center flex flex-col items-center gap-4"
        style={{ background: 'linear-gradient(135deg, #0f2850 0%, #081930 100%)' }}
      >
        <div className="w-16 h-16 rounded-2xl bg-brand-200/60 border-2 border-brand-400/50 flex items-center justify-center text-3xl">
          ⬆️
        </div>

        <div className="space-y-2">
          <h1 id="app-update-cover-title" className="text-xl font-extrabold text-slate-900">
            Update available
          </h1>
          <p className="text-sm text-slate-600 max-w-xs mx-auto">
            {isWeb
              ? 'A newer version of SkyWatch is available. Reload to get the latest version and fixes.'
              : 'A newer version of SkyWatch is on Google Play. Update the app to keep using your profile and get the latest fixes.'}
          </p>
        </div>

        {(currentVersion || latestVersion) && (
          <p className="text-xs text-slate-500">
            {currentVersion && <>Your version: {label(currentVersion, currentBuild)}</>}
            {currentVersion && latestVersion && ' · '}
            {latestVersion && <>Latest: {label(latestVersion, latestBuild)}</>}
          </p>
        )}

        {isWeb ? (
          <button
            type="button"
            onClick={onWebUpdate}
            disabled={webUpdateBusy}
            className="w-full inline-flex justify-center px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
          >
            {webUpdateBusy ? 'Getting latest version…' : '⬆️ Get the latest version'}
          </button>
        ) : (
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex justify-center px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors no-underline"
          >
            ⬆️ Update app
          </a>
        )}

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-sm text-slate-500 hover:text-slate-700 transition-colors py-1 px-4"
          >
            Not now
          </button>
        )}

        {preview && (
          <p className="w-full pt-3 border-t border-slate-200 text-[11px] text-slate-500">
            Admin preview of the {isWeb ? 'web' : 'Android'} version. Real users see this when their copy of the app is older than the live version.
          </p>
        )}
      </div>
    </div>
  )
}
