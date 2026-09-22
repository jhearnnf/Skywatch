// The words around "enter your test date", in one place.
//
// Three surfaces ask for the date: the card at the top of the Profile page,
// the My group tab on the CBAT lounge, and the Groups row on the Community
// rail. They used to each hardcode "CBAT", which reads wrong to a Canadian
// sitting the CFAST or an Australian sitting the MACTS. The server now sends
// `testName` with every cbat-group response (backend/routes/chat.js,
// COHORT_TEST_LABELS): 'CBAT', 'CFAST', 'MACTS', or null where no single
// name fits. Every string here is built from that one value so the surfaces
// can never disagree.
//
// Plain UK English, no em dashes, written for someone who has never heard
// of a "cohort".

export function cohortCopy(testName) {
  const name   = testName || 'test'
  const phrase = testName ? `the ${testName}` : 'their aptitude test'
  return {
    testName: testName || null,
    eyebrow:      testName ? `Private ${testName} group` : 'Private test-day group',
    heading:      `Meet the applicants sitting ${phrase} with you.`,
    intro:        `Enter your ${name} date to join a private group chat with everyone sitting ${phrase} on the same day in your region. Your date is only visible to people in that group.`,
    benefits: [
      `A private group chat with everyone sitting ${phrase} on your date, in your region`,
      'Swap questions and nerves in the days before, so you already know someone on the day',
      'Your date stays private to that group. Nobody else can see it',
    ],
    label:        `Upcoming ${name} date`,
    warning:      'Choose carefully. You cannot change this date.',
    warningHint:  'Check it before you click Continue.',
    confirmTitle: `Confirm your ${name} date`,
    confirmNote:  'This cannot be changed after you confirm.',
    joinButton:   'Confirm and join',
    joining:      'Joining…',
    passedTitle:  `You have already passed your ${name}`,
    passedBody:   `Upcoming-date groups are for applicants preparing to sit ${phrase}. If a date was already recorded for you, your original group is added automatically.`,
    noRegion:     'We could not work out your region yet. Refresh the app and try again.',
    saveError:    `Could not save your ${name} date.`,
    railHint:     `Enter your upcoming ${name} date to join`,
    railPassed:   `Not applicable: ${name} passed`,
    // The confirmed state on the Profile card.
    yourDate:     `Your ${name} date`,
  }
}

// The date the way the server sends it (YYYY-MM-DD, UTC midnight), spelt out.
export function formatCohortDate(dateKey, dateStyle = 'long') {
  return new Intl.DateTimeFormat('en-GB', { dateStyle, timeZone: 'UTC' }).format(new Date(`${dateKey}T00:00:00Z`))
}
