import { AppShell } from '@/components/shell/AppShell'
import { getSeasonsIndex } from '@/lib/history'

/**
 * The season list is read HERE, in a server component, and handed to the
 * shell as data. `AppShell` is a client component because it needs the
 * current pathname, and a client component cannot touch the filesystem —
 * pushing the read up to the layout keeps the archive index out of the
 * client bundle and out of an API round-trip.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const seasons = (getSeasonsIndex()?.seasons ?? [])
    .map((s) => ({ season: s.season, label: s.label, champion: s.champion }))
    .sort((a, b) => b.season - a.season)

  return <AppShell seasons={seasons}>{children}</AppShell>
}
