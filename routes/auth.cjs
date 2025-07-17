const express = require('express');
const router = express.Router();
const userModel = require('../models/userModel.cjs');
const { compare } = require('../utils/hash.cjs');
const { sign, verify } = require('../utils/jwt.cjs');
const authenticateToken = require('../middleware/auth.cjs');

router.post('/login', async (req, res) => {
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
    
    // Set JWT in HTTP-only, secure cookie
    res.cookie('authToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict', // Allow cross-origin in production
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
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
  res.clearCookie('authToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
  });
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

module.exports = router;