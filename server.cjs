const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const db = require('./db.cjs');
const { isConfigured, AI_MODEL } = require('./services/anthropic.cjs');

const app = express();
const PORT = process.env.PORT || 5000;

// Proxy hops in front of the app (Render's proxy: 1). Set before any middleware
// so req.ip and req.secure are the client's; the rate limiters key on req.ip.
// 0 (the default) trusts no X-Forwarded-For header, which is right for local
// development: trusting it without a proxy would let a client pick its own IP.
const TRUST_PROXY_HOPS = parseInt(process.env.TRUST_PROXY_HOPS || '0', 10);
if (TRUST_PROXY_HOPS > 0) app.set('trust proxy', TRUST_PROXY_HOPS);

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

// CORS. Production allows exactly FRONTEND_URL (https://gbacpod.com on
// Render); development allows the local dev servers. Any other origin gets no
// CORS headers, so the browser withholds the response, but no error either:
// a mismatch must not turn into a 500.
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = isProduction
  ? [process.env.FRONTEND_URL].filter(Boolean).map((url) => url.replace(/\/+$/, ''))
  : ['http://localhost:3000', 'http://localhost:5173'];
if (isProduction && !process.env.FRONTEND_URL) {
  console.warn('FRONTEND_URL is not set: no browser origin is allowed to call the API.');
}

app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
  credentials: true
}));

// Refuse state-changing requests from a foreign browser origin. CORS only hides
// the response: a cross-site form POST still reaches the route, with the
// partner's SameSite=None cookie, and the AI Advisor's analyze-portfolio and
// strategic-advice routes need no body at all, so dropping the form parser
// alone would still let any website spend the AI budget. Browsers send Origin on
// every cross-origin POST, PUT and DELETE; one that is neither allowlisted nor
// this server's own origin is refused before any route runs. Requests without
// Origin (curl, server to server) do not carry a partner's browser cookie.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (SAFE_METHODS.has(req.method) || !origin || allowedOrigins.includes(origin)) return next();
  if (origin === `${req.protocol}://${req.get('host')}`) return next();
  console.warn(JSON.stringify({ event: 'origin_refused', origin, method: req.method, path: req.originalUrl }));
  res.status(403).json({ success: false, error: 'Cross-origin request refused' });
});

app.use(cookieParser());
// JSON only: no form-body parser, so a cross-site HTML form cannot submit a
// body the routes will read (CSRF). 5 MB is ample for a CSV import.
app.use(express.json({ limit: '5mb' }));

// Auth routes
const authRouter = require('./routes/auth.cjs');
app.use('/api/auth', authRouter);

// Scenario modeling router
const scenariosRouter = require('./routes/scenarios.cjs');
app.use('/api/scenarios', scenariosRouter);

// API Routes (the page itself is served by Netlify, not by Express)
app.use('/api/claude', require('./claude.cjs').router);
app.use('/api/data', require('./data.cjs'));

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
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

  // AI: one client and one model constant, both owned by services/anthropic.cjs
  health.services.anthropic = isConfigured() ? 'configured' : 'not configured';
  health.services.model = AI_MODEL;
  if (!isConfigured() && health.status === 'OK') health.status = 'DEGRADED';

  res.json(health);
});


// Error handling middleware. Body-parser errors carry their own 4xx status
// (400 for malformed JSON, 413 over the 5 MB limit); anything else is a 500.
app.use((err, req, res, _next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error('Error:', err);
  res.status(status).json({ 
    error: status === 413 ? 'Request body too large (5 MB limit)' : status < 500 ? 'Bad request' : 'Internal server error',
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

