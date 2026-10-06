import { fireEvent, render, screen } from '@testing-library/react'

import AppError from '@/app/(app)/error'
import GameLoading from '@/app/(app)/games/[id]/loading'

const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }))

test('announces matchup loading without displaying a score', () => {
  render(<GameLoading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading matchup…')
  expect(screen.getByLabelText('Loading game')).toHaveAttribute('aria-busy', 'true')
  expect(document.querySelector('[data-score]')).toBeNull()
})

test('offers retry and a daily slate after a page error', () => {
  const reset = jest.fn()
  render(<AppError error={new Error('Controlled test failure')} reset={reset} />)
  expect(screen.getByRole('heading', { name: "This page couldn't load" })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(mockRefresh).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('link', { name: 'Browse games' })).toHaveAttribute('href', '/games')
})
