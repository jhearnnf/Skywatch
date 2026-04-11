/**
 * dedupeMedia.js
 *
 * Deduplicate Cloudinary-hosted brief images by content hash (etag).
 *
 * Why: early brief generation didn't reuse existing Media, so the same
 * Wikipedia file was uploaded multiple times under different public_ids.
 * Since recent changes we dedupe by Wikipedia title on new generations,
 * but the historical duplicates are still in Cloudinary and Mongo.
 *
 * Strategy (Cloudinary-first):
 *   1. Walk every asset under the brief-images folder via the Admin API.
 *   2. Group by Cloudinary `etag` (MD5 of the uploaded bytes). Any group
 *      of >1 public_id is a byte-for-byte duplicate set.
 *   3. Resolve each public_id to its Media doc via cloudinaryPublicId.
 *   4. Pick a keeper per group using:
 *        (a) has cutoutUrl populated
 *        (b) referenced by an Aircrafts-category brief
 *        (c) most brief references
 *        (d) oldest createdAt
 *      If the keeper lacks a cutout but a dupe has one, transfer it.
 *   5. Rewrite every IntelligenceBrief.media reference from dupe → keeper,
 *      de-duplicating the array in place (order-preserving).
 *   6. Delete the dupe Media docs. With --cloudinary, also destroy the
 *      dupe assets in Cloudinary (skipping any cutoutPublicId that was
 *      transferred to the keeper).
 *
 * Usage:
 *   node backend/scripts/dedupeMedia.js                 # dry-run, DB-only preview
 *   node backend/scripts/dedupeMedia.js --apply         # write DB changes
 *   node backend/scripts/dedupeMedia.js --apply --cloudinary
 *                                                       # also destroy Cloudinary assets
 *
 * Dry-run is always safe: it never writes to Mongo or calls Cloudinary
 * destroy. It does hit the Cloudinary Admin API for listing.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;

const Media            = require('../models/Media');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const { destroyAsset } = require('../utils/cloudinary');

const args = process.argv.slice(2);
const APPLY      = args.includes('--apply');
const CLOUDINARY = args.includes('--cloudinary');
const ORPHANS    = args.includes('--orphans');
const PREFIX     = 'brief-images';

const label = APPLY ? 'APPLY' : 'DRY-RUN';

function arrayEquals(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (String(a[i]) !== String(b[i])) return false;
  }
  return true;
}

async function listAllCloudinaryAssets() {
  // Use the Search API — unlike api.resources(), it returns `etag` on each row.
  const assets = [];
  let nextCursor = undefined;
  let pages = 0;
  do {
    const query = cloudinary.search
      .expression(`folder:${PREFIX}/* AND resource_type:image`)
      .max_results(500)
      .with_field('tags');
    if (nextCursor) query.next_cursor(nextCursor);
    const res = await query.execute();
    for (const r of res.resources) {
      assets.push({
        public_id: r.public_id,
        etag: r.etag,
        bytes: r.bytes,
        created_at: r.created_at,
      });
    }
    nextCursor = res.next_cursor;
    pages++;
  } while (nextCursor);
  console.log(`Cloudinary: listed ${assets.length} asset(s) under "${PREFIX}/" (${pages} page[s])`);
  return assets;
}

function groupByEtag(assets) {
  const byEtag = new Map();
  let skippedNoEtag = 0;
  for (const a of assets) {
    if (!a.etag) { skippedNoEtag++; continue; }
    if (!byEtag.has(a.etag)) byEtag.set(a.etag, []);
    byEtag.get(a.etag).push(a);
  }
  if (skippedNoEtag) {
    console.warn(`Warning: ${skippedNoEtag} asset(s) had no etag and were skipped`);
  }
  const dupeGroups = [];
  for (const [etag, group] of byEtag) {
    if (group.length > 1) dupeGroups.push({ etag, assets: group });
  }
  return dupeGroups;
}

async function resolveGroupsToMedia(dupeGroups) {
  const allPublicIds = dupeGroups.flatMap(g => g.assets.map(a => a.public_id));
  const mediaDocs = await Media.find({ cloudinaryPublicId: { $in: allPublicIds } }).lean();
  const mediaByPublicId = new Map(mediaDocs.map(m => [m.cloudinaryPublicId, m]));

  const resolved = [];
  let assetsWithoutMedia = 0;
  for (const group of dupeGroups) {
    const mediaGroup = [];
    for (const asset of group.assets) {
      const media = mediaByPublicId.get(asset.public_id);
      if (media) {
        mediaGroup.push({ asset, media });
      } else {
        assetsWithoutMedia++;
      }
    }
    if (mediaGroup.length >= 2) {
      resolved.push({ etag: group.etag, members: mediaGroup });
    }
  }
  if (assetsWithoutMedia) {
    console.warn(`Warning: ${assetsWithoutMedia} Cloudinary asset(s) in dupe groups had no matching Media doc (orphan uploads, ignored)`);
  }
  return resolved;
}

async function countBriefReferences(mediaIds) {
  const counts = await IntelligenceBrief.aggregate([
    { $match: { media: { $in: mediaIds } } },
    { $unwind: '$media' },
    { $match: { media: { $in: mediaIds } } },
    { $group: { _id: '$media', count: { $sum: 1 } } },
  ]);
  const map = new Map();
  for (const c of counts) map.set(String(c._id), c.count);
  return map;
}

async function aircraftBriefMediaIds(mediaIds) {
  const briefs = await IntelligenceBrief.find(
    { category: 'Aircrafts', media: { $in: mediaIds } },
    { media: 1 }
  ).lean();
  const set = new Set();
  for (const b of briefs) {
    for (const m of b.media) {
      const s = String(m);
      if (mediaIds.some(id => String(id) === s)) set.add(s);
    }
  }
  return set;
}

function pickKeeper(members, { refCounts, aircraftIds }) {
  const scored = members.map(({ media }) => {
    const idStr = String(media._id);
    return {
      media,
      hasCutout: Boolean(media.cutoutUrl),
      isAircraft: aircraftIds.has(idStr),
      refs: refCounts.get(idStr) || 0,
      createdAt: media.createdAt ? new Date(media.createdAt).getTime() : Infinity,
    };
  });

  scored.sort((a, b) => {
    if (a.hasCutout !== b.hasCutout) return a.hasCutout ? -1 : 1;
    if (a.isAircraft !== b.isAircraft) return a.isAircraft ? -1 : 1;
    if (a.refs !== b.refs) return b.refs - a.refs;
    return a.createdAt - b.createdAt;
  });

  return scored[0].media;
}

async function transferCutout(keeper, members) {
  if (keeper.cutoutUrl) return { transferred: false };
  const donor = members.find(({ media }) =>
    String(media._id) !== String(keeper._id) && media.cutoutUrl
  );
  if (!donor) return { transferred: false };

  if (APPLY) {
    await Media.updateOne(
      { _id: keeper._id },
      { $set: { cutoutUrl: donor.media.cutoutUrl, cutoutPublicId: donor.media.cutoutPublicId } }
    );
  }
  keeper.cutoutUrl      = donor.media.cutoutUrl;
  keeper.cutoutPublicId = donor.media.cutoutPublicId;

  return { transferred: true, fromMediaId: String(donor.media._id), preservedPublicId: donor.media.cutoutPublicId };
}

async function rewriteBriefReferences(dupeToKeeper) {
  const dupeIds = Array.from(dupeToKeeper.keys()).map(id => new mongoose.Types.ObjectId(id));
  const briefs = await IntelligenceBrief.find(
    { media: { $in: dupeIds } },
    { media: 1 }
  ).lean();

  let updated = 0;
  for (const brief of briefs) {
    const seen = new Set();
    const next = [];
    for (const m of brief.media) {
      const idStr = String(m);
      const replacement = dupeToKeeper.get(idStr) || idStr;
      if (seen.has(replacement)) continue;
      seen.add(replacement);
      next.push(new mongoose.Types.ObjectId(replacement));
    }
    const original = brief.media.map(m => new mongoose.Types.ObjectId(String(m)));
    if (arrayEquals(original, next)) continue;
    updated++;
    if (APPLY) {
      await IntelligenceBrief.updateOne({ _id: brief._id }, { $set: { media: next } });
    }
  }
  return { briefsScanned: briefs.length, briefsUpdated: updated };
}

async function orphanSweep(assets, alreadyDestroyed) {
  console.log('\n--- Orphan sweep ---');

  const allMediaDocs = await Media.find({}, {
    cloudinaryPublicId: 1,
    cutoutPublicId: 1,
    mediaUrl: 1,
  }).lean();

  const knownPublicIds = new Set();
  for (const m of allMediaDocs) {
    if (m.cloudinaryPublicId) knownPublicIds.add(m.cloudinaryPublicId);
    if (m.cutoutPublicId)     knownPublicIds.add(m.cutoutPublicId);
  }

  const referencedMediaIds = await IntelligenceBrief.distinct('media');
  const referencedSet = new Set(referencedMediaIds.map(id => String(id)));

  const orphanMedia = allMediaDocs.filter(m =>
    !referencedSet.has(String(m._id)) &&
    m.mediaUrl !== Media.PLACEHOLDER_URL
  );

  const orphanMediaPublicIds = new Set();
  for (const m of orphanMedia) {
    if (m.cloudinaryPublicId) orphanMediaPublicIds.add(m.cloudinaryPublicId);
    if (m.cutoutPublicId)     orphanMediaPublicIds.add(m.cutoutPublicId);
  }

  // Cloudinary assets with no Media doc referencing them. Exclude ones we just
  // destroyed in the dedupe pass so we don't re-report them.
  const cloudinaryOnlyOrphans = assets
    .map(a => a.public_id)
    .filter(pid => !knownPublicIds.has(pid) && !alreadyDestroyed.has(pid));

  const toDestroy = new Set([...orphanMediaPublicIds, ...cloudinaryOnlyOrphans]);
  for (const pid of alreadyDestroyed) toDestroy.delete(pid);

  console.log(`Orphan Media docs (no brief refs): ${orphanMedia.length}`);
  console.log(`Orphan Cloudinary assets (no Media doc): ${cloudinaryOnlyOrphans.length}`);
  console.log(`Total Cloudinary assets to destroy: ${toDestroy.size}`);

  if (!APPLY) {
    console.log('(dry-run — nothing deleted)');
    return;
  }

  if (orphanMedia.length) {
    await Media.deleteMany({ _id: { $in: orphanMedia.map(m => m._id) } });
    console.log(`Deleted ${orphanMedia.length} orphan Media doc(s)`);
  }

  if (!CLOUDINARY) {
    console.log(`(pass --cloudinary to destroy ${toDestroy.size} Cloudinary asset[s])`);
    return;
  }

  let destroyed = 0;
  let failed    = 0;
  for (const publicId of toDestroy) {
    try {
      await destroyAsset(publicId);
      destroyed++;
    } catch (err) {
      console.warn(`  ! destroy failed for ${publicId}: ${err.message}`);
      failed++;
    }
  }
  console.log(`Destroyed ${destroyed} Cloudinary asset(s) (${failed} failed)`);
}

async function run() {
  console.log(`\n=== dedupeMedia [${label}${CLOUDINARY ? ' +cloudinary' : ''}${ORPHANS ? ' +orphans' : ''}] ===\n`);

  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('CLOUDINARY_* env vars missing — cannot list assets');
  }
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const assets = await listAllCloudinaryAssets();
  const dupeGroups = groupByEtag(assets);
  console.log(`Dupe groups by etag: ${dupeGroups.length}`);

  const destroyedInDedupe = new Set();

  if (!dupeGroups.length) {
    console.log('Nothing to dedupe.');
    if (ORPHANS) await orphanSweep(assets, destroyedInDedupe);
    await mongoose.disconnect();
    return;
  }

  const groups = await resolveGroupsToMedia(dupeGroups);
  console.log(`Dupe groups with ≥2 Media docs: ${groups.length}\n`);

  if (!groups.length) {
    console.log('No actionable dedupe groups.');
    if (ORPHANS) await orphanSweep(assets, destroyedInDedupe);
    await mongoose.disconnect();
    return;
  }

  const allMediaIds = groups.flatMap(g => g.members.map(m => m.media._id));
  const [refCounts, aircraftIds] = await Promise.all([
    countBriefReferences(allMediaIds),
    aircraftBriefMediaIds(allMediaIds),
  ]);

  const dupeToKeeper = new Map();
  const mediaToDelete = [];
  const cloudinaryPublicIdsToDestroy = [];
  const preservedCutoutPublicIds = new Set();

  let groupsWithCutout        = 0;
  let cutoutTransfers         = 0;
  let aircraftKeepers         = 0;

  for (const group of groups) {
    const keeper = pickKeeper(group.members, { refCounts, aircraftIds });
    if (group.members.some(m => m.media.cutoutUrl)) groupsWithCutout++;
    if (aircraftIds.has(String(keeper._id))) aircraftKeepers++;

    const { transferred, preservedPublicId } = await transferCutout(keeper, group.members);
    if (transferred) {
      cutoutTransfers++;
      if (preservedPublicId) preservedCutoutPublicIds.add(preservedPublicId);
    }

    for (const { media } of group.members) {
      if (String(media._id) === String(keeper._id)) continue;
      dupeToKeeper.set(String(media._id), String(keeper._id));
      mediaToDelete.push(media._id);
      if (media.cloudinaryPublicId) {
        cloudinaryPublicIdsToDestroy.push(media.cloudinaryPublicId);
      }
      if (media.cutoutPublicId && !preservedCutoutPublicIds.has(media.cutoutPublicId)) {
        cloudinaryPublicIdsToDestroy.push(media.cutoutPublicId);
      }
    }
  }

  const { briefsScanned, briefsUpdated } = await rewriteBriefReferences(dupeToKeeper);

  if (APPLY && mediaToDelete.length) {
    await Media.deleteMany({ _id: { $in: mediaToDelete } });
  }

  let cloudinaryDestroyed = 0;
  let cloudinaryFailed    = 0;
  if (APPLY && CLOUDINARY) {
    for (const publicId of cloudinaryPublicIdsToDestroy) {
      try {
        await destroyAsset(publicId);
        cloudinaryDestroyed++;
        destroyedInDedupe.add(publicId);
      } catch (err) {
        console.warn(`  ! destroy failed for ${publicId}: ${err.message}`);
        cloudinaryFailed++;
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Mode:                        ${label}${CLOUDINARY ? ' +cloudinary' : ''}`);
  console.log(`Dupe groups processed:       ${groups.length}`);
  console.log(`  with a cutout present:     ${groupsWithCutout}`);
  console.log(`  keeper is aircraft media:  ${aircraftKeepers}`);
  console.log(`  cutout transferred:        ${cutoutTransfers}`);
  console.log(`Dupe Media docs removed:     ${mediaToDelete.length}${APPLY ? '' : ' (would remove)'}`);
  console.log(`Briefs scanned for rewrite:  ${briefsScanned}`);
  console.log(`Briefs rewritten:            ${briefsUpdated}${APPLY ? '' : ' (would rewrite)'}`);
  console.log(`Cloudinary assets planned:   ${cloudinaryPublicIdsToDestroy.length}`);
  if (APPLY && CLOUDINARY) {
    console.log(`  destroyed:                 ${cloudinaryDestroyed}`);
    console.log(`  failed:                    ${cloudinaryFailed}`);
  } else {
    console.log('  (pass --apply --cloudinary to destroy them)');
  }
  console.log('');

  if (ORPHANS) await orphanSweep(assets, destroyedInDedupe);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
