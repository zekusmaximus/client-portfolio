const { verify } = require('../utils/jwt.cjs');

module.exports = function authenticateToken(req, res, next) {
  // Try to get token from cookie first, fallback to Authorization header for backwards compatibility
  let token = req.cookies?.authToken;
  
  if (!token) {
    const header = req.headers['authorization'];
    token = header && header.split(' ')[1];
  }
  
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    req.user = verify(token);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};