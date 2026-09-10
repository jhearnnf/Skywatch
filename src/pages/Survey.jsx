import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { captureLoginReturn } from '../utils/loginRedirect'
import SEO from '../components/SEO'
import { SLIM_APP } from '../utils/appMode'
import { PLAY_STORE_URL } from '../utils/appUpdate'
import { ROLE_GROUPS, OTHER_ROLE_KEY, filterRoleGroups, roleLabel } from '../data/surveyRoles'

/**
 * The CBAT outcome questionnaire.
 *
 * Reached from an emailed link carrying an invite token, with no sign-in: the
 * token identifies the response. See backend/routes/survey.js for why that is
 * the right amount of identity here.
 *
 * Also reached at `/survey` with no token at all, by someone who is already
 * signed in. That case asks the server for this account's own invite (POST
 * /api/survey/self) and then runs the identical flow on the token it gets back,
 * so a run started from an email and finished from the bare link is one
 * response. Nothing below this point knows which way the reader arrived.
 *
 * DESIGNED AROUND FINISHING IT. Everything below is in service of the
 * completion rate, because an abandoned questionnaire tells us nothing and
 * never reaches the donation ask:
 *
 *  - ONE QUESTION PER SCREEN, and single-choice answers auto-advance. No "Next"
 *    to hunt for, no wall of fields to size up and close.
 *  - THE LENGTH IS STATED IMMEDIATELY, in the progress counter and on the
 *    opening screen. Knowing it is short is what stops the bounce; hiding the
 *    length reads as hiding something.
 *  - EVERY ANSWER SAVES AS IT IS GIVEN (PATCH per question). Someone who quits
 *    at question three has still told us what we most wanted to know. This also
 *    means the donation screen is not load-bearing for the data.
 *  - THE REWARD COMES BEFORE THE ASK. A confirmed pass lights up the PASSED
 *    badge on the closing screen — a real thing they have just earned on their
 *    profile — and only then does the donation appear.
 */

// The core path. `passedAny` and `booked` are branches off `passed` and `sat`
// and are deliberately excluded: padding the denominator for questions most
// people never see would make the progress bar lie about how much is left.
const CORE_STEPS = ['sat', 'role', 'passed', 'realism', 'helped', 'gaps']

const RATINGS = {
  realism: [
    { value: 1, label: 'Nothing like it' },
    { value: 2, label: 'A little similar' },
    { value: 3, label: 'Fairly close' },
    { value: 4, label: 'Very close' },
    { value: 5, label: 'Almost identical' },
  ],
  helped: [
    { value: 1, label: 'Not at all' },
    { value: 2, label: 'A little' },
    { value: 3, label: 'Somewhat' },
    { value: 4, label: 'A lot' },
    { value: 5, label: 'It made the difference' },
  ],
}

// The last question follows from the realism rating given two screens earlier.
//
// Someone who has just told us our practice was nothing like the real test and
// is then asked whether there was "anything" we missed has been asked a question
// that ignores the answer they just gave. That reads as not listening, and it is
// exactly the moment people stop typing. Worse, it wastes the one free-text box
// on the form: the low raters are the respondents with the most to say, and the
// generic prompt does not invite them to say it.
//
// So the wording tracks the rating. Low ratings are asked what was DIFFERENT
// (an invitation to describe a mismatch they have already asserted), high ones
// are asked what was MISSING.
const GAPS_VARIANTS = {
  low: {
    title: 'What was different?',
    hint: 'You said the real test was not much like our practice. Knowing exactly what did not match is the most useful thing on this form, and it is what we would fix first.',
    placeholder: 'The format, the timing, a test we do not have…',
  },
  mid: {
    title: 'What did not match?',
    hint: 'Fairly close still leaves a gap. What was different, or what caught you out?',
    placeholder: 'Anything that was not how you expected…',
  },
  high: {
    title: 'Was there anything we did not prepare you for?',
    hint: 'A test we do not have, a different format, instructions that caught you out. Optional, but it is the single most useful thing you can tell us.',
    placeholder: 'Anything at all…',
  },
}

// Rating is always set by the time this screen is reached (the realism question
// only advances on a choice), but the fallback keeps the neutral wording for
// anyone who arrives another way.
function gapsVariantFor(rating) {
  if (rating != null && rating <= 2) return GAPS_VARIANTS.low
  if (rating === 3) return GAPS_VARIANTS.mid
  return GAPS_VARIANTS.high
}

// Three, deliberately, where /donate offers four (3/5/10/20) plus a free-text
// box. The two asks are doing different jobs and should not be made to match.
//
// /donate is reached on purpose: the visitor has already decided to give and the
// only open question is how much, so a wider ladder and a custom box cost
// nothing and let a motivated donor go higher.
//
// This one is attached to the end of a favour the reader has just done us. It is
// unsolicited, and the risk here is not leaving money on the table but the ask
// reading as grabby and being dismissed. Every extra option is another decision
// at precisely the moment attention is thinnest, so the ladder stays short and
// the whole thing stays a single tap.
//
// It also stops at £10 because the copy just above it names £3. A £20 chip sat
// beside a sentence saying "a one-off £3" quietly contradicts it, and the top
// preset is read as the expected amount. Anyone who wants to give more has the
// link below, which is a better home for that than a text field on this card.
const DONATION_PRESETS = [3, 5, 10]

// Who gets asked for a score sheet.
//
// Only someone who has sat the test AND has the result: a pass or a fail both
// carry the numbers we want, and a failed sheet is arguably the more useful of
// the two because it is the only thing that shows where the line actually sits.
// Everyone else is skipped, because the ask would be for a document they cannot
// produce.
function wantsSheetAsk(answers = {}) {
  return answers.satTest === true
    && (answers.passedForRole === 'yes' || answers.passedForRole === 'no')
}

