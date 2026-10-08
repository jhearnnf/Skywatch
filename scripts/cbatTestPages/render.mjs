// Renders the public CBAT test pages: /cbat-tests (the index) and one page per
// test at /cbat-tests/<slug>.
//
// Why these exist: Search Console showed almost no non-brand traffic. The only
// crawlable CBAT content was one very long guide, which cannot rank for "cbat
// dpt" or "cbat flag test" the way a page about that one test can. Every game
// route except four sits behind the login, so nothing else was indexable.
//
// The pages are static documents in the guide's family, not SPA routes, for the
// same reason the guide is: a crawler gets the whole text in the first
// response. Their content comes from three places:
//   - the guide's TESTS array (what candidates say about the real test), read
//     live from public/cbat-guide.html so the two can never disagree;
//   - scripts/cbatTestPages/copy.js (what our own game lets you practise);
//   - backend/constants/cbatTestPages.json (slug, title, description, links).
// Plus optional anonymous totals from GET /api/games/cbat/public-stats.
//
// Pure functions only: no file or network access here, so the build script,
// the dev server and the tests all render through exactly the same code.
import { formatTitle, SITE_URL, SITE_NAME } from '../../src/utils/seoTitle.js'
import { loadGuideData, loadGuideStyle, loadGuideAnalytics } from './loadGuideData.mjs'
import { PRACTISE, SIMULATION_NOTE } from './copy.js'

export const INDEX_PATH = '/cbat-tests'
export const pagePath = slug => `${INDEX_PATH}/${slug}`

const INDEX_TITLE = 'Every CBAT Test Explained, With Free Practice'
const INDEX_DESCRIPTION =
  'Every CBAT subtest explained in plain words: what each one is like, what candidates say catches them out, and where to practise it free.'

// Below this the stats would read as thin rather than reassuring, and small
// cohorts edge towards identifying people. The endpoint applies the same
// floors; this is a second line of defence for a stale or hand-edited payload.
const MIN_RUNS_SHOWN = 200
const MIN_COHORT_SHOWN = 20

const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const stripTags = s => String(s).replace(/<[^>]+>/g, '')

// The extra rules a test page needs on top of the guide's stylesheet. Everything
// else (facts, chips, brief panel, sim box, tiles, masthead, footer) is the
// guide's own CSS, so the two read as one family and change together.
const PAGE_CSS = `
.page{max-width:900px;margin:0 auto;padding:0 32px 90px}
.masthead .wrap{max-width:900px;grid-template-columns:1fr}
.masthead .sub{max-width:var(--measure)}
.page main{padding-top:36px}
.crumbs{font:600 13px/1.4 var(--sans);color:var(--ink3);margin-bottom:14px}
.crumbs a{color:var(--ink3)}
.page h2{margin-top:52px}
.page .lead{max-width:var(--measure)}
.cta{display:inline-block;margin:22px 0 6px;padding:13px 22px;border-radius:7px;background:var(--brand);
  color:var(--paper);font:700 16px var(--sans);text-decoration:none}
.cta:hover{filter:brightness(1.08)}
.fine{font:13.5px/1.6 var(--sans);color:var(--ink3);max-width:var(--measure)}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0 4px}
.stats .tile{flex:1 1 220px}
.rel{list-style:none;padding:0;margin:18px 0;display:grid;gap:10px}
.rel li{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:13px 16px;box-shadow:var(--lift)}
.rel a{font:650 16px/1.4 var(--sans)}
.rel span{display:block;font:14px/1.55 var(--sans);color:var(--ink3);margin-top:3px}
.grp-h{font:700 12px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);margin:36px 0 0}
@media (max-width:960px){.page{padding:0 16px 64px}}
`

function head({ title, description, path, jsonLd, style, analytics }) {
  const url = `${SITE_URL}${path}`
  const full = formatTitle(title)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escAttr(full)}</title>
<meta name="description" content="${escAttr(description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<meta name="theme-color" content="#1d3f76">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="${escAttr(full)}">
<meta property="og:description" content="${escAttr(description)}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="article">
<meta property="og:image" content="${SITE_URL}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(full)}">
<meta name="twitter:description" content="${escAttr(description)}">
<meta name="twitter:image" content="${SITE_URL}/og-image.png">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
${analytics}
<style>${style}${PAGE_CSS}</style>
</head>`
}

function breadcrumbLd(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({
      '@type': 'ListItem', position: i + 1, name, item: `${SITE_URL}${path}`,
    })),
  }
}

// Inside the Android app these documents are opened by their real filenames
// (src/utils/guideHref.js), because there is no server to rewrite clean URLs.
// So when this page was itself reached as a .html file, point the links to its
// sibling documents at their .html files too. On the web the clean links stay.
const NATIVE_DOC_LINKS = `<script>
if (/\\.html$/.test(location.pathname)) {
  document.querySelectorAll('a[href^="/cbat-tests"], a[href^="/cbat-guide"]').forEach(function (a) {
    var parts = a.getAttribute('href').split('#');
    if (!/\\.html$/.test(parts[0])) a.setAttribute('href', parts[0] + '.html' + (parts[1] ? '#' + parts[1] : ''));
  });
}
</script>`

function footer() {
  return `<footer><div class="wrap">
