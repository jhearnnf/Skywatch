process.env.JWT_SECRET = 'test_secret';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('./app');
const { createSettings, createUser, createBrief, authCookie } = require('./__tests__/helpers/factories');

async function clearDatabase() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

(async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await createSettings();

  // Simulate what happens before the register test:
  // The "returns 401 if not logged in" test (last Report Problem test)
  console.log('Running Report Problem 401 test...');
  const r1 = await request(app)
    .post('/api/users/report-problem')
    .send({ pageReported: '/learn', description: 'Bug' });
  console.log('Report 401 status:', r1.status);

  // afterEach clears DB
  console.log('Clearing DB...');
  await clearDatabase();

  // Now run the register test
  console.log('Running register test...');
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: 'newagent@raf.com', password: 'Password123' });
  console.log('Register status:', res.status);
  console.log('Register body:', JSON.stringify(res.body));

  await mongoose.connection.close();
  await mongod.stop();
})().catch(e => console.error('OUTER ERROR:', e));
