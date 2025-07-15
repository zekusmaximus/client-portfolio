const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const db = require('./db.cjs');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*', // Allow all origins for development
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Auth routes
const authRouter = require('./routes/auth');
app.use('/api/auth', authRouter);

// Stage 3 routers
const clientsRouter = require('./routes/clients');
const revenuesRouter = require('./routes/revenues');

app.use('/api/clients', clientsRouter);
app.use('/api/revenues', revenuesRouter);

// Serve static files from React build
app.use(express.static(path.join(__dirname, '../frontend/build')));

// API Routes
app.use('/api/claude', require('./claude.cjs'));
app.use('/api/data', require('./data.cjs'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve React app for all other routes (commented out for now)
// app.get('/*', (req, res) => {
//   res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
// });

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});
 
// Health check for DB on boot
(async () => {
  try {
    await db.query('SELECT 1');
    console.log('✅  PostgreSQL connection OK');
  } catch (e) {
    console.error('❌  PostgreSQL connection failed', e);
    process.exit(1);
  }
})();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;

