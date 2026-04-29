'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const reverseCaseFileAirstars = require('../migrations/reverseCaseFileAirstars');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const summary = await reverseCaseFileAirstars();
  console.log('Reversal summary:', summary);

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
