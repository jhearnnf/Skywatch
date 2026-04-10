const path = require('path');
const pkg  = require('../../package.json');

describe('nodemon config', () => {
  test('package.json declares nodemonConfig', () => {
    expect(pkg.nodemonConfig).toBeDefined();
    expect(Array.isArray(pkg.nodemonConfig.ignore)).toBe(true);
  });

  // Regression: appendToSeedLeads writes to seeds/seedLeads.js mid-request.
  // If nodemon doesn't ignore that path, the dev server restarts mid-request
  // and the brief generation flow dies halfway through.
  test('ignores seeds/seedLeads.js so brief generation does not trigger restart', () => {
    const ignored = pkg.nodemonConfig.ignore;
    const hasSeedLeads = ignored.some(p => p.includes('seeds/seedLeads.js'));
    expect(hasSeedLeads).toBe(true);
  });

  test('the source file that triggers writes actually exists at that path', () => {
    const fs = require('fs');
    const seedPath = path.join(__dirname, '../../seeds/seedLeads.js');
    expect(fs.existsSync(seedPath)).toBe(true);
  });
});
