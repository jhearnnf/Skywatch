// The small link under a game's Start button to that test's public page
// (/cbat-tests/<slug>): what the real test is like and what candidates say.
//
// A plain <a>, never a router <Link>: the page is a generated document, not an
// app route, so an in-app navigation would land on the SPA's 404. The href goes
// through cbatTestHref for the same native-app reason as the guide.
//
// Hidden during a Mock Assessment, which locks the player inside the sitting.
import registry from '../../../backend/constants/cbatTestPages.json'
import { cbatTestHref, prepareGuideChrome } from '../../utils/guideHref'
import { useActiveMock } from '../../lib/cbatMockSession'

const BY_TEST = Object.fromEntries(registry.tests.map(t => [t.guideId, t]))

export default function CbatTestPageLink({ test }) {
  const mock = useActiveMock()
  const entry = BY_TEST[test]
  if (!entry || mock) return null
  return (
    <div className="mt-4">
      <a
        href={cbatTestHref(entry.slug)}
        onClick={prepareGuideChrome}
        data-testid="cbat-test-page-link"
        className="text-xs lg:text-sm text-slate-500 hover:text-slate-700 transition-colors"
      >
        What is the real {entry.short} like? Read what candidates say →
      </a>
    </div>
  )
}
