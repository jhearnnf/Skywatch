/**
 * A Media doc's `name` should be a human-readable title (Wikipedia page
 * title or search term). Older records sometimes hold a Cloudinary publicId
 * like "brief-images/brief-1775566..". This predicate tells display and
 * backfill layers whether a stored name reads as a real title.
 */
function isRealImageTitle(name) {
  if (!name) return false;
  const s = String(name).trim();
  if (!s) return false;
  if (s.includes('/')) return false;
  // Cloudinary publicId auto-prefixes: brief-123, brief_123, brief123 (any case)
  if (/^brief[-_]?\d/i.test(s)) return false;
  return true;
}

module.exports = { isRealImageTitle };
