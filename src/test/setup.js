import '@testing-library/jest-dom'

// jsdom doesn't implement scrollIntoView — stub it globally to prevent uncaught exceptions
window.HTMLElement.prototype.scrollIntoView = function () {}
