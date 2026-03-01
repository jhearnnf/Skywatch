import { useState, useEffect } from 'react'

function DigitalClock() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const pad = (n) => String(n).padStart(2, '0')

  return (
    <div className="digital-clock" aria-label="Current time" role="timer">
      <span className="clock-segment">{pad(time.getHours())}</span>
      <span className="clock-colon">:</span>
      <span className="clock-segment">{pad(time.getMinutes())}</span>
      <span className="clock-colon">:</span>
      <span className="clock-segment clock-segment--seconds">{pad(time.getSeconds())}</span>
    </div>
  )
}

function CrosshairLarge() {
  return (
    <svg className="welcome-icon" width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="9"  stroke="currentColor" strokeWidth="2"/>
      <circle cx="32" cy="32" r="20" stroke="currentColor" strokeWidth="1" strokeDasharray="5 4" opacity="0.35"/>
      <circle cx="32" cy="32" r="4"  fill="currentColor"/>
      <path d="M32 2v12M32 50v12M2 32h12M50 32h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

export default function Welcome({ navigate }) {
  const handleBeginMission = () => {
    // Mark this day as visited so we don't show the welcome page again today
    localStorage.setItem('skywatch_last_visit', new Date().toDateString())
    navigate('dashboard')
  }

  return (
    <div className="welcome-page">
      <div className="welcome-content">

        <div className="welcome-brand">
          <CrosshairLarge />
          <h1 className="welcome-app-name">SKYWATCH</h1>
        </div>

        <div className="welcome-clock-wrap">
          <p className="welcome-clock-label">MISSION TIME</p>
          <DigitalClock />
        </div>

        <p className="welcome-message">
          Your intelligence briefing is ready. Stay current on RAF operations,
          aircraft, ranks, and doctrine. Test your recall. Earn your rank.
        </p>

        <button className="welcome-cta" onClick={handleBeginMission}>
          BEGIN MISSION
        </button>

        <p className="welcome-sub">Classified intel updated daily</p>
      </div>
    </div>
  )
}
