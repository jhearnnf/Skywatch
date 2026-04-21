import { buildImageZones, isRealImageTitle, PLACEHOLDER_IMG, ZOOM_POSITIONS } from '../briefImageZones'

const makeMedia = (n) =>
  Array.from({ length: n }, (_, i) => ({
    cloudinaryPublicId: `id${i}`,
    mediaUrl: `url${i}`,
    name: `name${i}`,
  }))

describe('buildImageZones', () => {
  it('returns one zone per section', () => {
    expect(buildImageZones([], 4)).toHaveLength(4)
    expect(buildImageZones(makeMedia(2), 3)).toHaveLength(3)
  })

  it('no media → all use placeholder with distinct zoom positions', () => {
    const zones = buildImageZones([], 4)
    zones.forEach(z => expect(z.src).toBe(PLACEHOLDER_IMG))
    expect(zones.map(z => z.position)).toEqual(ZOOM_POSITIONS)
  })

  it('null media → treated as no media', () => {
    const zones = buildImageZones(null, 2)
    zones.forEach(z => expect(z.src).toBe(PLACEHOLDER_IMG))
  })

  it('4 images, 4 sections → each section gets its own image at center', () => {
    const zones = buildImageZones(makeMedia(4), 4)
    zones.forEach((z, i) => {
      expect(z.src).toBe(`url${i}`)
      expect(z.position).toBe('center center')
      expect(z.alt).toBe(`name${i}`)
    })
  })

  it('1 image, 4 sections → section 0 uses image at center; 1-3 reuse with zoom', () => {
    const zones = buildImageZones(makeMedia(1), 4)
    expect(zones[0]).toEqual({ src: 'url0', position: 'center center', alt: 'name0', cutoutSrc: null })
    expect(zones[1]).toEqual({ src: 'url0', position: ZOOM_POSITIONS[1], alt: 'name0', cutoutSrc: null })
    expect(zones[2]).toEqual({ src: 'url0', position: ZOOM_POSITIONS[2], alt: 'name0', cutoutSrc: null })
    expect(zones[3]).toEqual({ src: 'url0', position: ZOOM_POSITIONS[3], alt: 'name0', cutoutSrc: null })
  })

  it('2 images, 4 sections → sections 0-1 own images; 2-3 reuse last with zoom', () => {
    const zones = buildImageZones(makeMedia(2), 4)
    expect(zones[0]).toEqual({ src: 'url0', position: 'center center', alt: 'name0', cutoutSrc: null })
    expect(zones[1]).toEqual({ src: 'url1', position: 'center center', alt: 'name1', cutoutSrc: null })
    expect(zones[2]).toEqual({ src: 'url1', position: ZOOM_POSITIONS[2], alt: 'name1', cutoutSrc: null })
    expect(zones[3]).toEqual({ src: 'url1', position: ZOOM_POSITIONS[3], alt: 'name1', cutoutSrc: null })
  })

  it('alt is null when image has no name (placeholder or unnamed media)', () => {
    const placeholderZones = buildImageZones([], 2)
    placeholderZones.forEach(z => expect(z.alt).toBeNull())

    const unnamed = [{ cloudinaryPublicId: 'id0', mediaUrl: 'url0' }]
    const zones = buildImageZones(unnamed, 2)
    expect(zones[0].alt).toBeNull()
    expect(zones[1].alt).toBeNull()
  })

  it('zoom positions wrap via modulo for > 4 sections', () => {
    const zones = buildImageZones([], 5)
    expect(zones[4].position).toBe(ZOOM_POSITIONS[4 % ZOOM_POSITIONS.length])
  })

  it('filters out media entries without cloudinaryPublicId', () => {
    const media = [
      { cloudinaryPublicId: null, mediaUrl: 'bad', name: 'bad' },
      { cloudinaryPublicId: 'id1', mediaUrl: 'url1', name: 'good' },
    ]
    const zones = buildImageZones(media, 2)
    expect(zones[0]).toEqual({ src: 'url1', position: 'center center', alt: 'good', cutoutSrc: null })
  })

  it('passes cutoutUrl through as cutoutSrc when present on the media doc', () => {
    const media = [{
      cloudinaryPublicId: 'id0',
      mediaUrl:           'url0',
      name:               'Typhoon',
      cutoutUrl:          'https://example.com/cutout.png',
    }]
    const zones = buildImageZones(media, 3)
    expect(zones[0].cutoutSrc).toBe('https://example.com/cutout.png')
    // Reused sections also carry the cutout since it belongs to the same media doc
    expect(zones[1].cutoutSrc).toBe('https://example.com/cutout.png')
    expect(zones[2].cutoutSrc).toBe('https://example.com/cutout.png')
  })
})

describe('isRealImageTitle', () => {
  it('accepts human-authored titles', () => {
    expect(isRealImageTitle('Eurofighter Typhoon')).toBe(true)
    expect(isRealImageTitle('F-35 Lightning II')).toBe(true)
    expect(isRealImageTitle('No. 14 Squadron RAF')).toBe(true)
    expect(isRealImageTitle('RAF Coningsby')).toBe(true)
  })

  it('rejects publicId-style paths and auto-generated names', () => {
    expect(isRealImageTitle('brief-images/brief-1775566123456')).toBe(false)
    expect(isRealImageTitle('brief-1775566123456')).toBe(false)
    expect(isRealImageTitle('brief1775566123456')).toBe(false)
    expect(isRealImageTitle('brief_1775566123456')).toBe(false)
    expect(isRealImageTitle('brief-1775566-news-bulk')).toBe(false)
    expect(isRealImageTitle('folder/filename.jpg')).toBe(false)
  })

  it('rejects empty / nullish values', () => {
    expect(isRealImageTitle(null)).toBe(false)
    expect(isRealImageTitle(undefined)).toBe(false)
    expect(isRealImageTitle('')).toBe(false)
    expect(isRealImageTitle('   ')).toBe(false)
  })
})
