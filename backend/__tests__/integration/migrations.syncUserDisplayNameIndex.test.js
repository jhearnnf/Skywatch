process.env.JWT_SECRET = 'test_secret';

const mongoose = require('mongoose');
const db       = require('../helpers/setupDb');
const User     = require('../../models/User');
const syncUserDisplayNameIndex = require('../../migrations/syncUserDisplayNameIndex');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const INDEX_NAME = 'displayNameLower_1';

describe('migrations/syncUserDisplayNameIndex', () => {
  it('drops a legacy non-partial unique index and replaces it with the partial one', async () => {
    // Reproduce the prod-state index: unique, no partial filter.
    const collection = User.collection;
    // Wipe whatever mongoose already created so we can plant the stale version.
    try { await collection.dropIndex(INDEX_NAME); } catch { /* may not exist */ }
    await collection.createIndex({ displayNameLower: 1 }, { unique: true, name: INDEX_NAME });

    const before = (await collection.indexes()).find(i => i.name === INDEX_NAME);
    expect(before.unique).toBe(true);
    expect(before.partialFilterExpression).toBeUndefined();

    const result = await syncUserDisplayNameIndex({ logger: { log: () => {} } });
    expect(result.dropped).toBe(true);

    const after = (await collection.indexes()).find(i => i.name === INDEX_NAME);
    expect(after.unique).toBe(true);
    expect(after.partialFilterExpression).toEqual({ displayNameLower: { $type: 'string' } });

    // Two users with no displayName can now coexist — which was the failure mode.
    await User.create({ email: 'a@test.com', password: 'Password123' });
    await User.create({ email: 'b@test.com', password: 'Password123' });
    expect(await User.countDocuments()).toBe(2);
  });

  it('is a no-op when the index already matches the schema', async () => {
    // Mongoose's schema-driven index is already correct; calling sync should
    // not drop anything.
    await User.syncIndexes();
    const result = await syncUserDisplayNameIndex({ logger: { log: () => {} } });
    expect(result.dropped).toBe(false);
  });
});
