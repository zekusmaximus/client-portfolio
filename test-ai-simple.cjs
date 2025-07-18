const jwt = require('jsonwebtoken');

// Create test JWT for user ID 2 (testadmin)
const token = jwt.sign(
  { userId: 2 }, 
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-for-development-only',
  { expiresIn: '1h' }
);

console.log('Test JWT Token:', token);
console.log('\nTo test AI Advisor, run:');
console.log(`curl -X POST http://localhost:5000/api/claude/analyze-portfolio \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${token}" \\
  -d '{}'`);