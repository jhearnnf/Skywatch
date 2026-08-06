// Job handlers, keyed by ClipperJob.type.
//
// Each handler receives ({ job, progress }) and returns the result object that
// gets stored on the job. Throwing marks the job failed, and the server retries
// it until maxAttempts.
//
// The stages land here one at a time as they are built. A type with no handler
// fails loudly rather than silently succeeding — a job that reports "done"
// without doing anything is the worst outcome, because the UI would advance the
// script to a stage whose work never happened.

const handlers = {
  voices:   require('./voices'),
  voice:    require('./voice'),
  captions: require('./captions'),
  capture:  require('./capture'),
  render:   require('./render'),
};

function getHandler(type) {
  const handler = handlers[type];
  if (!handler) {
    throw new Error(`No handler for job type "${type}" — this agent build cannot run it`);
  }
  return handler;
}

module.exports = { handlers, getHandler };
