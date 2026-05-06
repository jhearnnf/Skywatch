/**
 * Backend mirror of src/data/aircraftModels.js. The frontend reads
 * public/models/*.glb via a Vite virtual module at build time; here we read
 * the same directory at process start, since the backend has filesystem
 * access. has3DModel(briefId, title) lets backend endpoints filter to
 * aircraft that have a 3D model — used by DPT and any future game that
 * needs a consistent 3D-enabled aircraft pool.
 *
 * If you add new GLBs to public/models/, restart the server.
 */

const fs   = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', '..', 'public', 'models');

let AVAILABLE_MODELS = new Set();
try {
  const files = fs.readdirSync(MODELS_DIR);
  AVAILABLE_MODELS = new Set(
    files
      .filter(f => /\.glb$/i.test(f))
      .map(f => f.replace(/\.glb$/i, '').toLowerCase())
  );
} catch (err) {
  console.warn(`[aircraftModels] could not read ${MODELS_DIR}: ${err.message}`);
}

// Maps briefId -> filename in public/models/. Mirror of MODEL_MAP in
// src/data/aircraftModels.js. Keep in sync when adding overrides.
const MODEL_MAP = {};

function titleToSlug(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9\-]+/g, ' ').trim();
}

function has3DModel(briefId, title) {
  if (briefId && MODEL_MAP[String(briefId)]) return true;
  return AVAILABLE_MODELS.has(titleToSlug(title));
}

module.exports = { has3DModel, titleToSlug };
