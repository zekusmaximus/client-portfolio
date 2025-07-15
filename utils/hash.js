const bcrypt = require('bcrypt');
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);

exports.hash = (plain) => bcrypt.hash(plain, SALT_ROUNDS);
exports.compare = (plain, hashed) => bcrypt.compare(plain, hashed);