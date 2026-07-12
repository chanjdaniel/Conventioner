# Technology Stack

This document outlines the complete technology stack used in the Conventioner application.

## Backend

### Core Framework
- **Flask 3.0.0** - Python web framework
  - Lightweight and flexible microframework
  - RESTful API endpoints
  - Session management with Flask-Session

### Authentication & Security
- **Flask-Login 0.6.3** - User session management
  - Handles user authentication state
  - Session-based authentication (not JWT)
  - Email-based user identification
- **Flask-Bcrypt 1.0.1** - Password hashing
  - Secure password storage using bcrypt
  - Password verification for login
- **Flask-CORS 4.0.0** - Cross-Origin Resource Sharing
  - Enables frontend-backend communication
  - Configured with credentials support

### Database
- **MongoDB 7** - NoSQL document database
  - Primary data storage
  - Collections: `users`, `markets`, `organizations`, `source_data`
  - Connection via PyMongo 4.6.1
  - Database name: `conventioner`

### Data Validation
- **Pydantic 2.5.3** - Data validation and settings management
  - Type-safe data models
  - Automatic validation
  - Used for API request/response validation

### Email Service
- **Resend** - Transactional email service
  - Email verification links
  - Password reset emails
  - OTP (One-Time Password) delivery for passwordless login
  - HTML and plain text email templates
  - API key configured via `RESEND_API_KEY` environment variable

### CAPTCHA Service
- **Google reCAPTCHA v3** - Bot protection
  - Invisible CAPTCHA verification
  - Score-based verification (minimum 0.5)
  - Used on registration endpoint
  - Secret key configured via `RECAPTCHA_SECRET_KEY` environment variable
  - Test-only bypass via `DISABLE_CAPTCHA` (non-production only; see Environment Variables)

### Utilities
- **Cryptography 41.0.0+** - Cryptographic functions
  - Secure token generation
  - Used for email verification and password reset tokens
- **Requests 2.31.0+** - HTTP library
  - Used for reCAPTCHA verification API calls

### Session Management
- **Flask-Session 0.8.0** - Server-side session storage
  - Filesystem-based session storage
  - Session lifetime: 2 hours (7200 seconds)
  - Secure cookie configuration for production

### Testing
- **pytest 8+** - Python test framework
  - Runs the back-end test suite (`python -m pytest tests/`)
  - Configured via `back-end/pytest.ini`
  - Tests use in-memory fakes, so no database connection is required

## Frontend

### Core Framework
- **Vue 3.5.13** - Progressive JavaScript framework
  - Composition API (`<script setup>`)
  - Reactive data binding
  - Component-based architecture

### Build Tool
- **Vite 6.0.11** - Next-generation frontend build tool
  - Fast development server with HMR
  - Production build optimization
  - Proxy configuration for API requests

### Language
- **TypeScript 5.7.3** - Typed JavaScript
  - Type safety
  - Better IDE support
  - Compile-time error checking

### UI Framework & Components
- **PrimeVue 4.3.0** - Vue UI component library
  - Rich component set
  - Theming support
- **PrimeIcons 7.0.0** - Icon library
  - Comprehensive icon set

### State Management
- **Pinia 2.3.1** - Vue state management
  - Store-based state management
  - Currently using provide/inject pattern for user state

### Routing
- **Vue Router 4.5.0** - Official router for Vue.js
  - Client-side routing
  - Route guards for authentication
  - Public and protected routes

### HTTP Client
- **Axios 1.12.2** - Promise-based HTTP client
  - API communication
  - Request/response interceptors
  - Cookie-based authentication support

### Utilities
- **VueUse 12.5.0** - Collection of Vue composition utilities
  - Reusable composition functions
- **PapaParse 5.5.2** - CSV parsing library
  - CSV file parsing and generation
  - Used for vendor data import/export
- **VueDraggable 4.1.0** - Drag and drop component
  - Drag-and-drop functionality for UI elements

### Development Tools
- **ESLint 9.18.0** - JavaScript/TypeScript linter
  - Code quality enforcement
  - Vue-specific linting rules
