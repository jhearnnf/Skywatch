import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import CodeRecall from '../CbatAct/CodeRecall'

const tapDigits = (digits) => {
  for (const d of digits) fireEvent.click(screen.getByRole('button', { name: d }))
}

const confirmBtn = () => screen.getByRole('button', { name: /confirm/i })
const deleteBtn  = () => screen.getByRole('button', { name: /delete/i })

describe('CodeRecall', () => {
  it('offers 1–9 and no zero key', () => {
    render(<CodeRecall onSubmit={vi.fn()} />)
    for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      expect(screen.getByRole('button', { name: d })).toBeDefined()
    }
    expect(screen.queryByRole('button', { name: '0' })).toBeNull()
  })

  it('submits the entered code once the pad is full', () => {
    const onSubmit = vi.fn()
    render(<CodeRecall onSubmit={onSubmit} />)
    tapDigits('1234567')
    fireEvent.click(confirmBtn())
    expect(onSubmit).toHaveBeenCalledWith('1234567')
  })

  it('cannot confirm a short code', () => {
    const onSubmit = vi.fn()
    render(<CodeRecall onSubmit={onSubmit} />)
    tapDigits('123')
    expect(confirmBtn().disabled).toBe(true)
    fireEvent.click(confirmBtn())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('ignores digits past the code length', () => {
    const onSubmit = vi.fn()
    render(<CodeRecall onSubmit={onSubmit} />)
    tapDigits('123456789')
    fireEvent.click(confirmBtn())
    expect(onSubmit).toHaveBeenCalledWith('1234567')
  })

  it('deletes the last digit', () => {
    const onSubmit = vi.fn()
    render(<CodeRecall onSubmit={onSubmit} />)
    tapDigits('1234569')
    fireEvent.click(deleteBtn())
    tapDigits('7')
    fireEvent.click(confirmBtn())
    expect(onSubmit).toHaveBeenCalledWith('1234567')
  })

  it('submits only once, however many times confirm is tapped', () => {
    const onSubmit = vi.fn()
    render(<CodeRecall onSubmit={onSubmit} />)
    tapDigits('1234567')
    fireEvent.click(confirmBtn())
    fireEvent.click(confirmBtn())
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('accepts keyboard digits, backspace and enter', () => {
    const onSubmit = vi.fn()
    render(<CodeRecall onSubmit={onSubmit} />)
    for (const key of ['1', '2', '3', '4', '5', '6', '9']) {
      fireEvent.keyDown(window, { key })
    }
    fireEvent.keyDown(window, { key: 'Backspace' })
    fireEvent.keyDown(window, { key: '7' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('1234567')
  })

  it('ignores enter until the code is the right length', () => {
    const onSubmit = vi.fn()
    render(<CodeRecall onSubmit={onSubmit} />)
    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('honours a custom code length', () => {
    const onSubmit = vi.fn()
    render(<CodeRecall codeLength={3} onSubmit={onSubmit} />)
    tapDigits('123')
    fireEvent.click(confirmBtn())
    expect(onSubmit).toHaveBeenCalledWith('123')
  })
})
