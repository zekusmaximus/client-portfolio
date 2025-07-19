const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();
const db = require('./db.cjs');

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware for HTTPS enforcement in production
const enforceHTTPS = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    // Check if the request is not using HTTPS
    if (req.header('x-forwarded-proto') !== 'https' && !req.secure) {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
  }
  next();
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
  // Enforce HTTPS and prevent downgrade attacks
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Content Security Policy
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;");
  
  next();
};

// Apply security middleware
app.use(enforceHTTPS);
app.use(securityHeaders);

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (process.env.NODE_ENV === 'production') {
      const allowedOrigins = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [];
      
      // Ensure production origins use HTTPS
      const hasInsecureOrigin = allowedOrigins.some(url => url && !url.startsWith('https://'));
      if (hasInsecureOrigin) {
        console.error('Security Error: All production origins must use HTTPS');
        return callback(new Error('Insecure origin configuration'));
      }
      
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // Development - allow common dev ports
      const devOrigins = ['http://localhost:3000', 'http://localhost:5173'];
      if (!origin || devOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Auth routes
const authRouter = require('./routes/auth.cjs');
app.use('/api/auth', authRouter);

// Stage 3 routers
const clientsRouter = require('./routes/clients.cjs');
const revenuesRouter = require('./routes/revenues.cjs');
const scenariosRouter = require('./routes/scenarios.cjs');

app.use('/api/clients', clientsRouter);
app.use('/api/revenues', revenuesRouter);
app.use('/api/scenarios', scenariosRouter);

// Serve static files from React build
app.use(express.static(path.join(__dirname, '../frontend/build')));

// API Routes
app.use('/api/claude', require('./claude.cjs'));
app.use('/api/data', require('./data.cjs'));

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services: {}
  };

  // Check database connection
  try {
    await db.query('SELECT 1');
    health.services.database = 'connected';
  } catch (e) {
    health.services.database = 'disconnected';
    health.status = 'DEGRADED';
  }

  // Check Anthropic API key
  const hasApiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.OPENAI_API_KEY;
  if (hasApiKey) {
    health.services.anthropic = 'configured';
  } else {
    health.services.anthropic = 'not configured';
    if (health.status === 'OK') health.status = 'DEGRADED';
  }

  res.json(health);
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
 
// Health check for DB on boot and initialize tables
(async () => {
  try {
    console.log('🔍 Testing database connection...');
    await db.query('SELECT 1');
    console.log('✅  PostgreSQL connection OK');

    // Initialize database tables
    console.log('🔍 Initializing database tables...');
    const fs = require('fs');
    const path = require('path');
    const initScript = fs.readFileSync(path.join(__dirname, 'init-db.sql'), 'utf8');
    await db.query(initScript);
    console.log('✅  Database tables initialized');
  } catch (e) {
    console.error('❌  Database initialization failed:', e.message);
    console.error('Full error:', e);
    
    if (process.env.NODE_ENV === 'production') {
      console.error('💥 Cannot start server without database in production');
      process.exit(1);
    } else {
      console.log('⚠️  Development mode: Continuing without database...');
      console.log('📝 Make sure your DATABASE_URL is correct in .env file');
    }
  }
})();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;

