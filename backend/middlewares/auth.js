const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'toppertest_secret_2024';

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const adminAuth = (req, res, next) => {
  auth(req, res, () => {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Admin access required' });
    next();
  });
};

// Sets req.user if a valid token is present, but never rejects the request —
// lets public pages (SEO-crawlable) show extra per-user data when logged in.
const optionalAuth = (req, _res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  req.user = null;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch { /* stay anonymous */ }
  }
  next();
};

module.exports = { auth, adminAuth, optionalAuth };
