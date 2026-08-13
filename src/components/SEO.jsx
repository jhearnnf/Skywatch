import { Helmet } from 'react-helmet-async'
import { useLocation } from 'react-router-dom'
import { formatTitle, SITE_NAME, SITE_URL, DEFAULT_DESCRIPTION } from '../utils/seoTitle'

const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`
const OG_IMAGE_ALT = 'SkyWatch — CBAT-style aptitude training'

export default function SEO({
  title,
  description = DEFAULT_DESCRIPTION,
  ogImage = DEFAULT_OG_IMAGE,
  ogType = 'website',
  noIndex = false,
  // Pages reachable on more than one path (or with tracking/query params) point
  // at the one URL we want ranked instead of self-canonicalising the variant.
  canonical,
  // Per-page structured data, merged into the site-level graph in index.html.
  jsonLd,
}) {
  const { pathname } = useLocation()
  const fullTitle = formatTitle(title)
  const canonicalUrl = canonical || `${SITE_URL}${pathname}`

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />

      {/* Open Graph */}
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="en_GB" />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:type" content={ogType} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:alt" content={OG_IMAGE_ALT} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      <meta name="twitter:image:alt" content={OG_IMAGE_ALT} />

      {/* Let Google build a full rich result rather than the truncated default. */}
      {noIndex
        ? <meta name="robots" content="noindex, nofollow" />
        : <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />}

      {jsonLd && (
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      )}
    </Helmet>
  )
}
