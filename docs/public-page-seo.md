# Public CBAT page rendering

`npm run build` captures the real signed-out `/cbat` screen and the four
account-free game introductions into `dist/public-pages/`. Vercel rewrites the
five clean URLs to these files. Other routes retain the existing SPA fallback.
Everyone receives the same HTML; there is no user-agent-specific rendering.

The snapshots use existing page markup and CSS. They remain visible through
the app's normal account/settings loading, then are removed when the real page
commits. The initial entrance animation is skipped for this handover; subsequent
animations and gameplay are unchanged. Returning visitors with cached settings,
an account, a saved theme, or URL parameters use the existing app startup instead
of seeing a default signed-out preview. JavaScript is still required to play.

## Build requirements

- Node 22 (the existing Vite build environment).
- `VITE_API_URL` must point to the intended API. The build reads its public
  settings and aircraft roster anonymously. It never logs in or submits scores.
- Linux builds use `@sparticuz/chromium` from devDependencies. Windows/macOS
  development requires the one-time `npx playwright install chromium` download.
- Rebuild when public game availability or site navigation settings change.
  A missing game introduction fails the capture rather than publishing an empty
  page. The PWA keeps its existing offline app shell and navigation behaviour.

`src/utils/publicPageSeo.js` supplies public-route search descriptions.
`data-static-seo` marks initial metadata for replacement when React takes over,
preventing duplicate homepage and per-page canonicals in React 19.

## Verification

After building, run `npm run check:public-pages`. It checks desktop and mobile
screens against the original SPA, HTML with JavaScript disabled, metadata,
handover opacity and guest game starts. It also checks the saved CBAT theme with
an ANT difficulty query. Screenshots and results are written to
`public-page-checks.local/` (gitignored local verification output).

Transient theme hints and continuous animations are excluded from pixel
comparisons. API writes and analytics are intercepted during browser checks.
Verification output is outside `dist` and is not deployed.

## After deployment

Inspect `/cbat` and the four public game URLs in Google Search Console. Submit
`https://skywatch.academy/sitemap.xml` if not already registered, then request
indexing for those five URLs. Search Console requires the site's owner or a full
user. Indexing and AI citations are not guaranteed.

The existing wildcard robots rules permit Googlebot, OAI-SearchBot, Bingbot and
Google-Extended on these paths. A user-agent HTTP probe is useful, but cannot
prove how a firewall treats requests from the providers' actual IP addresses;
use hosting logs to confirm real crawler access.
