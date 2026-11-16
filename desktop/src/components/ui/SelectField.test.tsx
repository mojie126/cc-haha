import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'

import { SelectField } from './SelectField'

const OPTIONS = [
  { value: 'stdio', label: 'stdio' },
  { value: 'http', label: 'HTTP' },
  { value: 'sse', label: 'SSE', disabled: true },
] as const

/** Open the card menu and return the trigger. */
function openMenu(label = 'Transport') {
  const trigger = screen.getByRole('combobox', { name: label })
  fireEvent.click(trigger)
  return trigger
}

describe('SelectField', () => {
  it('always has an accessible name', () => {
    // All 7 native selects in the app shipped without one.
    render(<SelectField label="Transport" options={OPTIONS} value="stdio" onChange={() => {}} />)
    expect(screen.getByRole('combobox', { name: 'Transport' })).toBeInTheDocument()
  })

  it('keeps the name when the visible label is hidden', () => {
    render(<SelectField label="Transport" labelHidden options={OPTIONS} value="stdio" onChange={() => {}} />)
    expect(screen.getByRole('combobox', { name: 'Transport' })).toBeInTheDocument()
    expect(screen.queryByText('Transport')).not.toBeInTheDocument()
  })

  it('shows the picked value on the trigger', () => {
    render(<SelectField label="Transport" options={OPTIONS} value="http" onChange={() => {}} />)
    expect(screen.getByRole('combobox', { name: 'Transport' })).toHaveTextContent('HTTP')
  })

  it('reports the picked value from the card menu', () => {
    const onChange = vi.fn()
    render(<SelectField label="Transport" options={OPTIONS} value="stdio" onChange={onChange} />)

    openMenu()
    fireEvent.click(screen.getByRole('option', { name: 'HTTP' }))
    expect(onChange).toHaveBeenCalledWith('http')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('renders every option and honors per-option disabling', () => {
    render(<SelectField label="Transport" options={OPTIONS} value="stdio" onChange={() => {}} />)
    openMenu()
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('option', { name: 'SSE' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('marks itself invalid and announces the error', () => {
    render(<SelectField label="Transport" options={OPTIONS} value="stdio" onChange={() => {}} error="Pick one" />)
    const trigger = screen.getByRole('combobox')

    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(trigger.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
  })

  it('carries a disabled style', () => {
    render(<SelectField label="Transport" options={OPTIONS} value="stdio" onChange={() => {}} disabled />)
    const trigger = screen.getByRole('combobox')
    expect(trigger).toBeDisabled()
    expect(trigger.className).toContain('disabled:opacity-60')
  })
})
