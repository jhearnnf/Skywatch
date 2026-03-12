const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;

async function connect() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
}

async function closeDatabase() {
  if (mongoose.connection.readyState !== 1) {
    try { if (mongod) await mongod.stop(); } catch { /* ignore */ }
    return;
  }
  // Suppress any internal MongoDB driver errors during teardown
  mongoose.connection.on('error', () => {});
  try { await mongoose.connection.dropDatabase(); } catch { /* ignore */ }
  await new Promise(resolve => {
    mongoose.connection.close().then(resolve).catch(resolve);
  });
  try { if (mongod) await mongod.stop(); } catch { /* ignore */ }
}

async function clearDatabase() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

module.exports = { connect, closeDatabase, clearDatabase };
