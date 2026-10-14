import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AppShell } from '@/components/shell/AppShell'

let mockPathname = '/'
let mockReducedMotion = false
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }))
jest.mock('framer-motion', () => ({ ...jest.requireActual('framer-motion'),
  useReducedMotion: () => mockReducedMotion }))
jest.mock('next/link', () => ({ __esModule: true,
  default: function TestLink({ onClick, ...props }: React.ComponentProps<'a'>) {
    return <a {...props} onClick={event => { event.preventDefault(); onClick?.(event) }} />
  },
}))

beforeEach(() => { mockPathname = '/'; window.sessionStorage.clear() })

function chrome(title = 'Today') {
  return <AppShell><h1 tabIndex={-1}>{title}</h1><button>Page action</button></AppShell>
}

describe.each([false, true])('More sheet with reduced motion %s', reduced => {
  beforeEach(() => { mockReducedMotion = reduced })

  test.each(['Escape', 'backdrop'])('%s dismissal restores the actual trigger and supports reopening', async reason => {
    render(chrome())
    const more = screen.getByRole('button', { name: 'More' })
    more.focus(); fireEvent.click(more)
    const dialog = screen.getByRole('dialog', { name: 'More pages' })
    expect(dialog).toHaveFocus()
    const link = within(dialog).getByRole('link', { name: 'Games' })
    link.focus()
    if (reason === 'Escape') fireEvent.keyDown(document, { key: 'Escape' })
    else {
      const backdrop = screen.getByRole('button', { name: 'Close menu' })
      backdrop.focus(); fireEvent.click(backdrop)
    }
    expect(more).toHaveFocus()
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More pages' })).toBeNull())
    fireEvent.click(more)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'More pages' })).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(more).toHaveFocus()
  })

  test('a shell rerender preserves the focused menu link', () => {
    const view = render(chrome())
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const link = within(screen.getByRole('dialog', { name: 'More pages' }))
      .getByRole('link', { name: 'Games' })
    link.focus()
    view.rerender(chrome('Updated page'))
    expect(link).toHaveFocus()
  })

  test('navigation closure and exit cleanup preserve destination focus', async () => {
    const view = render(chrome())
    const more = screen.getByRole('button', { name: 'More' })
    fireEvent.click(more)
    const link = within(screen.getByRole('dialog', { name: 'More pages' }))
      .getByRole('link', { name: 'Games' })
    link.focus(); fireEvent.click(link)
    expect(more).not.toHaveFocus()
    mockPathname = '/games'
    view.rerender(chrome('Games destination'))
    const destination = screen.getByRole('heading', { name: 'Games destination' })
    destination.focus()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More pages' })).toBeNull())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(destination).toHaveFocus()
    expect(more).toHaveAttribute('aria-expanded', 'false')
  })

  test('a route change while open closes without reclaiming destination focus', async () => {
    const view = render(chrome())
    const more = screen.getByRole('button', { name: 'More' })
    fireEvent.click(more)
    mockPathname = '/ratings'
    view.rerender(chrome('Ratings destination'))
    const destination = screen.getByRole('heading', { name: 'Ratings destination' })
    destination.focus()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More pages' })).toBeNull())
    expect(destination).toHaveFocus()
    expect(more).not.toHaveFocus()
  })

  test('unmounting an open sheet removes its Escape listener', () => {
    const view = render(chrome())
    const more = screen.getByRole('button', { name: 'More' })
    fireEvent.click(more)
    const focus = jest.spyOn(more, 'focus')
    view.unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(focus).not.toHaveBeenCalled()
  })
})
