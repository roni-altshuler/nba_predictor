import { fireEvent, render, screen } from '@testing-library/react'
import { TeamLogo } from '@/components/primitives/TeamLogo'

test('shows a readable abbreviation while the official mark loads and after an error', () => {
  render(<TeamLogo logo="https://example.invalid/bos.png" abbreviation="BOS" name="Boston Celtics" />)
  expect(screen.getByText('BOS')).toBeInTheDocument()
  fireEvent.error(screen.getByRole('img', { name: 'Boston Celtics' }))
  expect(screen.getByRole('img', { name: 'Boston Celtics' })).toHaveTextContent('BOS')
  expect(document.querySelector('img')).toBeNull()
})
