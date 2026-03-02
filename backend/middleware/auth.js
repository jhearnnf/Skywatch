const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    const token = req.cookies.jwt;
    if (!token) return res.status(401).json({ message: 'Not authenticated' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');

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
    const token = req.cookies.jwt;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (user && !user.isBanned) req.user = user;
    }
  } catch {} // expired / invalid token — continue as guest
  next();
};

module.exports = { protect, adminOnly, optionalAuth };