<p>${SIMULATION_NOTE} SkyWatch is independent and is not connected to any armed force or recruiting body.</p>
<p><a href="/">SkyWatch</a> · <a href="${INDEX_PATH}">All CBAT tests</a> · <a href="/cbat-guide">The complete CBAT guide</a> · <a href="/privacy">Privacy</a></p>
</div></footer>
${NATIVE_DOC_LINKS}`
}

const fmtRuns = n => `${(Math.floor(n / 100) * 100).toLocaleString('en-GB')}+`

function statsHTML(stats) {
  if (!stats) return ''
  const tiles = []
  if (Number.isFinite(stats.runs) && stats.runs >= MIN_RUNS_SHOWN) {
    tiles.push(`<div class="tile"><div class="n acc">${fmtRuns(stats.runs)}</div><div class="l">practice runs played<br>on SkyWatch</div></div>`)
  }
  if (Number.isFinite(stats.improvedPct) && stats.cohort >= MIN_COHORT_SHOWN) {
    tiles.push(`<div class="tile"><div class="n">${Math.round(stats.improvedPct)}%</div><div class="l">of players who practised 10+ times<br>improved on their first runs</div></div>`)
  }
  return tiles.length ? `<div class="stats">${tiles.join('')}</div>` : ''
}

/** Everything the renderers need, parsed once from the guide. */
export function prepareGuide(guideHtml) {
  return {
    ...loadGuideData(guideHtml),
    style: loadGuideStyle(guideHtml),
    analytics: loadGuideAnalytics(guideHtml),
  }
}

export function renderTestPage({ guide, registry, entry, stats }) {
  const t = guide.TESTS.find(x => x.id === entry.guideId)
  if (!t) throw new Error(`cbatTestPages.json: no guide test "${entry.guideId}"`)
  const practise = PRACTISE[entry.guideId]
  if (!practise) throw new Error(`copy.js: no practise copy for "${entry.guideId}"`)

  const path = pagePath(entry.slug)
  const label = t.abbr ? `${t.name} (${t.abbr})` : t.name
  const groupLabel = registry.groups.find(g => g.id === entry.group)?.label

  // The guide's sim square, booted directly: there is one per page at most,
  // so the guide's load-on-approach machinery for ten frames is not needed.
  const sim = guide.SIMS[entry.guideId]
  const simBlock = sim
    ? guide.simHTML(sim, entry.playPath).replace('data-src=', 'src=')
    : ''

  const related = registry.tests
    .filter(x => x.group === entry.group && x.guideId !== entry.guideId)
    .map(x => {
      const rt = guide.TESTS.find(g => g.id === x.guideId)
      return `<li><a href="${pagePath(x.slug)}">${guide.esc(rt.abbr ? `${rt.name} (${rt.abbr})` : rt.name)}</a><span>${guide.esc(rt.aka.replace(/[“”]/g, ''))}</span></li>`
    }).join('')

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: entry.title,
        description: entry.description,
        mainEntityOfPage: `${SITE_URL}${path}`,
        author: { '@type': 'Organization', name: SITE_NAME, url: `${SITE_URL}/` },
        publisher: { '@type': 'Organization', name: SITE_NAME, url: `${SITE_URL}/` },
        about: label,
      },
      breadcrumbLd([['SkyWatch', '/'], ['CBAT tests', INDEX_PATH], [entry.short, path]]),
    ],
  }

  return `${head({ title: entry.title, description: entry.description, path, jsonLd, style: guide.style, analytics: guide.analytics })}
<body>
<header class="masthead">
  <div class="wrap">
    <div class="kicker crumbs"><a href="/">SkyWatch</a> › <a href="${INDEX_PATH}">CBAT tests</a> › ${guide.esc(entry.short)}</div>
    <h1>${guide.esc(t.name)}${t.abbr ? ` <span>${guide.esc(t.abbr)}</span>` : ''}</h1>
    <p class="sub">${guide.esc(t.verdict)}</p>
  </div>
</header>

