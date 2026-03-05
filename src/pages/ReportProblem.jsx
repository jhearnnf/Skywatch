import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function ReportProblem({ fromPage, navigate }) {
  const { user, API } = useAuth()
  const isLoggedIn = !!user

  const [description, setDescription] = useState('')
  const [submitted,   setSubmitted]   = useState(false)
  const [error,       setError]       = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!description.trim()) { setError('Please describe the problem.'); return }

    try {
      const res = await fetch(`${API}/api/users/report-problem`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ description, pageReported: fromPage || 'unknown' }),
      })
      if (!res.ok) throw new Error()
      setSubmitted(true)
    } catch {
      setError('Failed to submit. Please try again.')
    }
  }

  if (!isLoggedIn) {
    return (
      <main className="page static-page">
        <div className="section-inner static-inner">
          <span className="static-eyebrow">Report a Problem</span>
          <h1 className="static-title">Login Required</h1>
          <p className="static-body">You must be logged in to submit a problem report.</p>
          <button className="btn-primary" onClick={() => navigate('login')}>Sign In</button>
        </div>
      </main>
    )
  }

  if (submitted) {
    return (
      <main className="page static-page">
        <div className="section-inner static-inner">
          <span className="static-eyebrow">Report a Problem</span>
          <h1 className="static-title">Report Submitted</h1>
          <p className="static-body">Thank you. Our team will review your report shortly.</p>
          <button className="btn-ghost" onClick={() => navigate(fromPage || 'dashboard')}>← Go Back</button>
        </div>
      </main>
    )
  }

  return (
    <main className="page static-page">
      <div className="section-inner static-inner">
        <span className="static-eyebrow">Support</span>
        <h1 className="static-title">Report a Problem</h1>
        {fromPage && (
          <p className="report-context">Reported from: <code>{fromPage}</code></p>
        )}

        <form className="report-form" onSubmit={handleSubmit} noValidate>
          <label className="form-label" htmlFor="description">
            Describe the problem
          </label>
          <textarea
            id="description"
            className="form-textarea"
            rows={5}
            placeholder="What happened? What were you doing when the problem occurred?"
            value={description}
            onChange={e => { setDescription(e.target.value); setError('') }}
          />
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn-primary">Submit Report</button>
        </form>
      </div>
    </main>
  )
}
