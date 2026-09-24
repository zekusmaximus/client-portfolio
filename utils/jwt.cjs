const jwt = require('jsonwebtoken');
const { SESSION_TTL } = require('../config/session.cjs');
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET env var missing');

// Tokens expire with the cookie that carries them (config/session.cjs).
exports.sign = (payload, opts = {}) =>
  jwt.sign(payload, secret, { expiresIn: SESSION_TTL, ...opts });

exports.verify = (token) => jwt.verify(token, secret);
