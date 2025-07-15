import bcrypt from 'bcrypt';

const password = process.argv[2];

if (!password) {
  console.error('Usage: node create-hash.js <your_password_here>');
  process.exit(1);
}

const SALT_ROUNDS = 12;

bcrypt.hash(password, SALT_ROUNDS).then(hash => {
  console.log('Your Bcrypt Hash:');
  console.log(hash);
});