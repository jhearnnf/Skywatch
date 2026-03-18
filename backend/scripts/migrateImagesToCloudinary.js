/**
 * One-off migration: upload all local brief images to Cloudinary
 * and update the Media documents with the new URL + publicId.
 *
 * Usage:
 *   cd backend
 *   node scripts/migrateImagesToCloudinary.js
 *
 * After a clean run with 0 failures:
 *   - Remove the '/uploads' static middleware from app.js
 *   - Delete the backend/uploads/ folder
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');
const Media    = require('../models/Media');
const { uploadBuffer, } = require('../utils/cloudinary');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'brief-images');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const docs = await Media.find({ mediaUrl: /^\/uploads\/brief-images\// });
  console.log(`Found ${docs.length} local image(s) to migrate`);

  let success = 0;
  let failed  = 0;

  for (const doc of docs) {
    const filename = path.basename(doc.mediaUrl);
    const filePath = path.join(UPLOADS_DIR, filename);

    try {
      const buffer = fs.readFileSync(filePath);
      const publicId = `brief-images/${path.parse(filename).name}`;
      const result = await uploadBuffer(buffer, { public_id: publicId, overwrite: false });

      doc.mediaUrl           = result.secure_url;
      doc.cloudinaryPublicId = result.public_id;
      await doc.save();

      console.log(`  ✓ ${filename} → ${result.secure_url}`);
      success++;
    } catch (err) {
      console.error(`  ✗ ${filename}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} migrated, ${failed} failed.`);
  if (failed === 0) {
    console.log('All images migrated. You can now remove the /uploads static middleware from app.js and delete backend/uploads/.');
  } else {
    console.log('Some files failed. Re-run after fixing the issues above.');
  }

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
