const router      = require('express').Router();
const bcrypt      = require('bcryptjs');
const crypto      = require('crypto');
const jwt         = require('jsonwebtoken');
const User        = require('../models/User');
const PendingRegistration = require('../models/PendingRegistration');
const AppSettings = require('../models/AppSettings');
const AircoinLog  = require('../models/AircoinLog');
const { sendWelcomeEmail, sendConfirmationEmail } = require('../utils/email');
const { awardCoins }       = require('../utils/awardCoins');

// ── Helpers ───────────────────────────────────────────────────────────────────

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const sendToken = (user, statusCode, res, extras = {}) => {
  const token = signToken(user._id);
  res.cookie('jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
  user.password = undefined;
  res.status(statusCode).json({ status: 'success', data: { user, ...extras } });
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
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
    if (password.length < 8)  return res.status(400).json({ message: 'Password must be at least 8 characters' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ message: 'Email already registered' });

    const code      = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await PendingRegistration.findOneAndUpdate(
      { email: email.toLowerCase() },
      { email: email.toLowerCase(), password, code, expiresAt },
      { upsert: true, new: true, setDefaultsOnInsert: true }
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

    const user = await User.create({ email: pending.email, password: pending.password });
    await PendingRegistration.deleteOne({ email: pending.email });

    sendWelcomeEmail({ email: user.email, agentNumber: user.agentNumber });
    const { earned: loginCoins, label: loginLabel } = await recordLogin(user);
    sendToken(user, 201, res, { isNew: true, loginAircoinsEarned: loginCoins, loginAircoinLabel: loginLabel });
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
    sendToken(user, 200, res, { loginAircoinsEarned: loginCoins, loginAircoinLabel: loginLabel });
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

    let isNew = false;
    if (!user) {
      user = await User.create({ email, googleId });
      sendWelcomeEmail({ email: user.email, agentNumber: user.agentNumber });
      isNew = true;
    } else {
      if (user.isBanned) return res.status(403).json({ message: 'Login failed. Please contact support.' });
      if (!user.googleId) { user.googleId = googleId; await user.save(); }
    }

    const { earned: loginCoins, label: loginLabel } = await recordLogin(user);
    sendToken(user, 200, res, { ...(isNew ? { isNew: true } : {}), loginAircoinsEarned: loginCoins, loginAircoinLabel: loginLabel });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(401).json({ message: 'Google authentication failed' });
  }
});

// ── Session ───────────────────────────────────────────────────────────────────

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  res.cookie('jwt', '', { httpOnly: true, expires: new Date(0) });
  res.json({ status: 'success' });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').protect, (req, res) => {
  res.json({ status: 'success', data: { user: req.user } });
});

module.exports = router;
