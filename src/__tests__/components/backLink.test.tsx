import { act, fireEvent, render, screen } from '@testing-library/react'

import { BackLink } from '@/components/primitives/BackLink'
import { recordVisit } from '@/lib/navstack'

const mockBack = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ back: mockBack }) }))

test('upgrades a cold parent link when the shell records history after the detail mounts', () => {
  window.sessionStorage.clear()
  render(<BackLink href="/games?date=2026-10-20" label="Daily slate" />)
  expect(screen.getByRole('link', { name: 'Daily slate' })).toHaveAttribute('href', '/games?date=2026-10-20')
  act(() => recordVisit('/games'))
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  act(() => recordVisit('/games/401909088'))
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(mockBack).toHaveBeenCalledTimes(1)
  act(() => recordVisit('/games'))
  expect(screen.getByRole('link', { name: 'Daily slate' })).toBeInTheDocument()
})
