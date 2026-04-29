'use strict';

/**
 * seedCaseFiles()
 *
 * Reads the russia-ukraine/road-to-invasion chapter JSON, validates it parses,
 * then upserts the case-file catalogue entries and the chapter document.
 *
 * Pattern: mirrors seedGameTypes() in server.js — findOneAndUpdate with $set / $setOnInsert.
 */

const fs   = require('fs');
const path = require('path');

const GameCaseFile        = require('../../models/GameCaseFile');
const GameCaseFileChapter = require('../../models/GameCaseFileChapter');

// ── Catalogue definitions ─────────────────────────────────────────────────────

const CASE_FILES = [
  {
    slug:        'russia-ukraine',
    title:       'Russia / Ukraine',
    affairLabel: 'Eastern Europe · Active Conflict',
    summary:     'Investigate the most consequential European conflict of the modern era. Build the picture, predict the play, watch it unfold.',
    status:      'published',
    tags:        ['Russia', 'Ukraine', 'NATO', 'OSINT'],
    chapterSlugs: ['road-to-invasion'],
    tiers:        ['admin', 'gold', 'silver', 'free'],
  },
  {
    slug:        'israel-iran',
    title:       'Israel / Iran',
    affairLabel: 'Middle East · Emerging Flashpoint',
    summary:     'Levant and Gulf tension shaping the operational environment. Coming soon.',
    status:      'locked',
    tags:        ['Israel', 'Iran', 'Hormuz', 'Proxy'],
    chapterSlugs: [],
    tiers:        ['admin', 'gold', 'silver'],
  },
];

// ── Chapter seeds (one per case file, keyed by caseSlug + chapterSlug) ────────

const CHAPTER_SEEDS = [
  {
    caseSlug:   'russia-ukraine',
    jsonPath:   path.join(__dirname, 'russia-ukraine', 'road-to-invasion.json'),
  },
];

// ── Seeder ────────────────────────────────────────────────────────────────────

async function seedCaseFiles() {
  // 1. Upsert case-file catalogue entries
  for (const cf of CASE_FILES) {
    await GameCaseFile.findOneAndUpdate(
      { slug: cf.slug },
      {
        $set: {
          title:       cf.title,
          affairLabel: cf.affairLabel,
          summary:     cf.summary,
          status:      cf.status,
          tags:        cf.tags,
          chapterSlugs: cf.chapterSlugs,
        },
        $setOnInsert: {
          // Tiers are admin-editable post-seed; only set on first insert so
          // an admin's later changes aren't overwritten on every server boot.
          tiers: cf.tiers,
        },
      },
      { upsert: true }
    );
  }

  // 2. Upsert chapters
  for (const seed of CHAPTER_SEEDS) {
    // Read + parse — trust the schema test to catch structural divergence
    const raw     = fs.readFileSync(seed.jsonPath, 'utf-8');
    const chapter = JSON.parse(raw); // throws on malformed JSON

    // Merge caseSlug into the document
    const doc = { ...chapter, caseSlug: seed.caseSlug };

    await GameCaseFileChapter.findOneAndUpdate(
      { caseSlug: doc.caseSlug, chapterSlug: doc.chapterSlug },
      { $set: doc },
      { upsert: true }
    );
  }

  console.log('Case files seeded');
}

module.exports = seedCaseFiles;
