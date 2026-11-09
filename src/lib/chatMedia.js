// Photos and videos in chat, on the client side: shrink, upload, report back.
//
// The file never touches our server. We ask it for a signed upload
// (POST /api/chat/conversations/:id/attachments/sign), send the bytes straight
// to Cloudinary with that signature, and hand the upload's signed receipt to
// the message send. The server checks the receipt; the client cannot choose
// where the file lands or how it is shrunk.
//
// Photos are re-drawn on a canvas before upload: longest side 1600px, WebP
// (JPEG where WebP is not supported). That keeps a phone photo to a few
// hundred KB for the free Cloudinary plan, and drawing it fresh drops the
// EXIF block, GPS included. Videos cannot be re-encoded here, so they go up
// as they are and Cloudinary shrinks them on the way in.

export const MAX_FILES = 4
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024
export const MAX_IMAGE_INPUT_BYTES = 40 * 1024 * 1024
const MAX_EDGE = 1600
const QUALITY = 0.8

export const kindOf = (file) => {
  const type = file?.type ?? ''
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  return null
}

// Why a file cannot be added, in words for the person adding it, or null.
export function rejectReason(file) {
  const kind = kindOf(file)
  if (!kind) return 'Only photos and videos can be sent.'
  if (kind === 'video' && file.size > MAX_VIDEO_BYTES) {
    return 'That video is too large. Videos can be up to 40MB, which is about 20 to 30 seconds from a phone camera.'
  }
  if (kind === 'image' && file.size > MAX_IMAGE_INPUT_BYTES) return 'That photo is too large.'
  return null
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ img, url })
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That photo could not be opened.')) }
    img.src = url
  })
}

const toBlob = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality))

/**
 * A smaller, metadata-free copy of a photo. Resolves to { blob, width, height }.
 * Falls back to the original file if the browser cannot draw it (an unusual
 * format), since the server's incoming transformation still caps the size.
 */
export async function compressImage(file) {
  let loaded
  try {
    loaded = await loadImage(file)
  } catch {
    return { blob: file, width: null, height: null }
  }
  const { img, url } = loaded
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const width = Math.max(1, Math.round(img.naturalWidth * scale))
    const height = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return { blob: file, width: img.naturalWidth || null, height: img.naturalHeight || null }
    ctx.drawImage(img, 0, 0, width, height)
    let blob = await toBlob(canvas, 'image/webp', QUALITY)
    // Safari draws WebP as PNG when asked for it, which would be bigger.
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', QUALITY)
    if (!blob) return { blob: file, width, height }
    // A small screenshot can come out bigger re-encoded; keep the smaller one.
    // (Not for camera photos: their originals carry EXIF, which must go.)
    if (blob.size >= file.size && file.type === 'image/png') return { blob: file, width, height }
    return { blob, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Ask the server for permission to upload one file. */
export async function signUpload({ API, apiFetch, conversationId, kind, bytes }) {
  const r = await apiFetch(`${API}/api/chat/conversations/${conversationId}/attachments/sign`, {
    quiet: true,
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, bytes }),
  })
  const d = await r.json().catch(() => null)
  if (!r.ok) throw new Error(d?.message || 'That file could not be uploaded.')
  return d.data
}

/**
 * POST the file to Cloudinary with the signed fields. XHR rather than fetch
 * for the progress events. Resolves to Cloudinary's upload response.
 * Returns { promise, abort }.
 */
export function uploadToCloudinary({ uploadUrl, fields, blob, onProgress }) {
  const xhr = new XMLHttpRequest()
  const promise = new Promise((resolve, reject) => {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v))
    form.append('file', blob)
    xhr.open('POST', uploadUrl)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body = null
      try { body = JSON.parse(xhr.responseText) } catch { /* below */ }
      if (xhr.status >= 200 && xhr.status < 300 && body?.public_id) resolve(body)
      else reject(new Error(body?.error?.message?.includes('too large')
        ? 'That file is too large to upload.'
        : 'That file could not be uploaded. Try again.'))
    }
    xhr.onerror = () => reject(new Error('That file could not be uploaded. Check your connection and try again.'))
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { aborted: true }))
    xhr.send(form)
  })
  return { promise, abort: () => xhr.abort() }
}

// What a send carries for one uploaded file: the signed receipt plus display
// hints. The server re-checks every part that matters.
export const receiptFrom = (res, fallback = {}) => ({
  publicId:  res.public_id,
  version:   res.version,
  signature: res.signature,
  width:     res.width ?? fallback.width ?? null,
  height:    res.height ?? fallback.height ?? null,
  bytes:     res.bytes ?? null,
  duration:  res.duration ?? null,
})

// Whether this device has a camera to hand off to. Desktop browsers ignore
// `capture` and open a file picker, so offering "Take photo" there would just
// be a second way to browse files.
export const canCapture = () => {
  try { return window.matchMedia?.('(pointer: coarse)')?.matches === true } catch { return false }
}