// The demo. `/survey/preview` walks the whole questionnaire with nothing behind
// it: no invite is looked up, no answer is saved, no donation session is opened
// and no account is touched. It exists so the flow can be checked (and shown to
// someone) without spending a real invitation — opening a live token to look
// around would mark it opened, and answering would write a real response.
//
// 'preview' can never collide with a real token: those are 64 hex characters.
const PREVIEW_TOKEN = 'preview'

// Mirrors the server's deferral rule (backend/routes/survey.js) so the demo
// shows the same promise a real respondent would get.
const DAY_MS = 24 * 60 * 60 * 1000
const BOOKED_GRACE_DAYS = 7
const DEFAULT_DEFER_DAYS = 60

// The score sheet step. Mirrors backend/constants/survey.js.
const MAX_SHEETS = 6

// Photos are downscaled in the browser before they are sent.
//
// Not an optimisation. A phone photo of a score sheet is 3 to 5MB, which
// base64-encodes to more than the 10MB body limit and is rejected before any
// server code runs, so the raw file is not a thing that can be uploaded at all.
// 1600px on the long edge takes the same photo to a few hundred KB with the
// printed figures still perfectly readable, and it uploads in a moment on the
// mobile data most of these will arrive over.
const SHEET_MAX_EDGE = 1600
const SHEET_QUALITY  = 0.82

