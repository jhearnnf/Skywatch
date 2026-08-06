/**
 * Guard rail: every actionType the code can produce must be in the enum.
 *
 * The bug this exists to prevent, which shipped and was live:
 * PATCH /api/admin/settings writes the settings FIRST, then records an
 * AdminAction whose type it derives from which keys changed. Eight of those
 * derived values were never added to the enum, so saving sound / economy /
 * quiz / pathway / content / AI settings applied the change, threw a
 * ValidationError on the audit row, and returned a 500 — telling the admin it
 * had failed when it had not, and leaving no audit trail at all.
 *
 * A missing enum value is invisible until someone touches that exact settings
 * group, which is why it went unnoticed. This makes it a test failure instead.
 */
const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', '..', 'routes');
const UTILS_DIR  = path.join(__dirname, '..', '..', 'utils');
const SERVICES_DIR = path.join(__dirname, '..', '..', 'services');

function readJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .map(f => ({ file: path.join(dir, f), src: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

// Literal `actionType: 'x'`, plus the derived chain in the settings route,
// which returns its type rather than assigning it inline.
function actionTypesIn(src) {
  const found = new Set();
  for (const m of src.matchAll(/actionType:\s*'([a-z_]+)'/g)) found.add(m[1]);
  if (src.includes('const actionType = (() =>')) {
    const block = src.split('const actionType = (() =>')[1].split('})();')[0];
    for (const m of block.matchAll(/return '([a-z_]+)'/g)) found.add(m[1]);
  }
  return found;
}

describe('AdminAction actionType coverage', () => {
  const { ACTION_TYPES } = require('../../models/AdminAction');

  it('exports the enum for inspection', () => {
    expect(Array.isArray(ACTION_TYPES)).toBe(true);
    expect(ACTION_TYPES.length).toBeGreaterThan(0);
  });

  it('covers every actionType the backend can write', () => {
    const allowed = new Set(ACTION_TYPES);
    const missing = [];

    for (const { file, src } of [
      ...readJs(ROUTES_DIR), ...readJs(UTILS_DIR), ...readJs(SERVICES_DIR),
    ]) {
      for (const type of actionTypesIn(src)) {
        if (!allowed.has(type)) missing.push(`${type} (${path.basename(file)})`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('has no duplicate entries', () => {
    expect(ACTION_TYPES.length).toBe(new Set(ACTION_TYPES).size);
  });
});
