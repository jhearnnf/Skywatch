// The words that stand in for an attachment-only message wherever a line of
// text is wanted (a reply quote, the "Replying to" strip). Mirrors
// attachmentLabel() in backend/utils/chatAttachments.js.
export function attachmentLabel(list) {
  const items = list ?? []
  if (!items.length) return ''
  const videos = items.filter(a => a.kind === 'video').length
  const photos = items.length - videos
  const parts = []
  if (photos) parts.push(photos === 1 ? 'Photo' : `${photos} photos`)
  if (videos) parts.push(videos === 1 ? 'Video' : `${videos} videos`)
  return parts.join(' and ')
}