<div class="page">
<main id="main">
  <section>
    <h2>What the test is</h2>
    <div class="briefrow${sim ? '' : ' nosim'}">
      <div class="briefcol">
        <div class="brief"><span class="bh">The format</span>${t.brief}
          <span class="bsrc">Format description from the published CBAT TMI test guides
          (rafcbat.wordpress.com) and the Air Defence Academy test guides
          (airdefenceacademy.com/testguides).</span></div>
      </div>
      ${simBlock}
    </div>
    ${groupLabel ? `<p class="fine" style="margin-top:14px">Skill area: ${guide.esc(groupLabel)}.</p>` : ''}
  </section>

  <section>
    <h2>What candidates say</h2>
    <p class="lead">These points come from people who have sat the test, gathered from forums, community
    chats and candidates who wrote to us afterwards. Nothing here is quoted or attributed. Each point is
    graded by how many separate accounts back it up.</p>
    <div class="pills">${guide.chip('green')}${guide.chip('amber')}${guide.chip('red')}${guide.chip('grey')}</div>
    ${guide.factsHTML(t.facts)}
  </section>

  <section>
    <h2>Practise it on SkyWatch</h2>
    ${practise.map(p => `<p class="lead">${guide.esc(p)}</p>`).join('\n    ')}
    ${statsHTML(stats)}
    <a class="cta" href="${entry.playPath}">Practise ${guide.esc(entry.short)} free</a>
    <p class="fine">${guide.esc(SIMULATION_NOTE)}</p>
  </section>

  ${related ? `<section>
    <h2>Related tests</h2>
    <ul class="rel">${related}</ul>
  </section>` : ''}

  <section>
    <h2>Read more</h2>
    <p class="lead">This page is one part of <a href="/cbat-guide#test-${entry.guideId}">the complete CBAT guide</a>,
    which also covers how the day runs, the pass marks and the domain minimums. Or see
    <a href="${INDEX_PATH}">every CBAT test</a> on one page.</p>
  </section>
</main>
</div>
${footer()}
</body>
</html>
`
}

export function renderIndexPage({ guide, registry }) {
  const groups = registry.groups.map(g => {
    const items = registry.tests.filter(x => x.group === g.id).map(x => {
      const t = guide.TESTS.find(y => y.id === x.guideId)
      const first = stripTags(t.brief).split(/(?<=\.)\s/)[0]
      return `<li><a href="${pagePath(x.slug)}">${guide.esc(t.abbr ? `${t.name} (${t.abbr})` : t.name)}</a><span>${guide.esc(first)}</span></li>`
    }).join('')
    return `<p class="grp-h">${guide.esc(g.label)}</p><ul class="rel">${items}</ul>`
  }).join('\n')

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: INDEX_TITLE,
        description: INDEX_DESCRIPTION,
        url: `${SITE_URL}${INDEX_PATH}`,
        hasPart: registry.tests.map(x => ({ '@type': 'Article', headline: x.title, url: `${SITE_URL}${pagePath(x.slug)}` })),
      },
      breadcrumbLd([['SkyWatch', '/'], ['CBAT tests', INDEX_PATH]]),
    ],
  }

  return `${head({ title: INDEX_TITLE, description: INDEX_DESCRIPTION, path: INDEX_PATH, jsonLd, style: guide.style, analytics: guide.analytics })}
<body>
<header class="masthead">
  <div class="wrap">
    <div class="kicker crumbs"><a href="/">SkyWatch</a> › CBAT tests</div>
    <h1>Every <span>CBAT</span> test, explained</h1>
    <p class="sub">The CBAT is made up of ${registry.tests.length} short, unfamiliar tests. Each page below
    explains one of them in plain words: what it looks like, what people who sat it say catches them out,
    and how to practise it.</p>
  </div>
</header>

<div class="page">
<main id="main">
  <p class="lead">Which tests you sit depends on your role and your service. Your recruitment paperwork
  lists the ones that count for you. For how the whole day runs, read
  <a href="/cbat-guide">the complete CBAT guide</a>.</p>
  ${groups}
</main>
</div>
${footer()}
</body>
</html>
`
}

/** Every page, keyed by URL path. */
export function renderAll({ guideHtml, registry, stats = null }) {
  const guide = prepareGuide(guideHtml)
  const pages = new Map([[INDEX_PATH, renderIndexPage({ guide, registry })]])
  for (const entry of registry.tests) {
    pages.set(pagePath(entry.slug), renderTestPage({ guide, registry, entry, stats: stats?.[entry.guideId] ?? null }))
  }
  return pages
}

/** Visible words in a page's <main>, for the build's thin-page floor. */
export function mainWordCount(html) {
  const m = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)
  return m ? stripTags(m[1]).split(/\s+/).filter(Boolean).length : 0
}
