const authRouter = require('./routes/auth.cjs');
const clientsRouter = require('./routes/clients.cjs');
const revenuesRouter = require('./routes/revenues.cjs');

console.log('✅ Successfully loaded route files:');
console.log('- authRouter:', !!authRouter);
console.log('- clientsRouter:', !!clientsRouter);
console.log('- revenuesRouter:', !!revenuesRouter);
console.log('✅ All route files loaded successfully with .cjs extension');