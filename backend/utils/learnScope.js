// Slim ("CBAT-only") mode brings the Learn section back one category at a time.
// Which categories are open lives in constants/slimLearn.json, shared with the
// frontend so both sides agree on what a slim player can read.
//
// In slim mode those categories are open to every signed-in player whatever
// their level or subscription, and every other category is "coming soon" and
// closed to everyone, Gold and admins included. The full site keeps its normal
// tier + pathway gating.
//
// The subscription helpers (utils/subscription.js) do the enforcing: they
// check `settings.learnCategoriesOverride` before anything else. This file
// only decides whether a request is slim and, if so, sets that field.
const AppSettings = require('../models/AppSettings');
const { SLIM_LEARN_CATEGORIES } = require('../constants/slimLearn.json');

// Two independent triggers, mirroring the client's useSlimMode():
//   • the site-wide AppSettings.slimModeEnabled flag, or
//   • an X-Slim-App: 1 header, which the native app sends on every request
//     because it is always slim and the backend can't otherwise tell.
// Trusting the header is safe: it can only narrow what a caller may read.
function isSlimRequest(req, settings) {
  if (req?.get?.('X-Slim-App') === '1') return true;
  return Boolean(settings?.slimModeEnabled);
}

// Marks this request's settings with the slim category list when the request
// is slim. getSettings() returns a fresh document per call, so the field never
// leaks into another request, and it is not a schema path so it is never saved.
// With the admin's "Learn in Slim Mode" flag off, the list is empty: every
// category is closed, so turning Learn off takes effect here as well as in the
// nav, including for app versions that predate the flag.
function scopeLearnToSlim(req, settings) {
  if (settings && isSlimRequest(req, settings)) {
    settings.learnCategoriesOverride = settings.slimLearnEnabled === false ? [] : SLIM_LEARN_CATEGORIES;
  }
  return settings;
}

// getSettings() + scopeLearnToSlim() in one call, for gating sites that have
// nothing else to do with the settings load.
async function getLearnSettings(req) {
  return scopeLearnToSlim(req, await AppSettings.getSettings());
}

module.exports = { SLIM_LEARN_CATEGORIES, isSlimRequest, scopeLearnToSlim, getLearnSettings };
