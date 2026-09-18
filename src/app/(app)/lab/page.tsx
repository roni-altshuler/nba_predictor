import { Courtside } from '@/components/courtside/Courtside'
import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { getGameForecasts, getSeasonProjections, getPowerRatings } from '@/lib/artifacts'

export const metadata = { title: 'Forecast Lab', description: 'Explore NBA forecasts, follow your teams, and try game scenarios in Hardwood’s Forecast Lab.' }
export const dynamic = 'force-static'

export default function ForecastLabPage() {
  const projections = getSeasonProjections()
  return <>
    <header className="mb-8"><p className="eyebrow">Hardwood / Forecast Lab</p><h1 className="mt-2 text-3xl sm:text-4xl">The game, before the game.</h1><p className="mt-3 max-w-xl text-sm text-[var(--text-secondary)]">A closer look at the numbers behind every matchup, with room for your own what-ifs.</p></header>
    <Courtside initial={getGameForecasts()} projections={projections?.teams} directory={getPowerRatings()?.teams} />
    <EvidencePanel measured={projections?.measured} />
  </>
}
