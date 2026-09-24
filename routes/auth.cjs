const express = require('express');
const router = express.Router();
const userModel = require('../models/userModel.cjs');
const { compare, hash } = require('../utils/hash.cjs');
const { sign } = require('../utils/jwt.cjs');
const { validatePassword } = require('../utils/passwordPolicy.cjs');
const { SESSION_TTL_MS } = require('../config/session.cjs');
const authenticateToken = require('../middleware/auth.cjs');
const { loginIpLimiter, loginUserLimiter } = require('../middleware/rateLimit.cjs');

// The auth cookie. In production the page (gbacpod.com, Netlify) and the API
// (client-portfolio-backend.onrender.com, Render) are different sites, so a
// SameSite=Lax cookie would never be sent with the API calls and login would
// break; the cookie stays SameSite=None, which browsers only accept with
// Secure. This deviates from D10 (Lax everywhere): cross-site POSTs are closed
// instead by the missing form-body parser and the origin allowlist in
// server.cjs. In development page and API are both on localhost (same site),
// so Lax works there. The same attributes go to res.cookie and res.clearCookie,
// or the browser keeps the cookie on logout.
const isProduction = process.env.NODE_ENV === 'production';
const AUTH_COOKIE = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path: '/',
};

router.post('/login', loginIpLimiter, loginUserLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await userModel.findByUsername(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = sign({ userId: user.id, username: user.username });

    // JWT in an HTTP-only cookie that expires with the token (SESSION_TTL)
    res.cookie('authToken', token, { ...AUTH_COOKIE, maxAge: SESSION_TTL_MS });

    // Return user info without the token
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout endpoint - clears the auth cookie
router.post('/logout', (req, res) => {
  res.clearCookie('authToken', AUTH_COOKIE);
  res.json({ success: true, message: 'Logged out successfully' });
});

// Get current user info endpoint
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await userModel.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Change the signed-in partner's own password.
// Body: { currentPassword, newPassword }. 200 { success: true }; 400 with the
// policy's errors; 401 when the current password is wrong. Shares the per-IP
// login budget, so it cannot be used to guess the current password faster than
// the login form. Sessions already issued stay valid until they expire (the
// JWT is stateless); rotating JWT_SECRET is what signs everyone out.
router.post('/change-password', loginIpLimiter, authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ success: false, error: 'Current password is required' });
    }

    const policy = validatePassword(newPassword);
    if (!policy.isValid) {
      return res.status(400).json({ success: false, error: policy.errors.join('. ') + '.', errors: policy.errors });
    }

    const user = await userModel.findWithPasswordById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const ok = await compare(currentPassword, user.password_hash);
    if (!ok) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    await userModel.updatePasswordHash(user.id, await hash(newPassword));

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
