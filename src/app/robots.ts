import type { MetadataRoute } from 'next'

/**
 * Keep crawlers out of the on-demand game archive.
 *
 * `/games/[id]` covers ~29,653 archived box-score pages, rendered on demand
 * and cached until the next deploy. Crawlers walking that space — not
 * readers — are what generated Vercel ISR writes, and the pages are thin
 * box scores with no search value. The 60 prerendered upcoming games are a
 * worthwhile sacrifice; `/games` itself (the calendar) and everything else
 * stay crawlable.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/games/',
    },
  }
}
