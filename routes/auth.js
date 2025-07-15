const express = require('express');
const router = express.Router();
const userModel = require('../models/userModel');
const { compare } = require('../utils/hash');
const { sign } = require('../utils/jwt');

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
    res.json({ token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;