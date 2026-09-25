# Security Setup Quick Guide

## 🚨 CRITICAL: Remove Default Admin Account

The hardcoded default admin account with password 'admin123' has been **REMOVED** for security reasons.

## ✅ Secure Setup Process

### 1. Initialize Database Schema
```bash
psql -d your_database_name -f init-db.sql
```

### 2. Create Your Admin Account
```bash
# Method 1: Direct command
node create-admin.cjs <username> <password>

# Method 2: Using npm script
npm run create:admin <username> <password>

# Example:
node create-admin.cjs myAdminUser MySecurePassword123!
```

### 3. Password Requirements
Your password MUST include:
- ✅ Minimum 8 characters
- ✅ At least 1 uppercase letter
- ✅ At least 1 lowercase letter  
- ✅ At least 1 number
- ✅ At least 1 special character (!@#$%^&*()_+-=[]{}|;:,.<>?)

### 4. Security Checklist
- [ ] Database schema initialized without default users
- [ ] Strong admin password created and stored securely
- [ ] `.env` file configured with secure JWT_SECRET
- [ ] HTTPS enabled for production deployment
- [ ] Regular security audits scheduled

## 🔧 Troubleshooting

**Database Connection Error:**
- Verify DATABASE_URL in .env file
- Ensure PostgreSQL is running
- Check database credentials

**Username Already Exists:**
- Choose a different username
- Verify no test accounts remain

**Password Validation Failed:**
- Review password requirements above
- Use a password manager to generate secure passwords

## 📞 Support

If you encounter issues:
1. Check the main README.md for detailed setup instructions
2. Verify all environment variables are properly configured
3. Review database connection settings
4. Ensure PostgreSQL service is running

---
**⚠️ Security Notice**: Never commit credentials to version control. Always use environment variables for sensitive configuration.
