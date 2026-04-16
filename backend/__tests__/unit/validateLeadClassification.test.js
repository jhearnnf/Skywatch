/**
 * Unit tests for validateLeadClassification — the hard-rule gate that blocks
 * the AI auto-seeder from creating leads under the wrong category
 * (e.g. naval vessels under Aircrafts, umbrella titles that restate a
 * subcategory name).
 */

const { validateLeadClassification } = require('../../utils/keywordLinking');
const { SUBCATEGORIES } = require('../../constants/categories');

describe('validateLeadClassification', () => {
  test('rejects HMS-prefixed titles under Aircrafts', () => {
    const r = validateLeadClassification('HMS Queen Elizabeth', 'Aircrafts', { SUBCATEGORIES });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/prefix disallowed/);
  });

  test('rejects RFA/USS/HMCS/USNS-prefixed titles under Aircrafts', () => {
    for (const title of ['RFA Tidespring', 'USS Gerald R. Ford', 'HMCS Halifax', 'USNS Mercy']) {
      expect(validateLeadClassification(title, 'Aircrafts', { SUBCATEGORIES }).ok).toBe(false);
    }
  });

  test('allows HMS-prefixed titles under non-Aircrafts categories', () => {
    expect(validateLeadClassification('HMS Queen Elizabeth', 'Heritage', { SUBCATEGORIES }).ok).toBe(true);
  });

  test('rejects umbrella titles that restate a subcategory name', () => {
    const r = validateLeadClassification('Fast Jet', 'Aircrafts', { SUBCATEGORIES });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/umbrella/);
  });

  test('accepts legitimate specific aircraft titles', () => {
    expect(validateLeadClassification('Typhoon FGR4', 'Aircrafts', { SUBCATEGORIES }).ok).toBe(true);
    expect(validateLeadClassification('A400M Atlas', 'Aircrafts', { SUBCATEGORIES }).ok).toBe(true);
  });
});
