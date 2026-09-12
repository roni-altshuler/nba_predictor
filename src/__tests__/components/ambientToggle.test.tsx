import { fireEvent, render, screen } from '@testing-library/react'

import { AmbientToggle, parseAmbient } from '@/components/shell/AmbientToggle'

/**
 * The dial has three places its value must agree: the `data-ambient`
 * attribute the CSS keys off, the storage key the pre-paint script reads on
 * the next visit, and the `ambientchange` event the canvas listens for. A
 * toggle that updated two of the three would look right and quietly leave
 * the court running behind a hidden canvas.
 */
describe('AmbientToggle', () => {
  beforeEach(() => {
    document.documentElement.dataset.ambient = 'soft'
    localStorage.clear()
  })

  it('reads the attribute the pre-paint script set', () => {
    document.documentElement.dataset.ambient = 'vivid'
    render(<AmbientToggle />)
    expect(screen.getByRole('button', { name: 'vivid' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'soft' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'off' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('writes the attribute, the storage key and the event together', () => {
    const heard = jest.fn()
    const listener = (event: Event) => heard((event as CustomEvent).detail)
    window.addEventListener('ambientchange', listener)
    render(<AmbientToggle />)

    fireEvent.click(screen.getByRole('button', { name: 'off' }))
    expect(document.documentElement.dataset.ambient).toBe('off')
    expect(localStorage.getItem('hardwood-ambient')).toBe('off')
    expect(heard).toHaveBeenCalledWith('off')
    expect(screen.getByRole('button', { name: 'off' })).toHaveAttribute('aria-pressed', 'true')

    window.removeEventListener('ambientchange', listener)
  })

  it('treats anything unknown as soft, the calm default', () => {
    expect(parseAmbient('loud')).toBe('soft')
    expect(parseAmbient(undefined)).toBe('soft')
    expect(parseAmbient('off')).toBe('off')
    document.documentElement.dataset.ambient = 'loud'
    render(<AmbientToggle />)
    expect(screen.getByRole('button', { name: 'soft' })).toHaveAttribute('aria-pressed', 'true')
  })
})
