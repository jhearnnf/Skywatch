const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Extract JWT from Authorization header (Bearer) or fall back to cookie
const extractToken = (req) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return req.cookies.jwt;
};

// Cutoff for a "live" streak: midnight at the start of yesterday. Any
// lastStreakDate older than this means the streak has lapsed (since the user
// has missed both yesterday and today).
const staleStreakCutoff = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return d;
};

// If the user's last streak day is neither today nor yesterday, the streak
// has lapsed — zero it out so the displayed value matches reality without
// waiting for the next brief completion to recompute it.
const normalizeStaleStreak = async (user) => {
  if (!user || !user.lastStreakDate || !(user.loginStreak > 0)) return;
  if (new Date(user.lastStreakDate) < staleStreakCutoff()) {
    user.loginStreak = 0;
    await user.save();
  }
};

// Bulk version of normalizeStaleStreak — used by admin endpoints to clean up
// records of users who never come back (and therefore never trip the
// per-request middleware). Single indexed updateMany, only touches rows that
// actually need changing.
const sweepStaleStreaks = () =>
  User.updateMany(
    { lastStreakDate: { $lt: staleStreakCutoff() }, loginStreak: { $gt: 0 } },
    { $set: { loginStreak: 0 } },
  );

const protect = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'Invalid or expired session' });
  }

  req.user = await User.findById(decoded.id).select('-password').populate('rank');
  if (!req.user) return res.status(401).json({ message: 'User not found' });
  if (req.user.isBanned) return res.status(403).json({ message: 'Account suspended. Please contact support.' });

  await normalizeStaleStreak(req.user);

  next();
};

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Like protect, but doesn't reject — sets req.user if a valid token is present, otherwise continues unauthenticated
const optionalAuth = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return next(); // invalid/expired token — continue as guest
  }

  const user = await User.findById(decoded.id).select('-password').populate('rank');
  if (user && !user.isBanned) {
    req.user = user;
    await normalizeStaleStreak(req.user);
  }
  next();
};

module.exports = { protect, adminOnly, optionalAuth, sweepStaleStreaks, staleStreakCutoff };
