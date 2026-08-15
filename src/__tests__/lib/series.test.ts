import { seriesSlug } from '@/lib/history'

/**
 * Series ids in URLs.
 *
 * A series id is `2026:1v18` — season, colon, the two franchise ids. The
 * colon is the whole reason this function exists: Next prerendered
 * `/seasons/2026/series/2026:1v18` perfectly happily and then 404'd every
 * one of them at runtime, encoded or not, because a colon is reserved in a
 * URL path and the router will not match it. Nothing failed at build time,
 * which is what made it worth a test.
 */
describe('seriesSlug', () => {
  it('drops the season prefix, which the path already carries', () => {
    expect(seriesSlug('2026:1v18')).toBe('1v18')
    expect(seriesSlug('2004:11v2')).toBe('11v2')
  })

  it('never emits a character that is reserved in a path segment', () => {
    for (const id of ['2026:1v18', '2026:28v5', 'weird/id', 'a:b:c', 'x?y#z']) {
      expect(seriesSlug(id)).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('keeps distinct series distinct within a season', () => {
    const ids = ['2026:1v18', '2026:18v1', '2026:10v13', '2026:13v10']
    const slugs = ids.map(seriesSlug)
    expect(new Set(slugs).size).toBe(ids.length)
  })

  it('survives an id with no colon at all', () => {
    expect(seriesSlug('1v18')).toBe('1v18')
  })
})
