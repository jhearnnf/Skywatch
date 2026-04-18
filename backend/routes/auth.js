const router      = require('express').Router();
const bcrypt      = require('bcryptjs');
const crypto      = require('crypto');
const jwt         = require('jsonwebtoken');
const User        = require('../models/User');
const Rank        = require('../models/Rank');
const PendingRegistration    = require('../models/PendingRegistration');
const PasswordResetToken     = require('../models/PasswordResetToken');
const PasswordResetRateLimit = require('../models/PasswordResetRateLimit');
const AppSettings = require('../models/AppSettings');
const AirstarLog  = require('../models/AirstarLog');
const { sendWelcomeEmail, sendConfirmationEmail, sendPasswordResetEmail } = require('../utils/email');
const { awardCoins }       = require('../utils/awardCoins');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns the ObjectId of the AC (Aircraftman) rank — assigned to every new user.
// Falls back to null gracefully if ranks haven't been seeded yet (e.g. test env).
const getAcRankId = async () => {
  const rank = await Rank.findOne({ rankNumber: 1 }).select('_id');
  return rank?._id ?? null;
};

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const sendToken = (user, statusCode, res, extras = {}) => {
  const token = signToken(user._id);
  const isProd = process.env.NODE_ENV === 'production'
  res.cookie('jwt', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
  user.password = undefined;
  // Token included in body so native apps (Capacitor) can store it for Bearer auth
  res.status(statusCode).json({ status: 'success', data: { user, token, ...extras } });
};

// Records a login timestamp. Coins are no longer awarded at login —
// the daily streak reward is given on the first brief read of each day instead.
const recordLogin = async (user) => {
  user.logins.push({ timestamp: new Date() });
  await user.save();
  return { earned: 0, label: '', rankPromotion: null };
};

// ── Email / Password ──────────────────────────────────────────────────────────

// POST /api/auth/register — validate and send confirmation code (does not create User yet)
// If emailConfirmationEnabled is false, skip verification and create the User immediately.
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
    if (password.length < 8)  return res.status(400).json({ message: 'Password must be at least 8 characters' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ message: 'Email already registered' });

    const settings = await AppSettings.getSettings();

    if (settings.emailConfirmationEnabled === false) {
      // Instant registration — no verification step
      const acRankId = await getAcRankId();
      const user = await User.create({ email: email.toLowerCase(), password, rank: acRankId });
      if (settings.betaTesterAutoGold) {
        user.subscriptionTier = 'gold';
        user.subscriptionStartDate = new Date();
        await user.save();
      }
      sendWelcomeEmail({ email: user.email, agentNumber: user.agentNumber });
      const { earned: loginCoins, label: loginLabel } = await recordLogin(user);
      return sendToken(user, 201, res, { isNew: true, loginAirstarsEarned: loginCoins, loginAirstarLabel: loginLabel });
    }

    const code      = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await PendingRegistration.findOneAndUpdate(
      { email: email.toLowerCase() },
      { email: email.toLowerCase(), password, code, expiresAt },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    await sendConfirmationEmail({ email: email.toLowerCase(), code });

    res.status(200).json({ status: 'pending', email: email.toLowerCase() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/verify-email — confirm code and create the User
router.post('/verify-email', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ message: 'Email and code required' });

    const pending = await PendingRegistration.findOne({ email: email.toLowerCase() });
    if (!pending)                         return res.status(400).json({ message: 'Code expired or not found. Please register again.' });
    if (new Date() > pending.expiresAt)   return res.status(400).json({ message: 'Code has expired. Please register again.' });
    if (pending.code !== String(code).trim()) return res.status(400).json({ message: 'Incorrect code. Please try again.' });

    const settings = await AppSettings.getSettings();
    const acRankId = await getAcRankId();
    const user = await User.create({ email: pending.email, password: pending.password, rank: acRankId });
    if (settings.betaTesterAutoGold) {
      user.subscriptionTier = 'gold';
      user.subscriptionStartDate = new Date();
      await user.save();
    }
    await PendingRegistration.deleteOne({ email: pending.email });

    sendWelcomeEmail({ email: user.email, agentNumber: user.agentNumber });
    const { earned: loginCoins, label: loginLabel } = await recordLogin(user);
    sendToken(user, 201, res, { isNew: true, loginAirstarsEarned: loginCoins, loginAirstarLabel: loginLabel });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/resend-confirmation — regenerate and resend the confirmation code
router.post('/resend-confirmation', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    const pending = await PendingRegistration.findOne({ email: email.toLowerCase() });
    if (!pending) return res.status(400).json({ message: 'No pending registration found. Please register again.' });

    pending.code      = String(Math.floor(100000 + Math.random() * 900000));
    pending.expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await pending.save();

    await sendConfirmationEmail({ email: pending.email, code: pending.code });

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user || !user.password) {
      // Account exists but is Google-only, or doesn't exist
      return res.status(401).json({ message: 'Incorrect email or password' });
    }
    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Incorrect email or password' });
    }
    if (user.isBanned) {
      return res.status(403).json({ message: 'Login failed. Please contact support.' });
    }

    const { earned: loginCoins, label: loginLabel } = await recordLogin(user);
    sendToken(user, 200, res, { loginAirstarsEarned: loginCoins, loginAirstarLabel: loginLabel });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Password Reset ────────────────────────────────────────────────────────────

// POST /api/auth/forgot-password — request a password reset link
// Always returns the same neutral 200 response; never reveals if an email exists.
// Google-only accounts (no stored password) are silently skipped.
// Rate limited to 2 requests per email per 24 hours.
router.post('/forgot-password', async (req, res) => {
  const NEUTRAL_MSG = 'If your account matches the email provided, a password reset link has been dispatched.';
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    // Check if password reset emails are enabled
    const settings = await AppSettings.getSettings();
    if (settings.emailPasswordResetEnabled === false) {
      return res.status(503).json({ message: 'Password reset is currently unavailable.', resetDisabled: true });
    }

    const normEmail = email.toLowerCase().trim();
    const window24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Rate limit check — prune old timestamps and count remaining
    const rateLimitDoc = await PasswordResetRateLimit.findOne({ email: normEmail });
    const recentCount  = rateLimitDoc
      ? rateLimitDoc.requestTimestamps.filter(t => t > window24h).length
      : 0;

    if (recentCount >= 2) {
      return res.status(429).json({ message: 'Password reset limit reached. Please try again in 24 hours.' });
    }

    // Look up user — only proceed if account has a stored password (not Google-only)
    const user = await User.findOne({ email: normEmail }).select('+password');
    if (user && user.password) {
      const rawToken  = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      await PasswordResetToken.findOneAndUpdate(
        { email: normEmail },
        { tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000), usedAt: null },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );

      const resetUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/login?tab=reset-password&token=${rawToken}`;
      sendPasswordResetEmail({ email: normEmail, resetUrl }); // fire and forget — non-fatal
    }

    // Record this request for rate limiting regardless of user existence
    await PasswordResetRateLimit.findOneAndUpdate(
      { email: normEmail },
      { $push: { requestTimestamps: new Date() } },
      { upsert: true }
    );

    res.status(200).json({ message: NEUTRAL_MSG });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/reset-password — set a new password using a valid reset token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ message: 'Token and new password required' });
    if (newPassword.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
    if (!/^[0-9a-f]{64}$/.test(token)) return res.status(400).json({ message: 'Invalid reset token' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const doc       = await PasswordResetToken.findOne({ tokenHash });

    if (!doc)          return res.status(400).json({ message: 'This reset link is invalid or has expired.' });
    if (doc.usedAt)    return res.status(400).json({ message: 'This reset link has already been used.' });
    if (new Date() > doc.expiresAt) return res.status(400).json({ message: 'This reset link is invalid or has expired.' });

    const user = await User.findOne({ email: doc.email }).select('+password');
    if (!user) return res.status(400).json({ message: 'Account not found.' });

    doc.usedAt = new Date();
    await doc.save();

    user.password = newPassword; // pre-save hook hashes it
    await user.save();

    res.status(200).json({ status: 'success', message: 'Password updated. You can now sign in.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Google OAuth ──────────────────────────────────────────────────────────────

// POST /api/auth/google  — verify Google ID token, find-or-create user
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: 'Google credential required' });

    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload  = ticket.getPayload();
    const googleId = payload.sub;
    const email    = payload.email?.toLowerCase();

    if (!email) return res.status(400).json({ message: 'Google account has no email' });

    // Find by googleId first, then fall back to email (links existing account)
    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    const settings = await AppSettings.getSettings();
    let isNew = false;
    if (!user) {
      const acRankId = await getAcRankId();
      user = await User.create({ email, googleId, rank: acRankId });
      if (settings.betaTesterAutoGold) {
        user.subscriptionTier = 'gold';
        user.subscriptionStartDate = new Date();
        await user.save();
      }
      sendWelcomeEmail({ email: user.email, agentNumber: user.agentNumber });
      isNew = true;
    } else {
      if (user.isBanned) return res.status(403).json({ message: 'Login failed. Please contact support.' });
      if (!user.googleId) { user.googleId = googleId; await user.save(); }
    }

    const { earned: loginCoins, label: loginLabel } = await recordLogin(user);
    sendToken(user, 200, res, { ...(isNew ? { isNew: true } : {}), loginAirstarsEarned: loginCoins, loginAirstarLabel: loginLabel });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(401).json({ message: 'Google authentication failed' });
  }
});

// ── Session ───────────────────────────────────────────────────────────────────

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  const isProd = process.env.NODE_ENV === 'production'
  res.cookie('jwt', '', { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax', expires: new Date(0) });
  res.json({ status: 'success' });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').protect, (req, res) => {
  res.json({ status: 'success', data: { user: req.user } });
});

module.exports = router;
