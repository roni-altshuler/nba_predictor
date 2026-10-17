import { fireEvent, render, screen } from '@testing-library/react'
import { PublishedRecord } from '@/components/accuracy/PublishedRecord'
import { buildTrackRecord } from '@/lib/trackRecord'

const call = { generated_at: '2026-08-16T12:00:00Z', tipoff_utc: '2027-01-01T00:00:00Z', model_version: 'v1', season: 2027, home_team: 'DET', away_team: 'BOS', p_home: 0.7 }
const source = (games: unknown[]) => ({ season: 2027, basis: 'live', generated_at: '2027-06-01T00:00:00Z', n: games.length, games })
const rows = [true, false, true].map((won, i) => ({ ...call, game_id: String(i), date_utc: `2027-01-0${i + 1}T00:00:00Z`, home_won: won, margin: won ? 10 : -10, total: 210 }))

test('zero settled is Not yet scored, no zero-percent chart or fabricated point', () => {
  render(<PublishedRecord report={buildTrackRecord(source([]), { n: 1, forecasts: { upcoming: call } })} />)
  expect(screen.getByTestId('record-headline')).toHaveTextContent('Not yet scored')
  expect(screen.queryByRole('img', { name: /accuracy over calendar/ })).not.toBeInTheDocument()
  expect(screen.getByText(/timeline starts after the first/)).toBeInTheDocument()
  expect(screen.getByText(/1 awaiting a scored result/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'BOS at DET' })).toHaveAttribute('href', '/games/upcoming')
})

test('headline, date timeline, mobile/keyboard selector and full ledger share exact counts', () => {
  render(<PublishedRecord report={buildTrackRecord(source(rows), { forecasts: {} })} />)
  expect(screen.getByTestId('record-headline')).toHaveTextContent('66.7% correct')
  expect(screen.getByTestId('record-count')).toHaveTextContent('2 of 3 settled games')
  expect(screen.getByRole('img', { name: /Cumulative 66.7% after 3/ })).toBeInTheDocument()
  expect(screen.getAllByRole('row')).toHaveLength(4)
  const slider = screen.getByRole('slider', { name: /Inspect a settled game/ })
  fireEvent.change(slider, { target: { value: '2' } })
  expect(screen.getByRole('status')).toHaveTextContent('Cumulative 50.0% · 1 of 2 correct. Recent form 50.0% · 1 of 2')
  expect(screen.getByRole('link', { name: 'Inspect this pick in the history' })).toHaveAttribute('href', '#pick-1')
  expect(screen.getByText(/same sport, event scope, selection rule/)).toBeInTheDocument()
})

test('a genuine losing record may show zero percent, while missing evidence cannot', () => {
  const report = buildTrackRecord(source([rows[1]]), { forecasts: {} })
  const view = render(<PublishedRecord report={report} compact />)
  expect(screen.getByTestId('record-headline')).toHaveTextContent('0.0% correct')
  expect(screen.getByTestId('record-count')).toHaveTextContent('0 of 1 settled games')
  view.rerender(<PublishedRecord report={buildTrackRecord(null, null)} compact />)
  expect(screen.getByTestId('record-headline')).toHaveTextContent('Record unavailable')
  expect(screen.queryByTestId('record-count')).not.toBeInTheDocument()
})
