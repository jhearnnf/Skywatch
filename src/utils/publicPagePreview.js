let previewPending = false

export function preparePublicPagePreview() {
  if (!document.getElementById('public-page-preview') || document.documentElement.hasAttribute('data-skip-public-preview')) return
  // The intro is already visible. Replaying its entrance fade would briefly
  // hide it when React takes over. Skip only this initial mount's animations.
  previewPending = true
}

// Only entrance fades use this. Continuous decoration and gameplay animations
// keep their normal behaviour, including on the first page load.
export const publicPageInitial = initial => previewPending ? false : initial

export function finishPublicPagePreview() {
  document.getElementById('public-page-preview')?.remove()
  document.getElementById('public-page-preview-style')?.remove()
  document.documentElement.removeAttribute('data-skip-public-preview')
  if (previewPending) {
    // Allow initial mount effects/state updates to settle before subsequent
    // navigations use entrance animations again. No gameplay loop is added.
    requestAnimationFrame(() => { previewPending = false })
  }
}
