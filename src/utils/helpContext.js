import { getRouteTrail } from './routeTrail'
import { peekClientInfo } from './appVersion'
import { collectReportEnvironment } from './reportEnvironment'

// What a request for help sends along so the team can triage it: where the
// person had just been, which build they are on and what their device is.
// "Report a problem" and "Message the team" are two doors into the same
// support ticket, so both send this and the admin gets the same evidence from
// either. The server cleans it with one matching builder
// (backend/utils/reportContext.js).
//
// `skip` drops the help page itself from the trail (the report form, or
// Community), so the last entry is the page they left to ask for help.
export async function collectHelpContext({ skip = () => false } = {}) {
  const routeTrail = getRouteTrail().filter(p => !skip(p))
  // OS, browser, screen, GPU and the rest. Best effort and time-capped inside
  // the collector, so it never holds up the request.
  const environment = await collectReportEnvironment()
  // Null on a native client whose bridge has not answered yet.
  const client = peekClientInfo()
  return {
    routeTrail,
    ...(client ? { client } : {}),
    ...(environment ? { environment } : {}),
  }
}