export default function Survey() {
  const { token: routeToken } = useParams()
  const { API, user, loading: authLoading } = useAuth()
  const location = useLocation()

  // The token this run is answering under: the one in the URL, or the one the
  // server hands back for the signed-in account when there is none.
  const [selfToken,  setSelfToken]  = useState(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const token = routeToken ?? selfToken
  const isPreview = token === PREVIEW_TOKEN

  const [loading, setLoading]   = useState(true)
  const [fatal,   setFatal]     = useState('')
  const [meta,    setMeta]      = useState(null)
  const [answers, setAnswers]   = useState({})
  const [step,    setStep]      = useState('intro')
  const [history, setHistory]   = useState([])
  const [badge,   setBadge]     = useState(false)
  const [saving,  setSaving]    = useState(false)
  // Score sheets this person has sent. Server-owned in a real run, local-only
  // in the demo.
  const [sheets,  setSheets]    = useState([])
  // When we have promised not to contact them again, echoed back by the server
  // so the page states the same date the deferral actually enforces.
  const [deferredUntil, setDeferredUntil] = useState(null)

  // Resolve the bare `/survey` link into this account's invite.
  //
  // Waits for the auth check to finish first: on a cold load `user` is null for
  // a moment even for a signed-in visitor, and acting on that would show the
  // sign-in screen to someone who is already signed in.
  useEffect(() => {
    if (routeToken || authLoading) return
    if (!user) {
      // Same handshake the route guard uses, so signing in comes straight back
      // here instead of dropping them on /home with the questionnaire lost.
      captureLoginReturn(location)
      setNeedsLogin(true)
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res  = await fetch(`${API}/api/survey/self`, {
          method: 'POST',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) throw new Error(data.message || 'Could not open the questionnaire.')
        setSelfToken(data.data.token)
      } catch (err) {
        if (cancelled) return
        setFatal(err.message)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [API, routeToken, authLoading, user, location])

  // Load the invite. In preview there is nothing to load — the page is stood up
  // from a stub so it never reaches the API at all.
  useEffect(() => {
    if (!token) return
    if (isPreview) {
      setMeta({
        name: 'Agent 1234567',
        closed: false,
        optedOut: false,
        completed: false,
        // The demo shows the Play Store ask, which a real screen only gets when
        // the account has actually run the Android app.
        usedAndroid: true,
        roleGroups: ROLE_GROUPS,
        resultImages: [],
        response: null,
      })
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res  = await fetch(`${API}/api/survey/${token}`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) throw new Error(data.message || 'This questionnaire link is not valid.')
        setMeta(data.data)
        setSheets(data.data.resultImages ?? [])
        if (data.data.response) {
          setAnswers(data.data.response)
          if (data.data.response.passedForRole === 'yes' || data.data.response.passedAnyRole === 'yes') {
            setBadge(true)
          }
        }
        if (data.data.completed) setStep('done')
      } catch (err) {
        if (!cancelled) setFatal(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [API, token, isPreview])

  // Persist one or more answers. Fire-and-forget by design: a dropped save must
  // never block the person from moving to the next question, and the next save
  // carries the same field again anyway.
  const save = useCallback(async (patch, opts = {}) => {
    setAnswers(prev => ({ ...prev, ...patch }))

    // Preview writes nothing. Everything the server would have told us is
    // worked out locally instead, so the demo behaves like the real thing
    // (badge, deferral date) without a single request leaving the page.
    if (isPreview) {
      if (patch.passedForRole === 'yes' || patch.passedAnyRole === 'yes') setBadge(true)
      if (patch.satTest === false || 'testBookedFor' in patch || 'testBookedUnknown' in patch) {
        const booked = patch.testBookedFor ? new Date(patch.testBookedFor) : null
        setDeferredUntil(booked && !Number.isNaN(booked.getTime())
          ? new Date(booked.getTime() + BOOKED_GRACE_DAYS * DAY_MS).toISOString()
          : new Date(Date.now() + DEFAULT_DEFER_DAYS * DAY_MS).toISOString())
      }
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`${API}/api/survey/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, ...(opts.complete ? { complete: true } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.data?.badgeAwarded) setBadge(true)
      if (res.ok && data.data?.deferredUntil) setDeferredUntil(data.data.deferredUntil)
    } catch {
      /* answers are re-sent with the next question; nothing to surface here */
    } finally {
      setSaving(false)
    }
  }, [API, token, isPreview])

  const goTo = useCallback((next) => {
    setHistory(h => [...h, step])
    setStep(next)
  }, [step])

  const back = useCallback(() => {
    setHistory(h => {
      if (!h.length) return h
      setStep(h[h.length - 1])
      return h.slice(0, -1)
    })
  }, [])

  // Where each answer leads. Kept in one place so the branch logic is readable
  // rather than scattered through the handlers.
  const advanceFrom = useCallback((from, value) => {
    switch (from) {
      case 'sat':     return value === true ? 'role' : 'booked'
      case 'booked':  return 'notyet'
      case 'role':    return 'passed'
      case 'passed':  return value === 'no' ? 'passedAny' : 'realism'
      case 'passedAny': return 'realism'
      case 'realism': return 'helped'
      case 'helped':  return 'gaps'
      // The score sheet ask, shown only to someone who actually has one. A
      // "waiting" answer means the result has not come back yet, and asking
      // them for a document they do not have is a dead screen between the last
      // question and the thank-you.
      case 'gaps':    return wantsSheetAsk(answers) ? 'upload' : 'done'
      case 'upload':  return 'done'
      default:        return 'done'
    }
  }, [answers])

  const answerAndAdvance = useCallback((from, patch, value) => {
    const next = advanceFrom(from, value)
    // Completion is marked when the last QUESTION is answered, not when the
    // last screen is reached. The score sheet step sits after the six
    // questions and is optional, so gating `complete` on landing on 'done'
    // would make everyone who declined to upload look like an abandoned run.
    save(patch, { complete: next === 'done' || next === 'upload' })
    // A short beat so the chosen answer is visibly registered before the card
    // slides away. Without it the selection reads as a mis-tap.
    setTimeout(() => goTo(next), 220)
  }, [advanceFrom, save, goTo])

  const stepIndex = CORE_STEPS.indexOf(step)
  const progress  = stepIndex >= 0 ? (stepIndex + 1) / CORE_STEPS.length : null

  // No token in the URL and nobody signed in. There is nothing to look up, and
  // the emailed link is still the right way in for most people who land here,
  // so say both rather than redirecting to /login.
  if (needsLogin) {
    return (
      <div className="max-w-md mx-auto py-16 text-center" data-testid="survey-needs-login">
        <SEO title="Questionnaire" description="SkyWatch questionnaire." noIndex />
        <div className="text-5xl mb-4">✉️</div>
        <h1 className="text-xl font-extrabold text-slate-900 mb-2">Sign in to answer</h1>
        <p className="text-sm text-slate-500 mb-6">
          Sign in and this page will open your questionnaire. If you have the email we sent you,
          the link in it works without signing in.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Link
            to="/login"
            className="inline-flex justify-center px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm no-underline"
          >
            Sign in
          </Link>
          <Link
            to="/cbat"
            className="inline-flex justify-center px-6 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-xl text-sm no-underline"
          >
            Go to SkyWatch
          </Link>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-md mx-auto py-16 text-center" data-testid="survey-loading">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    )
  }

  if (fatal) {
    return (
      <div className="max-w-md mx-auto py-16 text-center" data-testid="survey-error">
        <SEO title="Questionnaire" description="SkyWatch questionnaire." noIndex />
        <div className="text-5xl mb-4">🔗</div>
        <h1 className="text-xl font-extrabold text-slate-900 mb-2">This link is not valid</h1>
        <p className="text-sm text-slate-500 mb-6">{fatal}</p>
        <Link to="/cbat" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm no-underline">
          Go to SkyWatch
        </Link>
      </div>
    )
  }

  if (meta?.optedOut) {
    return <SurveyClosed title="You have been unsubscribed" body="We will not email you about this again." />
  }

  if (meta?.closed) {
    return <SurveyClosed title="This questionnaire has closed" body="Thank you for your interest. The answers are already in." />
  }

  return (
    <div className="max-w-md mx-auto pb-10" data-testid="survey-page">
      <SEO title="How did your CBAT go?" description="A short SkyWatch questionnaire." noIndex />

      {isPreview && (
        <div
          data-testid="survey-preview-banner"
          className="mb-5 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2"
        >
          <p className="text-[11px] font-bold text-amber-800 uppercase tracking-widest">Preview</p>
          <p className="text-xs text-slate-600 leading-relaxed mt-0.5">
            This is the demo. Nothing is saved, no account is changed, the donation button does
            not take a payment, and any score sheet you choose stays in your browser.
          </p>
        </div>
      )}

      {progress !== null && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={back}
              disabled={!history.length}
              className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-0 transition-colors"
            >
              ← Back
            </button>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
              {stepIndex + 1} of {CORE_STEPS.length}
            </span>
          </div>
          <div className="h-1 rounded-full bg-slate-200 overflow-hidden">
            <motion.div
              className="h-full bg-brand-600"
              initial={false}
              animate={{ width: `${progress * 100}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 28 }}
            />
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          {step === 'intro' && (
            <IntroCard name={meta?.name} onStart={() => goTo('sat')} />
          )}

          {step === 'sat' && (
            <QuestionCard
              title="Have you sat the real test yet?"
              hint="If not, this takes one tap and we will leave you to it."
            >
              <ChoiceButton
                testId="survey-sat-yes"
                selected={answers.satTest === true}
                onClick={() => answerAndAdvance('sat', { satTest: true }, true)}
              >
                Yes, I have sat it
              </ChoiceButton>
              <ChoiceButton
                testId="survey-sat-no"
                selected={answers.satTest === false}
                onClick={() => answerAndAdvance('sat', { satTest: false }, false)}
              >
                Not yet
              </ChoiceButton>
            </QuestionCard>
          )}

          {step === 'booked' && (
            <BookedCard
              onSubmit={(patch) => answerAndAdvance('booked', patch, null)}
            />
          )}

          {step === 'notyet' && <NotYetCard deferredUntil={deferredUntil} />}

          {step === 'role' && (
            <QuestionCard
              title="Which role were you tested for?"
              hint="Search by role or by service."
            >
              <RoleCombobox
                value={answers.role}
                other={answers.roleOther}
                onSelect={(key) => {
                  if (key === OTHER_ROLE_KEY) {
                    // Do not advance — they still have to type the role.
                    save({ role: key })
                  } else {
                    answerAndAdvance('role', { role: key, roleOther: null }, key)
                  }
                }}
                onOtherSubmit={(text) => answerAndAdvance('role', { role: OTHER_ROLE_KEY, roleOther: text }, OTHER_ROLE_KEY)}
              />
            </QuestionCard>
          )}

          {step === 'passed' && (
            <QuestionCard
              title="Did you pass for that role?"
              hint={answers.role ? roleLabel(answers.role, answers.roleOther) : ''}
            >
              <ChoiceButton
                testId="survey-passed-yes"
                selected={answers.passedForRole === 'yes'}
                onClick={() => answerAndAdvance('passed', { passedForRole: 'yes' }, 'yes')}
              >
                Yes, I passed
              </ChoiceButton>
              <ChoiceButton
                testId="survey-passed-no"
                selected={answers.passedForRole === 'no'}
                onClick={() => answerAndAdvance('passed', { passedForRole: 'no' }, 'no')}
              >
                No, I did not
              </ChoiceButton>
              <ChoiceButton
                testId="survey-passed-waiting"
                selected={answers.passedForRole === 'waiting'}
                onClick={() => answerAndAdvance('passed', { passedForRole: 'waiting' }, 'waiting')}
              >
                Still waiting to hear
              </ChoiceButton>
            </QuestionCard>
          )}

          {step === 'passedAny' && (
            <QuestionCard
              title="Did you pass for any other role?"
              hint="Scores often qualify you for something you did not apply for."
            >
              <ChoiceButton
                testId="survey-any-yes"
                selected={answers.passedAnyRole === 'yes'}
                onClick={() => answerAndAdvance('passedAny', { passedAnyRole: 'yes' }, 'yes')}
              >
                Yes, for another role
              </ChoiceButton>
              <ChoiceButton
                testId="survey-any-no"
                selected={answers.passedAnyRole === 'no'}
                onClick={() => answerAndAdvance('passedAny', { passedAnyRole: 'no' }, 'no')}
              >
                No
              </ChoiceButton>
            </QuestionCard>
          )}

          {step === 'realism' && (
            <QuestionCard
              title="How close were our practice tests to the real thing?"
              hint="This is the answer that tells us what to fix."
            >
              <RatingScale
                options={RATINGS.realism}
                value={answers.realismRating}
                testIdPrefix="survey-realism"
                onSelect={(v) => answerAndAdvance('realism', { realismRating: v }, v)}
              />
            </QuestionCard>
          )}

          {step === 'helped' && (
            <QuestionCard title="Did SkyWatch help you?" hint="Be honest. It is more useful than being kind.">
              <RatingScale
                options={RATINGS.helped}
                value={answers.helpedRating}
                testIdPrefix="survey-helped"
                onSelect={(v) => answerAndAdvance('helped', { helpedRating: v }, v)}
              />
            </QuestionCard>
          )}

          {step === 'gaps' && (
            <GapsCard
              initial={answers.gaps}
              realismRating={answers.realismRating}
              saving={saving}
              onSubmit={(text) => answerAndAdvance('gaps', { gaps: text || null }, text)}
            />
          )}

          {step === 'upload' && (
            <SheetUploadCard
              API={API}
              token={token}
              preview={isPreview}
              sheets={sheets}
              onSheets={setSheets}
              onDone={() => goTo('done')}
            />
          )}

          {step === 'done' && (
            <DoneCard
              badge={badge}
              name={meta?.name}
              API={API}
              preview={isPreview}
              usedAndroid={!!meta?.usedAndroid}
              awaitingResult={answers.passedForRole === 'waiting'}
              onDonationClick={() => save({ donationClicked: true })}
              onPlayReviewClick={() => save({ playReviewClicked: true })}
              onComment={(text) => save({ comment: text })}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ── Cards ───────────────────────────────────────────────────────────────────

function IntroCard({ name, onStart }) {
  return (
    <div className="text-center py-6" data-testid="survey-intro">
      <div className="text-5xl mb-4">🎯</div>
      <h1 className="text-2xl font-extrabold text-slate-900 mb-2">
        {name ? `Hello ${name}` : 'Hello'}
      </h1>
      <p className="text-sm text-slate-500 leading-relaxed mb-6">
        Six quick questions about how your CBAT went. It takes about a minute, there is
        nothing to sign in to, and your answers tell us what to fix next.
      </p>
      <button
        onClick={onStart}
        data-testid="survey-start"
        className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm transition-colors"
      >
        Start
      </button>
    </div>
  )
}

function QuestionCard({ title, hint, children }) {
  return (
    <div>
      <h1 className="text-xl font-extrabold text-slate-900 mb-1 leading-snug">{title}</h1>
      {hint && <p className="text-xs text-slate-500 mb-5">{hint}</p>}
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function ChoiceButton({ children, selected, onClick, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={selected}
      className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm font-semibold transition-colors ${
        selected
          ? 'bg-brand-600 border-brand-600 text-white'
          : 'bg-surface border-slate-200 text-slate-700 hover:border-brand-400 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  )
}

function RatingScale({ options, value, onSelect, testIdPrefix }) {
  return (
    <div className="space-y-2.5" role="group">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onSelect(o.value)}
          aria-pressed={value === o.value}
          data-testid={`${testIdPrefix}-${o.value}`}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold transition-colors ${
            value === o.value
              ? 'bg-brand-600 border-brand-600 text-white'
              : 'bg-surface border-slate-200 text-slate-700 hover:border-brand-400 hover:text-slate-900'
          }`}
        >
          <span
            className={`shrink-0 w-7 h-7 rounded-lg grid place-items-center text-xs font-bold ${
              value === o.value ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {o.value}
          </span>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function GapsCard({ initial, realismRating, onSubmit, saving }) {
  const [text, setText] = useState(initial ?? '')
  const variant = gapsVariantFor(realismRating)

  return (
    <div data-testid="survey-gaps" data-variant={variant === GAPS_VARIANTS.low ? 'low' : variant === GAPS_VARIANTS.mid ? 'mid' : 'high'}>
      <h1 className="text-xl font-extrabold text-slate-900 mb-1 leading-snug">
        {variant.title}
      </h1>
      <p className="text-xs text-slate-500 mb-5 leading-relaxed">
        {variant.hint}
      </p>
      <textarea
        rows={5}
        value={text}
        onChange={e => setText(e.target.value)}
        maxLength={2000}
        placeholder={variant.placeholder}
        data-testid="survey-gaps-input"
        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-surface text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 resize-y transition-all"
      />
      <button
        onClick={() => onSubmit(text.trim())}
        disabled={saving}
        data-testid="survey-gaps-submit"
        className="w-full mt-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm transition-colors disabled:opacity-50"
      >
        Finish
      </button>
      <button
        onClick={() => onSubmit('')}
        className="w-full mt-2 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
      >
        Skip this
      </button>
    </div>
  )
}

// The question that turns a mistimed send into a scheduled one.
//
// Asking when the test is booked is only reasonable because of what we offer in
// return, stated plainly above the field: we will not ask again until after it.
// That is a promise the server keeps by deferring the invite to the date given,
// which is why the answer is worth collecting rather than just being polite.
function BookedCard({ onSubmit }) {
  const [date, setDate] = useState('')

  const today = new Date()
  const iso = (d) => d.toISOString().slice(0, 10)
  const max = new Date(today); max.setFullYear(max.getFullYear() + 3)

  return (
    <div data-testid="survey-booked">
      <h1 className="text-xl font-extrabold text-slate-900 mb-1 leading-snug">
        When is your test booked for?
      </h1>
      <p className="text-xs text-slate-500 mb-5 leading-relaxed">
        Tell us and we will not contact you again about this until after that date. If you would
        rather not say, that is fine too.
      </p>

      <input
        type="date"
        value={date}
        min={iso(today)}
        max={iso(max)}
        onChange={e => setDate(e.target.value)}
        aria-label="Test date"
        data-testid="survey-booked-date"
        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-surface text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all"
      />

      <button
        onClick={() => onSubmit({ testBookedFor: date, testBookedUnknown: false })}
        disabled={!date}
        data-testid="survey-booked-submit"
        className="w-full mt-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm transition-colors disabled:opacity-40"
      >
        Save the date
      </button>
      <button
        onClick={() => onSubmit({ testBookedUnknown: true, testBookedFor: null })}
        data-testid="survey-booked-unknown"
        className="w-full mt-2 py-3 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:border-brand-400 transition-colors"
      >
        I have not booked it yet
      </button>
      <button
        onClick={() => onSubmit({ testBookedUnknown: false, testBookedFor: null })}
        data-testid="survey-booked-skip"
        className="w-full mt-2 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
      >
        Rather not say
      </button>
    </div>
  )
}

function NotYetCard({ deferredUntil }) {
  const when = deferredUntil
    ? new Date(deferredUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  return (
    <div className="text-center py-6" data-testid="survey-notyet">
      <div className="text-5xl mb-4">🍀</div>
      <h1 className="text-2xl font-extrabold text-slate-900 mb-2">Good luck</h1>
      <p className="text-sm text-slate-500 leading-relaxed mb-6">
        Thanks for letting us know. {when
          ? <>We will not ask about this again before <span className="font-semibold text-slate-700">{when}</span>.</>
          : <>We will not ask again until you have had your chance at it.</>}
        {' '}Your training is exactly where you left it.
      </p>
      <Link
        to="/cbat"
        className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm no-underline transition-colors"
      >
        Back to training
      </Link>
    </div>
  )
}

function SurveyClosed({ title, body }) {
  return (
    <div className="max-w-md mx-auto py-16 text-center" data-testid="survey-closed">
      <SEO title="Questionnaire" description="SkyWatch questionnaire." noIndex />
      <div className="text-5xl mb-4">✓</div>
      <h1 className="text-xl font-extrabold text-slate-900 mb-2">{title}</h1>
      <p className="text-sm text-slate-500 mb-6">{body}</p>
      <Link to="/cbat" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm no-underline">
        Go to SkyWatch
      </Link>
    </div>
  )
}

// The closing screen: thanks, then the badge they have just earned, then the
// ask. The order is the point — the donation follows something given, not a
// request out of nowhere.
/**
 * The score sheet ask.
 *
 * Deliberately NOT one of the six questions, and deliberately not on the
 * closing screen either.
 *
 * Not a question, because it is the only thing in the run that wants a file
 * rather than a tap. Putting a file picker in the middle of a
 * one-question-per-screen flow is the surest way to lose the people who would
 * have answered the rest, and the rest is the data the campaign was built for.
 *
 * Not on the closing screen, because that screen already carries the donation
 * ask, and DoneCard is written around only ever making one ask at a time. This
 * sits between the last answer and the thank-you, where the goodwill is highest
 * and nothing is competing with it.
 *
 * The run is already saved and marked complete before this renders. Skipping
 * costs nothing, which is why the skip is a plain visible button rather than
 * something to hunt for.
 */
function SheetUploadCard({ API, token, preview = false, sheets = [], onSheets, onDone }) {
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const full = sheets.length >= MAX_SHEETS

  async function pick(fileList) {
    const files = Array.from(fileList ?? []).slice(0, MAX_SHEETS - sheets.length)
    if (!files.length) return
    setBusy(true); setError('')
    // Accumulated locally rather than read back off the prop each time: the
    // prop is a render behind, so picking two files at once would keep only the
    // second. The real path has no such problem because the server hands back
    // the whole list every time.
    let local = sheets
    // One bad page must not throw away the good ones. Someone sending a
    // three-page sheet in one go should end up with the two that worked and a
    // line about the third, not an empty list and an error.
    const failed = []
    try {
      for (const file of files) {
        try {
          if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`)
          const dataUrl = await prepareSheet(file)

          // The demo never sends anything. It keeps the downscaled image in
          // memory so the thumbnail, the count and the remove button all behave
          // exactly as they would, and says plainly that nothing left the page.
          if (preview) {
            local = [...local, { _id: `preview-${Date.now()}-${local.length}`, url: dataUrl, uploadedAt: new Date().toISOString() }]
            onSheets(local)
            continue
          }

          const res = await fetch(`${API}/api/survey/${token}/cbat-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.message || 'That did not upload. Please try again.')
          local = data.data?.images ?? []
          onSheets(local)
        } catch (err) {
          failed.push(err.message)
        }
      }
      if (failed.length) setError(failed.join(' '))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove(id) {
    setError('')
    if (preview) {
      onSheets(sheets.filter(x => x._id !== id))
      return
    }
    try {
      const res = await fetch(`${API}/api/survey/${token}/cbat-result/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || 'Could not remove that.')
      onSheets(data.data?.images ?? [])
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div data-testid="survey-upload">
      <div className="text-center mb-5">
        <div className="text-4xl mb-3">📄</div>
        <h1 className="text-xl font-extrabold text-slate-900 mb-2">
          One last thing, and it is optional
        </h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          Would you send us photos of your score sheet?
        </p>
      </div>

      {/* The specific reason, not a general one.
          "Helps us improve" is what every form says and it persuades nobody.
          What is actually true here is narrower and much more convincing: the
          score estimates on this site were worked out by hand from real score
          sheets, so one more sheet measurably improves the number the next
          person is shown. Saying the true thing is also the only honest way to
          ask for a document with someone's name on it. */}
      <div className="bg-surface rounded-2xl border border-slate-200 p-4 sm:p-5 mb-4">
        <p className="text-sm text-slate-700 leading-relaxed mb-3">
          Our practice tests and score estimates are built from real score sheets, worked out by
          hand from the ones people have sent us. There is no other way to get those numbers, and
          every extra sheet makes the estimate the next person sees more accurate.
        </p>
        <p className="text-sm text-slate-700 leading-relaxed mb-3">
          A sheet is just as useful whether you passed or not. Knowing where the line actually
          falls is the part we cannot work out on our own.
        </p>
        {/* Said early and plainly, because a score sheet usually runs to more
            than one page and the singular ask gets one page sent. */}
        <p className="text-sm text-slate-700 leading-relaxed mb-3">
          If yours runs to more than one page, please send every page. You can choose several
          photos at once, up to {MAX_SHEETS}.
        </p>

        {/* Said before the button, not after it, and said plainly. This is the
            only thing the questionnaire asks for that is a real document with
            a real name on it, so the terms belong where the decision is made. */}
        <ul className="text-xs text-slate-600 leading-relaxed space-y-1.5 mb-4 list-disc pl-4">
          <li>It is never published, never shown to other members and never put on a leaderboard.</li>
          <li>It is only used to check our practice tests and score estimates against the real thing.</li>
          <li>
            Cover your name and candidate number first if you would rather. We only need the
            scores, and a sheet with the personal details blacked out is just as useful.
          </li>
          <li>You can remove it again on this screen, or ask us to delete it at any time.</li>
        </ul>

        {sheets.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-4" data-testid="survey-upload-list">
            {sheets.map(img => (
              <div key={img._id} className="relative rounded-xl overflow-hidden border border-slate-200">
                <img
                  src={img.url}
                  alt="Score sheet you sent"
                  className="w-full h-24 object-cover"
                />
                <button
                  type="button"
                  onClick={() => remove(img._id)}
                  data-testid={`survey-upload-remove-${img._id}`}
                  aria-label="Remove this image"
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-50/90 text-slate-700 hover:bg-rose-100 hover:text-rose-700 text-xs font-bold leading-none transition-colors"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          data-testid="survey-upload-file"
          onChange={e => pick(e.target.files)}
        />

        {error && <p className="text-xs text-rose-600 mb-2" data-testid="survey-upload-error">{error}</p>}
        {preview && sheets.length > 0 && (
          <p className="text-xs text-amber-700 mb-2" data-testid="survey-upload-preview-note">
            Preview: this image stayed in your browser and was not uploaded.
          </p>
        )}

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy || full}
          data-testid="survey-upload-choose"
          className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm transition-colors disabled:opacity-50"
        >
          {busy ? 'Sending…'
            : full ? `That is the maximum of ${MAX_SHEETS}`
            : sheets.length ? 'Add another page'
            : 'Choose photos'}
        </button>

        <p className="text-[11px] text-slate-500 leading-relaxed mt-2 text-center">
          Sending them means you are happy for us to store them for the purpose above. See our{' '}
          <Link to="/privacy" className="font-semibold text-slate-600 hover:text-slate-700">
            privacy policy
          </Link>.
        </p>
      </div>

      <button
        type="button"
        onClick={onDone}
        data-testid="survey-upload-skip"
        className="w-full py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
      >
        {/* Not "Skip this": the question before this one already offers exactly
            that, and two consecutive screens with an identically worded decline
            read as the same screen failing to advance. */}
        {sheets.length ? 'Done' : 'No thanks'}
      </button>
    </div>
  )
}

function DoneCard({ badge, name, API, preview = false, usedAndroid = false, awaitingResult = false, onDonationClick, onPlayReviewClick, onComment }) {
  const [amount, setAmount] = useState(DONATION_PRESETS[0])
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState('')
  const [declined, setDeclined] = useState(false)
  const [note,   setNote]   = useState('')

  const donate = async () => {
    if (busy) return
    onDonationClick()
    // The demo stops here rather than opening a Checkout session. Creating one
    // would be a real Stripe object with a real payable link in it.
    if (preview) {
      setNote(`Preview: this would open Stripe Checkout for £${amount}.`)
      return
    }
    setBusy(true); setError('')
    try {
      const res = await fetch(`${API}/api/stripe/create-donation-session`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start the payment.')
      window.location.href = data.url
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div data-testid="survey-done">
      <div className="text-center mb-6">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 13, delay: 0.05 }}
          className="text-5xl mb-3"
        >
          🙏
        </motion.div>
        <h1 className="text-2xl font-extrabold text-slate-900 mb-2">
          Thank you{name ? `, ${name}` : ''}
        </h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          That is genuinely useful. Answers like yours help us improve our training for
          future applicants.
        </p>
      </div>

      {badge && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          data-testid="survey-badge"
          className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 mb-5 text-center"
        >
          <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-200/60 text-emerald-800 uppercase tracking-wide mb-2">
            Passed
          </span>
          <p className="text-sm font-bold text-slate-800 mb-0.5">Congratulations on your pass</p>
          <p className="text-xs text-slate-600 leading-relaxed">
            Your PASSED badge is now on your account. It appears beside your name on every
            leaderboard and in Community the next time you sign in.
          </p>
        </motion.div>
      )}

      {/* Never in the native app: Google Play treats donations outside Play
          Billing as a carve-out for registered charities, and SkyWatch is not
          one. Same reasoning as Donate.jsx and the post-game ask. The
          questionnaire arrives by web link so this is defensive, not routine. */}
      {!SLIM_APP && !declined && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: badge ? 0.4 : 0.25 }}
          className="bg-surface rounded-2xl border border-slate-200 p-4 sm:p-5"
          data-testid="survey-donate"
        >
          {/* Who the money is FOR, not who needs it.
              "Help us cover our hosting" asks someone to fund an organisation;
              "keep it free for the person revising tonight" asks them to fund a
              person, and a named beneficiary is reliably the stronger ask. It is
              also simply the truer description of what the money does here.

              Split on whether they passed, because the same sentence lands very
              differently either way. To someone who is through, the reciprocity
              is real and worth naming. To someone who is not, a line about
              helping others succeed would be a poor thing to read, so they get
              the plain version. */}
          <p className="text-sm font-bold text-slate-800 mb-1">
            {badge ? 'Keep it free for the next person' : 'Help keep SkyWatch free'}
          </p>
          <p className="text-xs text-slate-500 leading-relaxed mb-4">
            {badge
              ? <>You got through, and the training was free the whole way. A one-off £3 helps
                  keep it that way for whoever is preparing for the same tests right now. There
                  is nothing to unlock, and nothing changes if you would rather not.</>
              : <>SkyWatch is free, has no ads and is paid for out of pocket. A one-off £3 helps
                  keep it that way for everyone preparing. There is nothing to unlock, and
                  nothing changes if you would rather not.</>}
          </p>

          <div className="grid grid-cols-3 gap-2 mb-3" role="group" aria-label="Donation amount">
            {DONATION_PRESETS.map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setAmount(n)}
                aria-pressed={amount === n}
                data-testid={`survey-donate-${n}`}
                className={`py-2.5 rounded-xl border text-sm font-bold transition-colors ${
                  amount === n
                    ? 'bg-brand-600 border-brand-600 text-white'
                    : 'bg-transparent border-slate-200 text-slate-700 hover:border-brand-400'
                }`}
              >
                £{n}
              </button>
            ))}
          </div>

          {/* The one thing a short ladder gives up is the person who wanted to
              give £50. This hands them the full page rather than putting a
              text field on a card whose whole value is being one tap. */}
          <div className="text-center mb-3">
            <Link
              to="/donate"
              onClick={onDonationClick}
              data-testid="survey-donate-other"
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 no-underline"
            >
              Or give another amount
            </Link>
          </div>

          {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
          {note && <p className="text-xs text-amber-700 mb-2" data-testid="survey-donate-note">{note}</p>}

          <button
            onClick={donate}
            disabled={busy}
            data-testid="survey-donate-submit"
            className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm transition-colors disabled:opacity-50"
          >
            {busy ? 'Opening…' : `Give £${amount}`}
          </button>
          <button
            onClick={() => setDeclined(true)}
            className="w-full mt-2 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
          >
            Not this time
          </button>
        </motion.div>
      )}

      {declined && (
        <p className="text-center text-sm text-slate-500 py-4" data-testid="survey-declined">
          That is completely fine. Thanks again for answering.
        </p>
      )}

      {/* The other ask, and only ever the other one.
          Two asks stacked on one screen dilute each other, so this takes the
          place of the donation rather than sitting under it: it appears once the
          donation has been turned down, and stands alone in the native app,
          where a donation cannot be offered at all. Someone who gives has
          already gone to Stripe and is never asked for anything else. */}
      {usedAndroid && (declined || SLIM_APP) && (
        <PlayReviewCard onClick={onPlayReviewClick} />
      )}

      {/* The score sheet step is skipped for anyone still waiting on a result,
          since asking for a document they do not have would be a dead screen.
          They are the people most likely to have one soon, though, so the
          invitation is made here instead. Their link keeps working, and coming
          back to it lands on this same screen with the upload available. */}
      {awaitingResult && (
        <p className="text-center text-xs text-slate-500 leading-relaxed mt-5" data-testid="survey-sheet-later">
          When your result comes through, we would love a photo of your score sheet. It is what
          our score estimates are built from. Just open this same link again.
        </p>
      )}

      <CommentBox onSubmit={onComment} />

      <div className="text-center mt-6">
        <Link to="/cbat" className="text-xs font-semibold text-slate-500 hover:text-slate-700 no-underline">
          Back to SkyWatch
        </Link>
      </div>
    </div>
  )
}

// The Google Play ask, shown only to people the server already knows have run
// the Android app (User.osSeen.android, written from the app's own heartbeat).
// Asking a web-only respondent to rate an app they have never opened wastes the
// one thing this screen has left to spend.
//
// Shown to EVERY Android respondent regardless of what they answered. Routing
// only the ones who said kind things to the store is review gating, which Play's
// policy prohibits, so the ask is identical whether they passed or failed and
// whether they rated us 5 or 1.
//
// A link rather than a button: Android hands play.google.com straight to the
// Play app, and on a laptop it opens the web listing instead of dead-ending.
function PlayReviewCard({ onClick }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface rounded-2xl border border-slate-200 p-4 sm:p-5"
      data-testid="survey-play-review"
    >
      <p className="text-sm font-bold text-slate-800 mb-1">Rate the app on Google Play</p>
      <p className="text-xs text-slate-500 leading-relaxed mb-4">
        You have used the SkyWatch Android app. A rating on Google Play is how most people
        preparing for these tests find it in the first place. It takes a few seconds, and it is
        easiest on your phone.
      </p>
      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        data-testid="survey-play-review-link"
        className="block w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm text-center no-underline transition-colors"
      >
        Open Google Play
      </a>
    </motion.div>
  )
}

// The open box, kept closed until asked for.
//
// It sits BELOW the donation and starts as one line of text, because an open
// textarea competes with the ask above it and most people have nothing to add.
// Anyone who does have something to say will happily click one link to say it.
// Nothing here is required and the questionnaire is already saved by this
// point, so there is no wrong way to leave this screen.
function CommentBox({ onSubmit }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)

  if (sent) {
    return (
      <p className="text-center text-xs text-slate-500 mt-5" data-testid="survey-comment-thanks">
        Thank you, that is noted.
      </p>
    )
  }

  if (!open) {
    return (
      <div className="text-center mt-5">
        <button
          onClick={() => setOpen(true)}
          data-testid="survey-comment-open"
          className="text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
        >
          Anything else you would like to tell us?
        </button>
      </div>
    )
  }

  return (
    <div className="mt-5" data-testid="survey-comment-box">
      <label htmlFor="survey-comment" className="block text-xs font-semibold text-slate-500 mb-1.5">
        Anything else you would like to tell us?
      </label>
      <textarea
        id="survey-comment"
        rows={4}
        autoFocus
        value={text}
        maxLength={2000}
        onChange={e => setText(e.target.value)}
        placeholder="Whatever you like. We read all of these."
        data-testid="survey-comment-input"
        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-surface text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 resize-y transition-all"
      />
      <button
        onClick={() => { onSubmit(text.trim()); setSent(true) }}
        disabled={!text.trim()}
        data-testid="survey-comment-submit"
        className="w-full mt-2 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:border-brand-400 transition-colors disabled:opacity-40"
      >
        Send it
      </button>
    </div>
  )
}

// ── Role picker ─────────────────────────────────────────────────────────────

// A searchable, grouped combobox rather than a native <select>. The list spans
// six services, and a native select on mobile becomes an unscannable wheel the
// moment it passes a dozen entries.
function RoleCombobox({ value, other, onSelect, onOtherSubmit }) {
  const [query, setQuery] = useState('')
  const [otherText, setOtherText] = useState(other ?? '')
  const inputRef = useRef(null)

  const groups = useMemo(() => filterRoleGroups(query), [query])
  const showingOther = value === OTHER_ROLE_KEY

  useEffect(() => { inputRef.current?.focus() }, [])

  if (showingOther) {
    return (
      <div data-testid="survey-role-other">
        <label htmlFor="survey-role-other-input" className="block text-xs font-semibold text-slate-500 mb-1.5">
          What was the role?
        </label>
        <input
          id="survey-role-other-input"
          data-testid="survey-role-other-input"
          value={otherText}
          onChange={e => setOtherText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && otherText.trim()) onOtherSubmit(otherText.trim()) }}
          maxLength={120}
          autoFocus
          placeholder="Role and service"
          className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-surface text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all"
        />
        <button
          onClick={() => onOtherSubmit(otherText.trim())}
          disabled={!otherText.trim()}
          data-testid="survey-role-other-submit"
          className="w-full mt-3 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm transition-colors disabled:opacity-40"
        >
          Continue
        </button>
        <button
          onClick={() => onSelect(null)}
          className="w-full mt-2 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
        >
          ← Pick from the list instead
        </button>
      </div>
    )
  }

  return (
    <div data-testid="survey-role-picker">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search roles…"
        aria-label="Search roles"
        data-testid="survey-role-search"
        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-surface text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all mb-3"
      />

      <div className="max-h-[22rem] overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
        {groups.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-slate-500">
            No match. Choose &ldquo;My role isn&apos;t listed&rdquo; below.
          </p>
        )}
        {groups.map(g => (
          <div key={g.service}>
            <p className="px-4 pt-3 pb-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest bg-slate-50/50">
              {g.service}
            </p>
            {g.roles.map(r => (
              <button
                key={r.key}
                type="button"
                onClick={() => onSelect(r.key)}
                data-testid={`survey-role-${r.key}`}
                className={`w-full text-left px-4 py-2.5 text-sm font-medium transition-colors ${
                  value === r.key
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {groups.length === 0 && (
        <button
          onClick={() => onSelect(OTHER_ROLE_KEY)}
          className="w-full mt-3 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:border-brand-400 transition-colors"
        >
          My role isn&apos;t listed
        </button>
      )}
    </div>
  )
}

// Read a File, shrink it, hand back a JPEG data URL.
//
// The shrink is what makes the upload possible at all, not merely faster: see
// SHEET_MAX_EDGE. Everything here is deliberately forgiving, because the input
// is a photo taken on an unknown phone and the worst outcome is refusing a
// sheet someone was willing to give us.
//
// The canvas path is skipped when there is no canvas to draw on (jsdom, and any
// browser where the decode fails, which is what an unconverted HEIC does on a
// desktop). In that case the original bytes are sent as they are and the
// server's own size limit is the backstop.
async function prepareSheet(file) {
  const original = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })

  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload  = () => resolve(el)
      el.onerror = () => reject(new Error('decode failed'))
      el.src = original
    })

    const scale = Math.min(1, SHEET_MAX_EDGE / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width  = Math.round(img.width  * scale)
    canvas.height = Math.round(img.height * scale)
    const ctx = canvas.getContext?.('2d')
    if (!ctx || !canvas.width || !canvas.height) return original
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const out = canvas.toDataURL('image/jpeg', SHEET_QUALITY)
    // A canvas that cannot encode returns a stub; never send that in place of
    // the photo someone actually chose.
    return out && out.startsWith('data:image/jpeg') ? out : original
  } catch {
    return original
  }
}

export { CORE_STEPS, RATINGS, ROLE_GROUPS }
