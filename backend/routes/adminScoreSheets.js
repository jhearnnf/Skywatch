const router = require('express').Router();
const mongoose = require('mongoose');
const { protect, adminOnly } = require('../middleware/auth');
const User = require('../models/User');
const CbatScoreSheet = require('../models/CbatScoreSheet');
const { extractScoreSheet, cleanBattery, cleanDate } = require('../utils/cbatScoreSheetExtract');

// Real score sheets read into data (see models/CbatScoreSheet.js). An admin asks for a photo to be
// read, checks the result against the photo, corrects it and confirms it. Nothing here runs on its
// own: every model call is one admin press on one image.

router.use(protect, adminOnly);

const isId = (v) => mongoose.isValidObjectId(v);

// GET / — every confirmed sheet, newest test first. The data the rest of the app (or a script) reads.
router.get('/', async (req, res) => {
  try {
    const status = ['extracted', 'confirmed', 'rejected'].includes(req.query.status) ? req.query.status : 'confirmed';
    const sheets = await CbatScoreSheet.find({ status }).sort({ testDate: -1, createdAt: -1 }).lean();
    res.json({ status: 'success', data: { sheets } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /user/:userId — the sheet read from each of one person's images, keyed by imageId, for the
// viewer that shows the photo beside its numbers.
router.get('/user/:userId', async (req, res) => {
  try {
    if (!isId(req.params.userId)) return res.status(400).json({ message: 'Bad user id' });
    const sheets = await CbatScoreSheet.find({ userId: req.params.userId }).lean();
    res.json({ status: 'success', data: { sheets } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /extract { userId, imageId } — read one photo. Re-reading replaces a draft; a confirmed
// sheet is only replaced when `force` is sent, so a checked transcription is never lost by a stray
// click.
router.post('/extract', async (req, res) => {
  try {
    const { userId, imageId, force } = req.body ?? {};
    if (!isId(userId) || !isId(imageId)) return res.status(400).json({ message: 'userId and imageId are required' });

    const user = await User.findById(userId).select('cbatResultImages');
    const image = user?.cbatResultImages?.id(imageId);
    if (!image) return res.status(404).json({ message: 'Image not found' });

    const existing = await CbatScoreSheet.findOne({ imageId });
    if (existing?.status === 'confirmed' && !force) {
      return res.status(409).json({ message: 'This sheet is already confirmed. Re-read it anyway to replace the checked numbers.' });
    }

    const read = await extractScoreSheet(image.url);
    const fields = {
      userId,
      imageId,
      status: read.isScoreSheet ? 'extracted' : 'rejected',
      testDate: read.testDate,
      board: read.board,
      batteries: read.batteries,
      model: read.model,
      extractedAt: new Date(),
      confirmedAt: null,
      confirmedBy: null,
    };
    const sheet = await CbatScoreSheet.findOneAndUpdate({ imageId }, { $set: fields }, { upsert: true, returnDocument: 'after' });
    res.json({ status: 'success', data: { sheet } });
  } catch (err) {
    res.status(502).json({ message: err.message });
  }
});

// PATCH /:id — an admin's corrections and verdict. Fields run through the same cleaning as the
// model's output, so a hand edit can never store something a read could not.
router.patch('/:id', async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ message: 'Bad id' });
    const body = req.body ?? {};
    const set = {};
    if (Array.isArray(body.batteries)) set.batteries = body.batteries.map(cleanBattery);
    if ('testDate' in body) set.testDate = cleanDate(body.testDate);
    if ('board' in body) set.board = typeof body.board === 'string' && body.board.trim() ? body.board.trim().slice(0, 20) : null;
    if ('notes' in body) set.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;
    if ('status' in body) {
      if (!['extracted', 'confirmed', 'rejected'].includes(body.status)) return res.status(400).json({ message: 'Bad status' });
      set.status = body.status;
      set.confirmedAt = body.status === 'confirmed' ? new Date() : null;
      set.confirmedBy = body.status === 'confirmed' ? req.user._id : null;
    }
    const sheet = await CbatScoreSheet.findByIdAndUpdate(req.params.id, { $set: set }, { returnDocument: 'after' });
    if (!sheet) return res.status(404).json({ message: 'Sheet not found' });
    res.json({ status: 'success', data: { sheet } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
