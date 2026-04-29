const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const mongoose = require('mongoose');
const { protect, adminOnly } = require('../middleware/auth');
const SocialAccount = require('../models/SocialAccount');
const SocialPost    = require('../models/SocialPost');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const Media = require('../models/Media');
const { encrypt, decrypt, isConfigured: encryptionConfigured } = require('../utils/socialEncryption');
const xClient = require('../utils/xClient');
const { fetchRecentCommits } = require('../utils/githubCommits');
const { generateDraft, POST_TYPES } = require('../utils/socialDraftGenerator');
const { callOpenRouter, withFeature } = require('../utils/openRouter');

const OAUTH_COOKIE = 'x_oauth_state';
const OAUTH_COOKIE_TTL_SEC = 10 * 60;
const REFRESH_BUFFER_SEC = 60;

router.use(protect, adminOnly);

// ─── helpers ─────────────────────────────────────────────────────────────────

function configErrors() {
  const errs = [];
  if (!process.env.X_CLIENT_ID)     errs.push('X_CLIENT_ID');
  if (!process.env.X_CLIENT_SECRET) errs.push('X_CLIENT_SECRET');
  if (!process.env.X_REDIRECT_URI)  errs.push('X_REDIRECT_URI');
  if (!encryptionConfigured())      errs.push('SOCIAL_TOKEN_KEY');
  return errs;
}

async function loadOrThrowAccount() {
  const acct = await SocialAccount.findOne({ platform: 'x' });
  if (!acct) {
    const err = new Error('X account not connected');
    err.status = 400;
    throw err;
  }
  return acct;
}

async function getValidAccessToken(acct) {
  const now = Date.now();
  const expiresMs = new Date(acct.expiresAt).getTime();
  if (expiresMs - now > REFRESH_BUFFER_SEC * 1000) {
    return decrypt(acct.accessTokenEncrypted);
  }
  // Refresh.
  const refreshed = await xClient.refreshAccessToken({
    clientId:     process.env.X_CLIENT_ID,
    clientSecret: process.env.X_CLIENT_SECRET,
    refreshToken: decrypt(acct.refreshTokenEncrypted),
  });
  acct.accessTokenEncrypted  = encrypt(refreshed.access_token);
  if (refreshed.refresh_token) acct.refreshTokenEncrypted = encrypt(refreshed.refresh_token);
  acct.expiresAt = new Date(Date.now() + (refreshed.expires_in || 7200) * 1000);
  if (refreshed.scope) acct.scopes = refreshed.scope.split(' ');
  await acct.save();
  return refreshed.access_token;
}

function selectBriefImageUrl(brief) {
  if (!brief?.media?.length) return null;
  for (const m of brief.media) {
    if (!m?.mediaUrl) continue;
    if (m.mediaUrl.startsWith('/')) continue; // skip local placeholder
    return m.mediaUrl;
  }
  return null;
}

// ─── connection management ──────────────────────────────────────────────────

router.get('/x/connect', (req, res, next) => {
  try {
    const errs = configErrors();
    if (errs.length) {
      return res.status(503).json({ status: 'error', message: `X social posting not configured: missing ${errs.join(', ')}` });
    }
    const { verifier, challenge } = xClient.generatePkce();
    const state = xClient.generateState();
    const token = jwt.sign({ state, verifier }, process.env.JWT_SECRET, { expiresIn: OAUTH_COOKIE_TTL_SEC });
    res.cookie(OAUTH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: OAUTH_COOKIE_TTL_SEC * 1000,
    });
    const authorizeUrl = xClient.buildAuthorizeUrl({
      clientId:      process.env.X_CLIENT_ID,
      redirectUri:   process.env.X_REDIRECT_URI,
      state,
      codeChallenge: challenge,
    });
    res.json({ authorizeUrl });
  } catch (err) { next(err); }
});

