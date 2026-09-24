import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import CbatAdminRegionSelect from '../CbatAdminRegionSelect'
import { cbatAdminRegion } from '../../utils/cbatAdminRegion'

afterEach(() => localStorage.clear())

describe('CbatAdminRegionSelect', () => {
  it('starts on the admin\'s own region, with the menu shut', () => {
    render(<CbatAdminRegionSelect />)
    expect(screen.getByTestId('cbat-admin-region').textContent).toMatch(/Mine/)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens its own menu and stores the region picked', () => {
    render(<CbatAdminRegionSelect />)
    fireEvent.click(screen.getByTestId('cbat-admin-region'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cbat-admin-region-CA'))
    expect(cbatAdminRegion()).toBe('CA')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByTestId('cbat-admin-region').textContent).toMatch(/Canada/)
  })

  it('goes back to the admin\'s own region on "Mine"', () => {
    localStorage.setItem('sw_cbat_admin_region', 'AU')
    render(<CbatAdminRegionSelect />)
    fireEvent.click(screen.getByTestId('cbat-admin-region'))
    fireEvent.click(screen.getByTestId('cbat-admin-region-mine'))
    expect(cbatAdminRegion()).toBe('')
  })

  it('closes on a click outside', () => {
    render(<CbatAdminRegionSelect />)
    fireEvent.click(screen.getByTestId('cbat-admin-region'))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
