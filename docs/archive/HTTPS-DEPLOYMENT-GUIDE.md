# HTTPS Deployment Guide

This guide provides instructions for deploying the Client Portfolio application with proper HTTPS encryption and security configurations.

## Frontend Security Configuration

### Build-time HTTPS Enforcement
The application now enforces HTTPS at build time for production environments:

- **Vite Configuration**: The `vite.config.js` validates that `VITE_API_BASE_URL` uses HTTPS in production builds
- **Runtime Validation**: The `src/api.js` file includes runtime checks to ensure HTTPS is used in production

### Environment Variables
Set the following environment variable for production:

```bash
VITE_API_BASE_URL=https://your-api-domain.com
```

**Important**: The build will fail if you attempt to use an HTTP URL in production mode.

## Backend Security Configuration

### Security Middleware
The server now includes several security enhancements:

1. **HTTPS Redirect**: Automatically redirects HTTP traffic to HTTPS in production
2. **Security Headers**: Implements essential security headers including:
   - `Strict-Transport-Security` (HSTS)
   - `X-Frame-Options`
   - `X-Content-Type-Options`
   - `X-XSS-Protection`
   - `Content-Security-Policy`

### Environment Variables
Configure these environment variables for production:

```bash
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain.com
PORT=5000
```

## Deployment Platform Configurations

### 1. Heroku Deployment

Heroku automatically handles SSL termination. Configure your app:

```bash
# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set FRONTEND_URL=https://your-app.herokuapp.com
heroku config:set VITE_API_BASE_URL=https://your-api.herokuapp.com

# Deploy
git push heroku main
```

**Heroku SSL**: Heroku provides free SSL certificates. Ensure your custom domain has SSL enabled.

### 2. Render Deployment

Render provides automatic HTTPS. Configuration:

1. Set environment variables in Render dashboard:
   - `NODE_ENV=production`
   - `FRONTEND_URL=https://your-app.onrender.com`
   - `VITE_API_BASE_URL=https://your-api.onrender.com`

2. Render automatically issues and renews SSL certificates.

### 3. AWS Deployment (with ALB/CloudFront)

#### Application Load Balancer (ALB)
1. Configure ALB with SSL certificate from AWS Certificate Manager
2. Set up HTTP to HTTPS redirect rule
3. Configure health checks on `/api/health`

#### CloudFront Distribution
```json
{
  "ViewerProtocolPolicy": "redirect-to-https",
  "AllowedMethods": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
  "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
}
```

#### Environment Variables
```bash
NODE_ENV=production
FRONTEND_URL=https://your-cloudfront-domain.cloudfront.net
VITE_API_BASE_URL=https://your-alb-domain.us-east-1.elb.amazonaws.com
```

### 4. Nginx Reverse Proxy

If using a VPS or dedicated server, configure Nginx:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;
    
    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # Security headers (additional to app-level headers)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 5. Docker Deployment

#### Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Build frontend
RUN npm run build

# Expose port
EXPOSE 5000

# Start application
CMD ["npm", "start"]
```

#### Docker Compose with SSL
```yaml
version: '3.8'
services:
  app:
    build: .
    environment:
      - NODE_ENV=production
      - FRONTEND_URL=https://your-domain.com
      - VITE_API_BASE_URL=https://your-domain.com
    ports:
      - "5000:5000"
    
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
```

## SSL Certificate Management

### Let's Encrypt (Free SSL)

For VPS/dedicated servers, use Certbot:

```bash
# Install Certbot
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### AWS Certificate Manager
1. Request certificate in ACM console
2. Validate domain ownership
3. Associate with ALB/CloudFront

## Security Checklist

### Pre-deployment
- [ ] `VITE_API_BASE_URL` uses HTTPS in production
- [ ] `FRONTEND_URL` uses HTTPS in production
- [ ] `NODE_ENV=production` is set
- [ ] SSL certificate is valid and installed
- [ ] HTTP to HTTPS redirect is configured

### Post-deployment Verification
- [ ] Test HTTP redirect: `curl -I http://your-domain.com`
- [ ] Verify HTTPS: `curl -I https://your-domain.com`
- [ ] Check security headers: Use [securityheaders.com](https://securityheaders.com)
- [ ] SSL test: Use [ssllabs.com](https://www.ssllabs.com/ssltest/)
- [ ] HSTS preload: Submit to [hstspreload.org](https://hstspreload.org/)

## Troubleshooting

### Common Issues

1. **Mixed Content Errors**
   - Ensure all resources (APIs, images, scripts) use HTTPS
   - Check browser console for blocked content

2. **CORS Errors in Production**
   - Verify `FRONTEND_URL` is correctly set
   - Ensure the URL matches exactly (no trailing slashes)

3. **Certificate Issues**
   - Verify certificate chain is complete
   - Check certificate expiration
   - Ensure domain names match certificate

4. **Redirect Loops**
   - Check proxy headers (X-Forwarded-Proto)
   - Verify load balancer SSL termination settings

### Debug Commands

```bash
# Test HTTPS redirect
curl -v -L http://your-domain.com

# Check certificate
openssl s_client -connect your-domain.com:443 -servername your-domain.com

# Verify security headers
curl -I https://your-domain.com
```

## Monitoring and Maintenance

### SSL Certificate Monitoring
- Set up alerts for certificate expiration (30 days before)
- Monitor certificate transparency logs
- Regular security scans

### Security Updates
- Keep Node.js and dependencies updated
- Regular security audits: `npm audit`
- Monitor security advisories

### Performance Considerations
- Enable HTTP/2 when possible
- Use GZIP compression
- Implement proper caching headers
- Consider CDN for static assets

## Additional Security Measures

### Environment-specific Security
- Use secrets management (AWS Secrets Manager, Azure Key Vault)
- Implement proper logging and monitoring
- Set up intrusion detection
- Regular penetration testing

### Application Security
- Input validation and sanitization (already implemented)
- SQL injection prevention
- XSS protection
- CSRF tokens for sensitive operations
- Rate limiting for API endpoints

This configuration ensures that your Client Portfolio application maintains the highest security standards with proper HTTPS encryption and protection against common web vulnerabilities.