- **Prettier 3.4.2** - Code formatter
  - Consistent code formatting
- **Vue TSC 2.2.0** - TypeScript type checker for Vue
  - Type checking for Vue components

### Testing Tools
- **Vitest 4** - Unit test runner
  - Runs component and utility unit tests (`npm run test:unit`)
  - Uses the `happy-dom` environment (configured in `vitest.config.ts`)
- **@vue/test-utils 2** - Vue component testing utilities
- **Playwright 1.61** - End-to-end browser testing
  - Drives Chromium against the running Docker stack (`npm run test:e2e`)
  - Configured in `playwright.config.ts`
  - Page Object Model + fixtures under `front-end/e2e/`; selectors use
    `data-testid` attributes (see `docs/TESTING.md`)

## Infrastructure & DevOps

### Containerization
- **Docker** - Container platform
  - Multi-container application setup
  - Service orchestration via Docker Compose
  - Development and production environments

### Services (Docker Compose)
1. **MongoDB** - Database service
   - Port: 27017
   - Persistent data volumes
   - Health checks configured

2. **Backend** - Flask API service
   - Port: 5000 (HTTPS with adhoc certificate)
   - Hot-reload enabled
   - Volume mounts for code and sessions

3. **Frontend** - Vue development server
   - Port: 5173
   - Hot-reload enabled
   - Vite dev server with proxy

4. **Mongo Express** (optional) - MongoDB admin UI
   - Port: 8081
   - Database management interface

### Continuous Integration
- **GitHub Actions** - CI pipeline (`.github/workflows/test.yml`)
  - Runs on pushes and pull requests to `main` or `dev`
  - Jobs: back-end pytest, front-end type-check + lint + unit tests, Docker build verification, and E2E (Playwright against the Docker stack with `DISABLE_CAPTCHA=true` and `DISABLE_EMAIL=true`, uploading artifacts on failure)