router.get('/x/callback', async (req, res, next) => {
  try {
    const { code, state, error: oauthErr } = req.query;
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    if (oauthErr) {
      return res.redirect(`${clientUrl}/admin?socialX=denied&reason=${encodeURIComponent(String(oauthErr))}`);
    }
    if (!code || !state) {
      return res.redirect(`${clientUrl}/admin?socialX=invalid`);
    }
    const cookie = req.cookies?.[OAUTH_COOKIE];
    if (!cookie) {
      return res.redirect(`${clientUrl}/admin?socialX=expired`);
    }
    let payload;
    try { payload = jwt.verify(cookie, process.env.JWT_SECRET); }
    catch { return res.redirect(`${clientUrl}/admin?socialX=expired`); }
    if (payload.state !== state) {
      return res.redirect(`${clientUrl}/admin?socialX=state-mismatch`);
    }

    const tokens = await xClient.exchangeCode({
      clientId:     process.env.X_CLIENT_ID,
      clientSecret: process.env.X_CLIENT_SECRET,
      code:         String(code),
      redirectUri:  process.env.X_REDIRECT_URI,
      codeVerifier: payload.verifier,
    });

    // Fetch the connected user so we can show the handle in the admin UI.
    let me = {};
    try { me = await xClient.getMe({ accessToken: tokens.access_token }); } catch { /* non-fatal */ }

    await SocialAccount.findOneAndUpdate(
      { platform: 'x' },
      {
        platform: 'x',
        externalUserId: me.id || null,
        username:       me.username || null,
        accessTokenEncrypted:  encrypt(tokens.access_token),
        refreshTokenEncrypted: encrypt(tokens.refresh_token || ''),
        expiresAt: new Date(Date.now() + (tokens.expires_in || 7200) * 1000),
        scopes: (tokens.scope || '').split(' ').filter(Boolean),
        connectedAt: new Date(),
        connectedBy: req.user._id,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.clearCookie(OAUTH_COOKIE);
    res.redirect(`${clientUrl}/admin?socialX=connected`);
  } catch (err) {
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    res.redirect(`${clientUrl}/admin?socialX=error&reason=${encodeURIComponent(err.message.slice(0, 80))}`);
  }
});

router.delete('/x/disconnect', async (_req, res, next) => {
  try {
    await SocialAccount.deleteOne({ platform: 'x' });
    res.json({ status: 'ok' });
  } catch (err) { next(err); }
});

router.get('/x/status', async (_req, res, next) => {
  try {
    const errs = configErrors();
    const acct = await SocialAccount.findOne({ platform: 'x' });
    res.json({
      configured: errs.length === 0,
      missing:    errs,
      connected:  !!acct,
      username:   acct?.username || null,
      expiresAt:  acct?.expiresAt || null,
      connectedAt: acct?.connectedAt || null,
      scopes:     acct?.scopes || [],
    });
  } catch (err) { next(err); }
});

// ─── source pickers ─────────────────────────────────────────────────────────

router.get('/briefs-for-recon', async (_req, res, next) => {
  try {
    const briefs = await IntelligenceBrief.find({ status: 'published' })
      .select('_id title category subcategory dateAdded eventDate media')
      .populate({ path: 'media', select: 'mediaUrl name' })
      .sort({ dateAdded: -1 })
      .limit(200)
      .lean();
    res.json({ data: briefs });
  } catch (err) { next(err); }
});

router.get('/latest-news-brief', async (_req, res, next) => {
  try {
    const brief = await IntelligenceBrief.findOne({ status: 'published', category: 'News' })
      .sort({ dateAdded: -1 })
      .populate({ path: 'media', select: 'mediaUrl name' })
      .lean();
    if (!brief) return res.json({ data: null });
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const isFresh = brief.dateAdded && new Date(brief.dateAdded) >= startOfToday;
    res.json({ data: { ...brief, isFreshToday: isFresh } });
  } catch (err) { next(err); }
});

// ─── draft + publish ────────────────────────────────────────────────────────

router.post('/x/draft', async (req, res, next) => {
  try {
    const { postType, tone = 7, briefId, variantIndex } = req.body || {};
    if (!POST_TYPES.includes(postType)) {
      return res.status(400).json({ status: 'error', message: `postType must be one of: ${POST_TYPES.join(', ')}` });
    }
    const toneNum = Number(tone);
    if (!Number.isFinite(toneNum) || toneNum < 1 || toneNum > 10) {
      return res.status(400).json({ status: 'error', message: 'tone must be an integer between 1 and 10' });
    }

    // variantIndex is optional. When supplied, must be 0/1/2 — those are the
    // three carousel cards; out-of-range yields a 400 rather than silently
    // falling back to the no-nudge prompt (would mask UI/backend drift).
    let v = null;
    if (variantIndex !== undefined && variantIndex !== null) {
      const n = Number(variantIndex);
      if (!Number.isInteger(n) || n < 0 || n > 2) {
        return res.status(400).json({ status: 'error', message: 'variantIndex must be 0, 1, or 2' });
      }
      v = n;
    }

    let brief = null;
    if (postType === 'daily-recon' || postType === 'latest-intel') {
      if (!briefId || !mongoose.Types.ObjectId.isValid(briefId)) {
        return res.status(400).json({ status: 'error', message: 'briefId required for this postType' });
      }
      brief = await IntelligenceBrief.findById(briefId).populate({ path: 'media', select: 'mediaUrl' }).lean();
      if (!brief) return res.status(404).json({ status: 'error', message: 'brief not found' });
    }

    const openRouterChat = (body) => callOpenRouter({ key: 'socials', feature: 'social-draft-x', body });
    const fetchCommits   = () => fetchRecentCommits({});

    const out = await withFeature('social-draft-x', () => generateDraft({
      postType,
      tone: toneNum,
      brief,
      openRouterChat,
      fetchCommits,
      variantIndex: v,
    }));

    res.json({
      data: {
        text:       out.text,
        poll:       out.poll || null,
        sourceMeta: out.sourceMeta,
        suggestedImageUrl: brief ? selectBriefImageUrl(brief) : null,
        briefName:  brief?.title || null,
        variantIndex: v,
      },
    });
  } catch (err) { next(err); }
});

router.post('/x/publish', async (req, res, next) => {
  try {
    const { postType, tone, briefId, finalText, imageUrl, poll, sourceMeta, draftText } = req.body || {};
    if (!POST_TYPES.includes(postType)) {
      return res.status(400).json({ status: 'error', message: `invalid postType` });
    }
    const t = Number(tone);
    if (!Number.isFinite(t) || t < 1 || t > 10) {
      return res.status(400).json({ status: 'error', message: 'tone must be 1–10' });
    }
    const text = String(finalText || '').trim();
    if (!text) return res.status(400).json({ status: 'error', message: 'finalText required' });
    if (text.length > 280) return res.status(400).json({ status: 'error', message: 'finalText exceeds 280 chars' });

    // Polls are daily-recon only, and X disallows poll + media on the same tweet.
    let normalizedPoll = null;
    if (poll) {
      if (postType !== 'daily-recon') {
        return res.status(400).json({ status: 'error', message: 'poll only allowed on daily-recon posts' });
      }
      if (imageUrl) {
        return res.status(400).json({ status: 'error', message: 'X does not allow poll and image on the same tweet' });
      }
      const opts = Array.isArray(poll.options)
        ? poll.options.map(o => String(o || '').trim()).filter(Boolean)
        : [];
      if (opts.length < 2 || opts.length > 4) {
        return res.status(400).json({ status: 'error', message: 'poll requires 2–4 options' });
      }
      if (opts.some(o => o.length > 25)) {
        return res.status(400).json({ status: 'error', message: 'each poll option must be ≤25 chars' });
      }
      const dur = Number(poll.duration_minutes) || 1440;
      if (dur < 5 || dur > 10080) {
        return res.status(400).json({ status: 'error', message: 'poll duration must be 5–10080 minutes' });
      }
      normalizedPoll = { options: opts, duration_minutes: dur };
    }

    const acct = await loadOrThrowAccount();
    const accessToken = await getValidAccessToken(acct);

    let mediaIds = [];
    if (imageUrl) {
      const fetched = await fetch(imageUrl);
      if (!fetched.ok) {
        return res.status(400).json({ status: 'error', message: `imageUrl fetch failed: ${fetched.status}` });
      }
      const buf  = Buffer.from(await fetched.arrayBuffer());
      const mime = fetched.headers.get('content-type') || 'image/jpeg';
      const id   = await xClient.uploadMedia({ accessToken, buffer: buf, mimeType: mime });
      if (id) mediaIds.push(id);
    }

    let externalPostId = null;
    let externalPostUrl = null;
    let status = 'failed';
    let errorMsg = null;
    try {
      const result = await xClient.postTweet({ accessToken, text, mediaIds, poll: normalizedPoll });
      externalPostId  = result.id || null;
      externalPostUrl = (acct.username && externalPostId)
        ? `https://x.com/${acct.username}/status/${externalPostId}`
        : null;
      status = 'posted';
    } catch (postErr) {
      errorMsg = postErr.message;
    }

    const persisted = await SocialPost.create({
      platform: 'x',
      postType,
      tone: t,
      briefId: briefId && mongoose.Types.ObjectId.isValid(briefId) ? briefId : null,
      sourceMeta: sourceMeta || {},
      draftText: String(draftText || text),
      finalText: text,
      includedImageUrl: imageUrl || null,
      poll: normalizedPoll,
      status,
      externalPostId,
      externalPostUrl,
      error: errorMsg,
      createdBy: req.user._id,
      postedAt: status === 'posted' ? new Date() : null,
    });

    if (status !== 'posted') {
      return res.status(502).json({ status: 'error', message: errorMsg, data: persisted });
    }
    res.json({ status: 'ok', data: persisted });
  } catch (err) { next(err); }
});

router.get('/posts', async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const posts = await SocialPost.find({ platform: 'x' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate({ path: 'briefId', select: 'title' })
      .populate({ path: 'createdBy', select: 'name' })
      .lean();
    res.json({ data: posts });
  } catch (err) { next(err); }
});

// Toggle whether a post has been removed from the platform. We never hard-
// delete the SocialPost row — it's the audit trail of what was published.
// Body: { deleted: boolean }. Idempotent.
router.patch('/posts/:id/deleted', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ status: 'error', message: 'invalid post id' });
    }
    const deleted = !!req.body?.deleted;
    const post = await SocialPost.findOneAndUpdate(
      { _id: id, platform: 'x' },
      { $set: { deletedAt: deleted ? new Date() : null } },
      { returnDocument: 'after' }
    )
      .populate({ path: 'briefId', select: 'title' })
      .populate({ path: 'createdBy', select: 'name' })
      .lean();
    if (!post) return res.status(404).json({ status: 'error', message: 'post not found' });
    res.json({ status: 'ok', data: post });
  } catch (err) { next(err); }
});

module.exports = router;
