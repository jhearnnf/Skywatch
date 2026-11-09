import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  MAX_FILES, kindOf, rejectReason, compressImage, signUpload, uploadToCloudinary, receiptFrom,
} from '../../../lib/chatMedia'

let seq = 0

// The files waiting under the message box. Each one starts uploading the
// moment it is added, so by the time the message is typed it is usually done;
// Send waits for any still going.
export function useAttachmentTray(conversationId) {
  // Null outside a provider (the composer's own tests); only used once a file is added.
  const { API, apiFetch } = useAuth() ?? {}
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const aborts = useRef(new Map())

  const patch = (id, change) => setItems(prev => prev.map(i => (i.id === id ? { ...i, ...change } : i)))

  const start = useCallback(async (item) => {
    try {
      let blob = item.file
      let dims = {}
      if (item.kind === 'image') {
        const c = await compressImage(item.file)
        blob = c.blob
        dims = { width: c.width, height: c.height }
      }
      const signed = await signUpload({ API, apiFetch, conversationId, kind: item.kind, bytes: blob.size })
      const up = uploadToCloudinary({
        uploadUrl: signed.uploadUrl,
        fields:    signed.fields,
        blob,
        onProgress: (p) => patch(item.id, { progress: p }),
      })
      aborts.current.set(item.id, up.abort)
      const res = await up.promise
      aborts.current.delete(item.id)
      patch(item.id, { status: 'done', progress: 1, receipt: receiptFrom(res, dims) })
    } catch (e) {
      aborts.current.delete(item.id)
      if (e?.aborted) return
      patch(item.id, { status: 'error', error: e?.message || 'That file could not be uploaded.' })
    }
  }, [API, apiFetch, conversationId])

  // The live list, for `add` to count against. Read from a ref rather than
  // inside a state updater: updaters can run twice (StrictMode), and this one
  // would then start every upload twice.
  const itemsRef = useRef(items)
  itemsRef.current = items

  const add = useCallback((fileList) => {
    const files = Array.from(fileList ?? [])
    if (!files.length) return
    const room = MAX_FILES - itemsRef.current.length
    let message = ''
    const next = []
    for (const file of files.slice(0, Math.max(0, room))) {
      const reason = rejectReason(file)
      if (reason) { message = reason; continue }
      next.push({
        id: `att-${++seq}`,
        file,
        kind: kindOf(file),
        previewUrl: URL.createObjectURL(file),
        status: 'uploading',
        progress: 0,
        receipt: null,
        error: '',
      })
    }
    if (files.length > room) message = `You can send up to ${MAX_FILES} photos or videos at a time.`
    setError(message)
    if (!next.length) return
    itemsRef.current = [...itemsRef.current, ...next]
    setItems(prev => [...prev, ...next])
    next.forEach(start)
  }, [start])

  const remove = useCallback((id) => {
    aborts.current.get(id)?.()
    aborts.current.delete(id)
    setItems(prev => {
      const gone = prev.find(i => i.id === id)
      if (gone) URL.revokeObjectURL(gone.previewUrl)
      return prev.filter(i => i.id !== id)
    })
  }, [])

  const retry = useCallback((id) => {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, status: 'uploading', progress: 0, error: '' } : i)))
    const item = items.find(i => i.id === id)
    if (item) start({ ...item, status: 'uploading' })
  }, [items, start])

  // Handed to the send; the tray empties but the preview URLs stay alive a
  // while longer, because the message on screen is drawn from them until the
  // server's copy (with real links) arrives.
  const take = useCallback(() => {
    const done = items.filter(i => i.status === 'done')
    setItems([])
    setError('')
    setTimeout(() => done.forEach(i => URL.revokeObjectURL(i.previewUrl)), 120_000)
    return done
  }, [items])

  useEffect(() => () => { for (const abort of aborts.current.values()) abort() }, [])

  return {
    items,
    error,
    add,
    remove,
    retry,
    take,
    busy: items.some(i => i.status === 'uploading'),
    hasFailed: items.some(i => i.status === 'error'),
    ready: items.filter(i => i.status === 'done').length,
  }
}
