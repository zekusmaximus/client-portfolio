const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET env var missing');

exports.sign = (payload, opts = {}) =>
  jwt.sign(payload, secret, { expiresIn: '7d', ...opts });

exports.verify = (token) => jwt.verify(token, secret);