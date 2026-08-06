// Voices job — start Voicebox and report the profiles it holds.
//
// The heartbeat deliberately does NOT do this. It only reports profiles when
// Voicebox happens to already be running, because booting it loads torch and a
// model — far too heavy to do every ten seconds on the off-chance someone
// opens the Voice tab.
//
// So enumerating profiles is an explicit action instead: the admin asks, this
// runs, and the picker fills in. First run is slow (cold model load); after
// that the server stays up and it is instant.

const voicebox = require('../voicebox');

module.exports = async function voicesHandler({ progress }) {
  await progress(10, 'starting voicebox');
  await voicebox.ensureRunning({ log: () => {} });

  await progress(70, 'reading profiles');
  const profiles = await voicebox.listProfiles();

  const voices = (Array.isArray(profiles) ? profiles : [])
    .map(p => ({ id: p.id, name: p.name }))
    .filter(v => v.id && v.name);

  await progress(100, `${voices.length} profiles`);
  return { voices };
};
