const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Extract JWT from Authorization header (Bearer) or fall back to cookie
const extractToken = (req) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return req.cookies.jwt;
};

const protect = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ message: 'Not authenticated' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password').populate('rank');

    if (!req.user) return res.status(401).json({ message: 'User not found' });
    if (req.user.isBanned) return res.status(403).json({ message: 'Account suspended. Please contact support.' });

    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired session' });
  }
};

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Like protect, but doesn't reject — sets req.user if a valid token is present, otherwise continues unauthenticated
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password').populate('rank');
      if (user && !user.isBanned) req.user = user;
    }
  } catch {} // expired / invalid token — continue as guest
  next();
};

module.exports = { protect, adminOnly, optionalAuth };
