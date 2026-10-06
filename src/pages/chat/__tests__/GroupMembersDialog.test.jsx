import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import GroupMembersDialog from '../components/GroupMembersDialog'

const members = [{ _id: 'a', agentNumber: '1365251' }]

describe('GroupMembersDialog — survey button', () => {
  it('is absent unless the caller offers it (group date not reached yet)', () => {
    render(<GroupMembersDialog title="CBAT · 9 Oct 2026" members={members} onClose={() => {}} />)
    expect(screen.queryByTestId('group-members-email-survey')).toBeNull()
  })

  it('shows and fires when offered', () => {
    const onEmailSurvey = vi.fn()
    render(<GroupMembersDialog title="CBAT · 6 Oct 2026" members={members} onClose={() => {}} onEmailSurvey={onEmailSurvey} />)
    fireEvent.click(screen.getByRole('button', { name: 'Email CBAT passers survey' }))
    expect(onEmailSurvey).toHaveBeenCalled()
  })
})
