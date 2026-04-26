import '@testing-library/jest-dom'
import { configure } from '@testing-library/dom'

// jsdom doesn't implement scrollIntoView — stub it globally to prevent uncaught exceptions
window.HTMLElement.prototype.scrollIntoView = function () {}

// Bump default waitFor / findBy timeout. Under parallel file execution multiple
// jsdom workers compete for CPU, and the library default of 1000ms is too tight
// for tests that wait on chained state updates (typeahead, modal transitions,
// fetch → setState → re-render). 5000ms gives headroom without masking real bugs.
configure({ asyncUtilTimeout: 5000 })
