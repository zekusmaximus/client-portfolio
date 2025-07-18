# Client Portfolio Optimization Dashboard

A comprehensive web application for managing client portfolios, tracking revenue, and analyzing strategic opportunities in the lobbying industry.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- PostgreSQL 13+
- npm or yarn package manager

### Environment Setup

1. Clone the repository and install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory with the following variables:
```env
DATABASE_URL=postgresql://username:password@localhost:5432/client_portfolio
NODE_ENV=development
JWT_SECRET=your-super-secret-jwt-key-here
VITE_API_BASE_URL=http://localhost:5000
```

**Production Note**: For production deployments, ensure `VITE_API_BASE_URL` uses HTTPS.

### Database Setup

1. Create your PostgreSQL database:
```sql
CREATE DATABASE client_portfolio;
```

2. Initialize the database schema:
```bash
psql -d client_portfolio -f init-db.sql
```

## 🔐 Security Setup - Creating Your First Admin User

**IMPORTANT**: This application does NOT create any default admin users for security reasons. You must create your first administrator account manually.

### Step 1: Create Your Admin Account

After initializing the database, create your admin user using the secure admin creation script:

```bash
node create-admin.cjs <username> <password>
```

**Example:**
```bash
node create-admin.cjs admin MySecurePassword123!
```

### Step 2: Password Requirements

Your admin password MUST meet these security requirements:
- ✅ At least 8 characters long
- ✅ At least one uppercase letter (A-Z)
- ✅ At least one lowercase letter (a-z)  
- ✅ At least one number (0-9)
- ✅ At least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?)

### Step 3: Username Requirements

Your admin username must:
- ✅ Be 3-50 characters long
- ✅ Only contain letters, numbers, underscores, and hyphens
- ✅ Be unique (not already exist in the system)

### Step 4: Security Best Practices

1. **Use a Strong, Unique Password**: Never reuse passwords from other systems
2. **Store Credentials Securely**: Use a password manager to store your admin credentials
3. **Regular Updates**: Change your admin password regularly
4. **Principle of Least Privilege**: Create additional users with limited permissions for day-to-day operations
5. **Monitor Access**: Regularly review user accounts and remove unused ones

## 🛠️ Development

### Running the Application

1. Start the development server:
```bash
npm run dev
```

2. In a separate terminal, start the backend API:
```bash
npm start
```

The application will be available at `http://localhost:5173` (frontend) and `http://localhost:5000` (API).

### Building for Production

```bash
npm run build:prod
```

### Security Checks

Run security audits before deployment:
```bash
npm run security:check
npm run security:audit
```

## 📊 Features

- **Client Management**: Comprehensive client tracking with status, practice areas, and relationship metrics
- **Revenue Analytics**: Multi-year revenue tracking and projection capabilities
- **Strategic Analysis**: AI-powered insights for client optimization and growth opportunities
- **Data Import/Export**: CSV-based data management with validation
- **Scenario Modeling**: What-if analysis for strategic planning
- **Secure Authentication**: JWT-based authentication with bcrypt password hashing

## 🏗️ Architecture

### Frontend
- **React 18** with modern hooks and functional components
- **Vite** for fast development and optimized builds
- **Tailwind CSS** for responsive, utility-first styling
- **Zustand** for lightweight state management
- **React Router** for client-side routing

### Backend
- **Express.js** API server with security middleware
- **PostgreSQL** database with optimized schemas
- **JWT Authentication** with secure token handling
- **bcrypt** for password hashing (12 salt rounds)
- **Input Validation** with express-validator

### Security Features
- 🔒 No default admin users (secure setup required)
- 🔒 Strong password requirements enforced
- 🔒 bcrypt password hashing with 12 salt rounds
- 🔒 JWT token-based authentication
- 🔒 Input validation and sanitization
- 🔒 HTTPS enforcement in production
- 🔒 CORS protection and security headers

## 📁 Project Structure

```
client-portfolio/
├── src/                    # React frontend source
│   ├── components/         # Reusable UI components
│   ├── utils/             # Frontend utilities
│   └── ...
├── routes/                # Express.js API routes
├── models/                # Database models
├── middleware/            # Express middleware
├── utils/                 # Backend utilities
├── scripts/               # Utility scripts
├── init-db.sql           # Database schema initialization
├── create-admin.cjs       # Secure admin user creation
├── server.cjs            # Express.js server
└── package.json          # Dependencies and scripts
```

## 🔄 Database Schema

### Users Table
- `id`: Primary key (SERIAL)
- `username`: Unique username (VARCHAR(255))
- `password_hash`: bcrypt hashed password (VARCHAR(255))
- `created_at`, `updated_at`: Timestamps

### Clients Table
- `id`: Primary key (UUID)
- `user_id`: Foreign key to users
- `name`: Client name
- `status`: Client status (Prospect, Active, etc.)
- `practice_area`: Array of practice areas
- Relationship and strategic metrics
- Timestamps

### Client Revenues Table
- `id`: Primary key (SERIAL)
- `client_id`: Foreign key to clients
- `year`: Revenue year
- `revenue_amount`: Decimal revenue amount
- Contract and timing information

## 🚨 Troubleshooting

### Admin User Creation Issues

**Database Connection Failed:**
```
❌ DATABASE_URL environment variable not set
```
- Ensure your `.env` file exists with a valid `DATABASE_URL`
- Check that PostgreSQL is running
- Verify database credentials and network connectivity

**Username Already Exists:**
```
❌ Username 'admin' already exists
```
- Choose a different username
- Or use different credentials for additional admin users

**Password Validation Failed:**
```
❌ Password validation failed:
   - Password must contain at least one uppercase letter
```
- Review password requirements above
- Ensure your password meets all security criteria

### Database Issues

**Schema Not Found:**
- Ensure you've run `init-db.sql` to create the database schema
- Check that you're connecting to the correct database

**Permission Denied:**
- Verify your database user has CREATE, INSERT, SELECT privileges
- Check PostgreSQL authentication configuration

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes with appropriate tests
4. Run security checks: `npm run security:check`
5. Commit with clear messages: `git commit -am 'Add your feature'`
6. Push to the branch: `git push origin feature/your-feature`
7. Submit a pull request

## 📄 License

This project is proprietary software. All rights reserved.

## 🆘 Support

For technical support or questions:
1. Check this README for common issues
2. Review application logs for error details
3. Ensure all environment variables are properly configured
4. Verify database connectivity and schema setup

---

**⚠️ Security Notice**: This application handles sensitive client and financial data. Always follow security best practices, keep dependencies updated, and conduct regular security audits before production deployment.
