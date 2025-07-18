#!/usr/bin/env node

/**
 * Security Validation Script
 * 
 * This script validates the security configuration of the application
 * before deployment to production.
 */

const https = require('https');
const http = require('http');
const url = require('url');

class SecurityValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.passed = [];
  }

  log(type, message) {
    const timestamp = new Date().toISOString();
    const prefix = {
      error: '❌ ERROR',
      warning: '⚠️  WARNING',
      success: '✅ PASS',
      info: 'ℹ️  INFO'
    }[type] || 'INFO';
    
    console.log(`[${timestamp}] ${prefix}: ${message}`);
    
    if (type === 'error') this.errors.push(message);
    if (type === 'warning') this.warnings.push(message);
    if (type === 'success') this.passed.push(message);
  }

  validateEnvironmentVariables() {
    this.log('info', 'Validating environment variables...');
    
    const requiredVars = ['NODE_ENV', 'VITE_API_BASE_URL'];
    const prodRequiredVars = ['FRONTEND_URL', 'JWT_SECRET'];
    
    // Check required variables
    for (const varName of requiredVars) {
      if (!process.env[varName]) {
        this.log('error', `Missing required environment variable: ${varName}`);
      } else {
        this.log('success', `Found required variable: ${varName}`);
      }
    }
    
    // Production-specific checks
    if (process.env.NODE_ENV === 'production') {
      for (const varName of prodRequiredVars) {
        if (!process.env[varName]) {
          this.log('error', `Missing production environment variable: ${varName}`);
        } else {
          this.log('success', `Found production variable: ${varName}`);
        }
      }
    }
  }

  validateHTTPSUrls() {
    this.log('info', 'Validating HTTPS configuration...');
    
    const apiUrl = process.env.VITE_API_BASE_URL;
    const frontendUrl = process.env.FRONTEND_URL;
    
    if (process.env.NODE_ENV === 'production') {
      // Check API URL
      if (apiUrl) {
        if (apiUrl.startsWith('https://')) {
          this.log('success', 'API URL uses HTTPS');
        } else {
          this.log('error', 'Production API URL must use HTTPS');
        }
      }
      
      // Check Frontend URL
      if (frontendUrl) {
        if (frontendUrl.startsWith('https://')) {
          this.log('success', 'Frontend URL uses HTTPS');
        } else {
          this.log('error', 'Production Frontend URL must use HTTPS');
        }
      }
    } else {
      this.log('info', 'Development mode - HTTP URLs are acceptable');
    }
  }

  validateJWTSecrets() {
    this.log('info', 'Validating JWT secrets...');
    
    const jwtSecret = process.env.JWT_SECRET;
    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
    
    if (jwtSecret) {
      if (jwtSecret.length >= 32) {
        this.log('success', 'JWT secret meets minimum length requirement');
      } else {
        this.log('error', 'JWT secret should be at least 32 characters long');
      }
      
      if (process.env.NODE_ENV === 'production' && jwtSecret.includes('dev')) {
        this.log('error', 'Production JWT secret appears to be a development secret');
      }
    }
    
    if (jwtRefreshSecret) {
      if (jwtRefreshSecret.length >= 32) {
        this.log('success', 'JWT refresh secret meets minimum length requirement');
      } else {
        this.log('error', 'JWT refresh secret should be at least 32 characters long');
      }
    }
  }

  async validateSSLCertificate(hostname) {
    if (!hostname || process.env.NODE_ENV !== 'production') {
      return;
    }

    this.log('info', `Validating SSL certificate for ${hostname}...`);
    
    return new Promise((resolve) => {
      const options = {
        hostname: hostname,
        port: 443,
        method: 'HEAD',
        timeout: 5000
      };
      
      const req = https.request(options, (res) => {
        const cert = res.socket.getPeerCertificate();
        
        if (cert && cert.valid_to) {
          const expiryDate = new Date(cert.valid_to);
          const now = new Date();
          const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
          
          if (daysUntilExpiry > 30) {
            this.log('success', `SSL certificate is valid (expires in ${daysUntilExpiry} days)`);
          } else if (daysUntilExpiry > 0) {
            this.log('warning', `SSL certificate expires soon (${daysUntilExpiry} days)`);
          } else {
            this.log('error', 'SSL certificate has expired');
          }
        }
        resolve();
      });
      
      req.on('error', (error) => {
        this.log('error', `Failed to validate SSL certificate: ${error.message}`);
        resolve();
      });
      
      req.on('timeout', () => {
        this.log('warning', 'SSL certificate validation timed out');
        req.destroy();
        resolve();
      });
      
      req.end();
    });
  }

  async validateSecurityHeaders(testUrl) {
    if (!testUrl || process.env.NODE_ENV !== 'production') {
      return;
    }

    this.log('info', `Validating security headers for ${testUrl}...`);
    
    return new Promise((resolve) => {
      const urlObj = url.parse(testUrl);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;
      const port = urlObj.port || (isHttps ? 443 : 80);
      
      const options = {
        hostname: urlObj.hostname,
        port: port,
        path: urlObj.path || '/',
        method: 'HEAD',
        timeout: 5000
      };
      
      const req = client.request(options, (res) => {
        const headers = res.headers;
        
        // Check essential security headers
        const securityHeaders = {
          'strict-transport-security': 'HSTS',
          'x-frame-options': 'Clickjacking protection',
          'x-content-type-options': 'MIME type sniffing protection',
          'x-xss-protection': 'XSS protection',
          'content-security-policy': 'Content Security Policy'
        };
        
        for (const [header, description] of Object.entries(securityHeaders)) {
          if (headers[header]) {
            this.log('success', `${description} header is present`);
          } else {
            this.log('warning', `Missing ${description} header (${header})`);
          }
        }
        
        resolve();
      });
      
      req.on('error', (error) => {
        this.log('error', `Failed to check security headers: ${error.message}`);
        resolve();
      });
      
      req.on('timeout', () => {
        this.log('warning', 'Security headers check timed out');
        req.destroy();
        resolve();
      });
      
      req.end();
    });
  }

  async run() {
    console.log('🔒 Security Validation Starting...\n');
    
    this.validateEnvironmentVariables();
    this.validateHTTPSUrls();
    this.validateJWTSecrets();
    
    // Extract hostname for SSL validation
    const apiUrl = process.env.VITE_API_BASE_URL;
    const frontendUrl = process.env.FRONTEND_URL;
    
    if (apiUrl && apiUrl.startsWith('https://')) {
      const hostname = url.parse(apiUrl).hostname;
      await this.validateSSLCertificate(hostname);
      await this.validateSecurityHeaders(apiUrl);
    }
    
    if (frontendUrl && frontendUrl.startsWith('https://')) {
      const hostname = url.parse(frontendUrl).hostname;
      if (hostname !== url.parse(apiUrl || '').hostname) {
        await this.validateSSLCertificate(hostname);
        await this.validateSecurityHeaders(frontendUrl);
      }
    }
    
    // Summary
    console.log('\n📊 Security Validation Summary:');
    console.log(`✅ Passed: ${this.passed.length}`);
    console.log(`⚠️  Warnings: ${this.warnings.length}`);
    console.log(`❌ Errors: ${this.errors.length}`);
    
    if (this.errors.length > 0) {
      console.log('\n❌ Errors that must be fixed:');
      this.errors.forEach(error => console.log(`  • ${error}`));
    }
    
    if (this.warnings.length > 0) {
      console.log('\n⚠️  Warnings to consider:');
      this.warnings.forEach(warning => console.log(`  • ${warning}`));
    }
    
    const exitCode = this.errors.length > 0 ? 1 : 0;
    console.log(`\n${exitCode === 0 ? '✅' : '❌'} Security validation ${exitCode === 0 ? 'passed' : 'failed'}`);
    
    process.exit(exitCode);
  }
}

// Load environment variables if .env file exists
try {
  require('dotenv').config();
} catch (e) {
  // dotenv is optional
}

// Run validation
const validator = new SecurityValidator();
validator.run().catch(error => {
  console.error('❌ Security validation failed with error:', error);
  process.exit(1);
});
