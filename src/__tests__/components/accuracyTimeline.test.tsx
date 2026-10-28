import { fireEvent, render, screen } from '@testing-library/react'
import { AccuracyTimeline } from '@/components/accuracy/AccuracyTimeline'
import { buildTrackRecord } from '@/lib/trackRecord'
import { stamp } from '@/lib/format'

// Use the Node renderer: jsdom's browser entry requires Web Streams globals.
const { renderToStaticMarkup } = require('react-dom/server.node') as typeof import('react-dom/server')

const active = require('../../../backend/tests/fixtures/published_record/active-season.json')
const history = require('../../../backend/tests/fixtures/published_record/forecast_log.json')

test('server rendering preserves complete SVG tooltip text without title warnings', () => {
  const report = buildTrackRecord(active, history, 2027)
  const rows = report.settled.slice(0, 2).map((row, i) => ({ ...row, versionChanged: i === 1 }))
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(<AccuracyTimeline rows={rows} />)
    const titles = [...container.querySelectorAll('svg title')].map(title => title.textContent)
    expect(titles).toEqual([
      ...rows.map(row => `${stamp(row.actualStart)}: ${row.correctSoFar} of ${row.settledSoFar} correct; recent ${row.recentCorrect} of ${row.recentSettled}.`),
      `Saved call version changed: ${rows[1].version}`,
    ])
    expect(errors).not.toHaveBeenCalled()
  } finally {
    errors.mockRestore()
  }
})

test('close latest values remain visible in separate named series outside the plot', () => {
  const report = buildTrackRecord(active, history, 2027)
  render(<AccuracyTimeline rows={report.settled} />)
  const cumulative = screen.getByTestId('cumulative-latest')
  const recent = screen.getByTestId('recent-latest')
  expect(cumulative).toHaveTextContent('Cumulative · all settled games · 58.1% latest')
  expect(recent).toHaveTextContent('Recent form · last 20 settled games · 70.0% latest')
  const plot = screen.getByRole('img', { name: /Cumulative 58.1% after 43 settled games. Recent form 70.0% on 20 games/ })
  expect(plot.contains(cumulative)).toBe(false)
  expect(plot.contains(recent)).toBe(false)
  fireEvent.change(screen.getByRole('slider'), { target: { value: '9' } })
  expect(cumulative).toHaveTextContent('58.1% latest')
  expect(recent).toHaveTextContent('70.0% latest')
  expect(screen.getByRole('status')).toHaveTextContent(/of 9 correct/)
})

test.each([0, 60, 100])('equal endpoints at %i percent retain both series and their true partial counts', accuracy => {
  const games = Array.from({ length: 5 }, (_, i) => ({
    ...active.games[0], game_id: `equal-${i}`, p_home: 0.7,
    date_utc: `2026-10-2${i}T19:00:00Z`, home_won: i < accuracy / 20,
    margin: i < accuracy / 20 ? 10 : -10, total: 210,
  }))
  const report = buildTrackRecord({ ...active, n: games.length, games }, { n: 0, forecasts: {} }, 2027)
  expect(report.settled).toHaveLength(5)
  expect(report.correct).toBe(accuracy / 20)
  render(<AccuracyTimeline rows={report.settled} />)
  expect(screen.getByTestId('cumulative-latest')).toHaveTextContent(`${accuracy.toFixed(1)}% latest`)
  expect(screen.getByTestId('recent-latest')).toHaveTextContent(`${accuracy.toFixed(1)}% latest`)
  expect(screen.getByTestId('recent-latest')).toHaveTextContent('last 5 settled games')
  expect(screen.getByRole('img', { name: new RegExp(`Cumulative ${accuracy.toFixed(1)}% after 5 settled games. Recent form ${accuracy.toFixed(1)}% on 5 games`) })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(`${accuracy / 20} of 5 correct`)
})
