import { buildImageZones, PLACEHOLDER_IMG, ZOOM_POSITIONS } from '../briefImageZones'

const makeMedia = (n) =>
  Array.from({ length: n }, (_, i) => ({
    cloudinaryPublicId: `id${i}`,
    mediaUrl: `url${i}`,
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
    })
  })

  it('1 image, 4 sections → section 0 uses image at center; 1-3 reuse with zoom', () => {
    const zones = buildImageZones(makeMedia(1), 4)
    expect(zones[0]).toEqual({ src: 'url0', position: 'center center' })
    expect(zones[1]).toEqual({ src: 'url0', position: ZOOM_POSITIONS[1] })
    expect(zones[2]).toEqual({ src: 'url0', position: ZOOM_POSITIONS[2] })
    expect(zones[3]).toEqual({ src: 'url0', position: ZOOM_POSITIONS[3] })
  })

  it('2 images, 4 sections → sections 0-1 own images; 2-3 reuse last with zoom', () => {
    const zones = buildImageZones(makeMedia(2), 4)
    expect(zones[0]).toEqual({ src: 'url0', position: 'center center' })
    expect(zones[1]).toEqual({ src: 'url1', position: 'center center' })
    expect(zones[2]).toEqual({ src: 'url1', position: ZOOM_POSITIONS[2] })
    expect(zones[3]).toEqual({ src: 'url1', position: ZOOM_POSITIONS[3] })
  })

  it('zoom positions wrap via modulo for > 4 sections', () => {
    const zones = buildImageZones([], 5)
    expect(zones[4].position).toBe(ZOOM_POSITIONS[4 % ZOOM_POSITIONS.length])
  })

  it('filters out media entries without cloudinaryPublicId', () => {
    const media = [
      { cloudinaryPublicId: null, mediaUrl: 'bad' },
      { cloudinaryPublicId: 'id1', mediaUrl: 'url1' },
    ]
    const zones = buildImageZones(media, 2)
    expect(zones[0]).toEqual({ src: 'url1', position: 'center center' })
  })
})
