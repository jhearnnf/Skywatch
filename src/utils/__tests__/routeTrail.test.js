import { describe, it, expect, beforeEach } from 'vitest'
import { recordPath, getRouteTrail, __resetRouteTrail, TRAIL_LENGTH } from '../routeTrail'

describe('routeTrail', () => {
  beforeEach(() => { __resetRouteTrail() })

  it('records visits oldest first', () => {
    recordPath('/cbat')
    recordPath('/cbat/sma')
    recordPath('/report')
    expect(getRouteTrail()).toEqual(['/cbat', '/cbat/sma', '/report'])
  })

  it('keeps only the last TRAIL_LENGTH pages', () => {
    for (let i = 0; i < TRAIL_LENGTH + 3; i++) recordPath(`/page${i}`)
    const trail = getRouteTrail()
    expect(trail).toHaveLength(TRAIL_LENGTH)
    expect(trail[trail.length - 1]).toBe(`/page${TRAIL_LENGTH + 2}`)
  })

  // A re-render, or a change to the query string alone, is not a new page —
  // letting those in would fill the trail with one entry repeated.
  it('ignores consecutive duplicates', () => {
    recordPath('/cbat')
    recordPath('/cbat')
    recordPath('/cbat?tab=weekly')
    expect(getRouteTrail()).toEqual(['/cbat'])
  })

  it('records the same page again once something else came between', () => {
    recordPath('/cbat')
    recordPath('/cbat/sma')
    recordPath('/cbat')
    expect(getRouteTrail()).toEqual(['/cbat', '/cbat/sma', '/cbat'])
  })

  it('drops the query string and hash', () => {
    recordPath('/brief/abc?from=search#section-2')
    expect(getRouteTrail()).toEqual(['/brief/abc'])
  })

  it('ignores anything that is not a path', () => {
    recordPath('https://example.com/')
    recordPath('')
    recordPath(null)
    recordPath(undefined)
    recordPath(42)
    expect(getRouteTrail()).toEqual([])
  })

  it('hands back a copy, so a caller cannot alter the stored trail', () => {
    recordPath('/cbat')
    getRouteTrail().push('/nonsense')
    expect(getRouteTrail()).toEqual(['/cbat'])
  })
})