- **GitHub Actions** - Release automation (`.github/workflows/release-please.yml`)
  - Runs [release-please](https://github.com/googleapis/release-please) on pushes to `main`
  - Opens/updates a Release PR (version bump + CHANGELOG) that, when merged, tags a release
  - See [RELEASING.md](./RELEASING.md) for the branch model and release cycle

## Authentication Flow

### User Registration
1. User submits registration form with CAPTCHA verification
2. Backend validates CAPTCHA token
3. Password is hashed with bcrypt
4. User account created with `email_verified: false`
5. Verification token generated and stored
6. Verification email sent via Resend
7. User clicks verification link in email
8. Email verified, account activated

### Login Methods
1. **Password Login**
   - Email and password authentication
   - Requires email verification
   - Session-based authentication

2. **Passwordless Login (OTP)**
   - User requests OTP via email
   - 6-digit code sent via Resend
   - Code expires in 5 minutes
   - Max 5 verification attempts
   - Rate limited (max 3 requests per hour)

### Password Reset
1. User requests password reset
2. Reset token generated and stored
3. Reset link sent via Resend email
4. Token expires in 1 hour
5. User sets new password
6. Password hashed and stored

## Security Features

- **Password Hashing**: Bcrypt with secure salt generation
- **Email Verification**: Required before account activation
- **CAPTCHA Protection**: reCAPTCHA v3 on registration
- **Rate Limiting**: OTP and password reset requests
- **Token Expiration**: Time-limited tokens for verification and reset
- **Secure Sessions**: HTTP-only, secure cookies in production
- **CORS Protection**: Configured for specific origins
- **Input Validation**: Pydantic models for type safety

## Environment Variables

### Backend
- `RESEND_API_KEY` - Resend email service API key
- `FRONTEND_URL` - Frontend URL for email links (e.g., `http://localhost:5173`)
- `FROM_EMAIL` - Email address to send from (default: `onboarding@resend.dev`)
- `RECAPTCHA_SECRET_KEY` - Google reCAPTCHA v3 secret key
- `DISABLE_CAPTCHA` - Test-only flag to skip reCAPTCHA verification (default OFF; set `true`/`1`). Honored only when `FLASK_ENV` is not `production`
- `DISABLE_EMAIL` - Test-only flag to skip sending verification, password reset, and OTP emails via Resend, treating them as sent (default OFF; set `true`/`1`). Honored only when `FLASK_ENV` is not `production`
- `MONGODB_HOST` - MongoDB hostname (default: `mongodb` in Docker, `localhost` locally)
- `MONGODB_PORT` - MongoDB port (default: `27017`)
- `MONGODB_USER` - MongoDB username (default: `admin`)
- `MONGODB_PASSWORD` - MongoDB password (default: `secret`)
- `MONGODB_DB` - Database name (default: `conventioner`)
- `FLASK_ENV` - Flask environment (`development` or `production`)
- `USE_HTTPS` - Enable HTTPS (default: `true`)
- `SECRET_KEY` - Flask secret key for sessions

### Frontend
- `VITE_FLASK_HOST` - API base path (default: `/api`)
- `VITE_BACKEND_URL` - Backend URL for Vite proxy (default: `https://backend:5000`)
- `VITE_RECAPTCHA_SITE_KEY` - Google reCAPTCHA v3 site key

## Project Structure

```
Conventioner/
├── back-end/
│   ├── api/              # API endpoint modules
│   │   ├── users.py      # User authentication endpoints
│   │   ├── markets.py     # Market management endpoints
│   │   ├── organizations.py  # Organization endpoints
│   │   └── source_data.py   # CSV data endpoints
│   ├── utils/            # Utility modules
│   │   ├── tokens.py     # Token/OTP generation
│   │   ├── email.py      # Email service integration
│   │   └── captcha.py   # CAPTCHA verification
│   ├── migrations/       # Database migration scripts
│   ├── assignment/       # Assignment algorithm logic
│   ├── app.py            # Flask application entry point
│   ├── datatypes.py      # Pydantic data models
│   ├── db_config.py      # MongoDB connection configuration
│   └── requirements.txt  # Python dependencies
├── front-end/
│   ├── src/
│   │   ├── views/        # Page components
│   │   ├── components/   # Reusable components
│   │   ├── utils/        # Utility functions
│   │   ├── router/       # Vue Router configuration
│   │   └── App.vue       # Root component
│   ├── package.json      # Node.js dependencies
│   └── vite.config.ts   # Vite configuration
├── docs/                 # Documentation
├── docker-compose.yml    # Docker Compose configuration
└── README.md             # Project README
```

## Development Workflow

1. **Backend Development**
   - Flask development server with auto-reload
   - MongoDB connection via PyMongo
   - API endpoints tested via HTTP requests

2. **Frontend Development**
   - Vite dev server with HMR
   - TypeScript compilation
   - Proxy to backend API

3. **Database Migrations**
   - Python scripts in `back-end/migrations/`
   - Run migrations to update schema
   - Example: `python back-end/migrations/add_email_verification.py`
   - `migrate_phase.py` backfills `phase` on existing market documents (`isDraft: true` → `draft`, `isDraft: false` → `archived`). It is idempotent, and `--dry-run` previews the changes without applying them.

## External Services

### Resend (Email Service)
- **Purpose**: Transactional email delivery
- **Use Cases**:
  - Email verification
  - Password reset links
  - OTP codes for passwordless login
- **Configuration**: API key required
- **Documentation**: https://resend.com/docs

### Google reCAPTCHA v3
- **Purpose**: Bot protection and spam prevention
- **Use Cases**: Registration form protection
- **Configuration**: Site key (frontend) and secret key (backend)
- **Documentation**: https://developers.google.com/recaptcha/docs/v3

## Version Information

- **Python**: 3.11+
- **Node.js**: 18+
- **MongoDB**: 7
- **Docker**: Latest stable version

## Additional Resources

- [Flask Documentation](https://flask.palletsprojects.com/)
- [Vue 3 Documentation](https://vuejs.org/)
- [MongoDB Documentation](https://docs.mongodb.com/)
- [Vite Documentation](https://vitejs.dev/)
- [Resend Documentation](https://resend.com/docs)
- [reCAPTCHA v3 Documentation](https://developers.google.com/recaptcha/docs/v3)
