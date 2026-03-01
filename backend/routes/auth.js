const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const { sendWelcomeEmail } = require('../utils/email');

const ADMIN_EMAIL = 'osmightymanos@hotmail.co.uk';

// ── Helpers ───────────────────────────────────────────────────────────────────

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const sendToken = (user, statusCode, res) => {
  const token = signToken(user._id);
  res.cookie('jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
  user.password = undefined;
  res.status(statusCode).json({ status: 'success', data: { user } });
};

const recordLogin = async (user) => {
  user.logins.push({ timestamp: new Date() });
  await user.save();
};

// ── Email / Password ──────────────────────────────────────────────────────────

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
    if (password.length < 8)  return res.status(400).json({ message: 'Password must be at least 8 characters' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ message: 'Email already registered' });

    const isAdmin = email.toLowerCase() === ADMIN_EMAIL;
    const user    = await User.create({ email, password, isAdmin });

    sendWelcomeEmail({ email: user.email, agentNumber: user.agentNumber });
    await recordLogin(user);
    sendToken(user, 201, res);
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

    await recordLogin(user);
    sendToken(user, 200, res);
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

    if (!user) {
      const isAdmin = email === ADMIN_EMAIL;
      user = await User.create({ email, googleId, isAdmin });
      sendWelcomeEmail({ email: user.email, agentNumber: user.agentNumber });
    } else {
      // Link Google ID and enforce admin status if applicable
      let changed = false;
      if (!user.googleId)                { user.googleId = googleId; changed = true; }
      if (email === ADMIN_EMAIL && !user.isAdmin) { user.isAdmin = true; changed = true; }
      if (user.isBanned) return res.status(403).json({ message: 'Login failed. Please contact support.' });
      if (changed) await user.save();
    }

    await recordLogin(user);
    sendToken(user, 200, res);
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
