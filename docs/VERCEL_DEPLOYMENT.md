# Vercel Deployment Guide for Flask + MongoDB

## Configuration Summary

### Vercel Settings
- **Framework Preset**: `Other` or `Python` (Vercel auto-detects Flask)
- **Build Command**: (leave empty - Vercel auto-detects)
- **Output Directory**: (leave empty)
- **Install Command**: `pip install -r requirements.txt`
- **Python Version**: 3.11 or 3.12 (set in Vercel dashboard or via `runtime.txt`)

### Environment Variables

Set these in your Vercel project settings:

#### Required for Production:
```
FLASK_ENV=production
SECRET_KEY=your-strong-secret-key-here
SESSION_TYPE=null
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/conventioner?retryWrites=true&w=majority
# Note: MONGODB_URI is automatically set if you use MongoDB Atlas integration from Vercel Marketplace
FRONTEND_URL=https://your-frontend-domain.vercel.app
USE_HTTPS=true
```

#### Optional (if using individual MongoDB params instead of URI):
```
MONGODB_HOST=your-mongodb-host
MONGODB_PORT=27017
MONGODB_USER=your-username
MONGODB_PASSWORD=your-password
MONGODB_DB=conventioner
MONGODB_AUTH_DB=admin
```

#### Other Services:
```
RESEND_API_KEY=your-resend-api-key
FROM_EMAIL=your-verified-email@domain.com
RECAPTCHA_SECRET_KEY=your-recaptcha-secret-key
```

## Important Notes

### Session Storage
- **For Vercel**: Use `SESSION_TYPE=null` (sessions stored in cookies only)
- **For Local Dev**: Use `SESSION_TYPE=filesystem` (default)
- Filesystem sessions don't work on Vercel's serverless platform

### MongoDB Connection

**Option 1: MongoDB Atlas Integration (Recommended - Easiest)**
- **Provision MongoDB Atlas directly from Vercel**: 
  - Go to Vercel Dashboard → Click "Add new" → "Integration"
  - Search for "MongoDB Atlas" in the Marketplace
  - Select your project and provision a cluster (Free, Dedicated, or Flex)
  - The `MONGODB_URI` environment variable is **automatically configured** for you
  - No separate MongoDB Atlas signup needed - account is created automatically
  - Billing can be managed through Vercel

**Option 2: Manual MongoDB Atlas Setup**
- Create account at https://www.mongodb.com/cloud/atlas
- Create a free cluster (M0)
- Configure network access (allow 0.0.0.0/0 for development or Vercel IPs)
- Create database user
- Get connection string and manually add `MONGODB_URI` to Vercel environment variables
- Connection string format: `mongodb+srv://username:password@cluster.mongodb.net/conventioner?retryWrites=true&w=majority`

### Deployment Steps

1. **Connect your repository to Vercel**
   - Go to Vercel dashboard (https://vercel.com/dashboard)
   - Click "Add New Project"
   - Import your Git repository
   - **Set Root Directory**: `back-end` (if deploying only backend)

2. **Provision MongoDB Atlas (Recommended Method)**
   - In your Vercel project, click "Add new" → "Integration"
   - Search for "MongoDB Atlas" in the Marketplace
   - Select your project and choose a cluster type (Free tier available)
   - The `MONGODB_URI` environment variable will be automatically added to your project
   - **Note**: If you need to specify the database name, you may need to update the URI to include `/conventioner` at the end

3. **Configure Project Settings in Vercel UI**
   - **Framework Preset**: Select `Other` (Vercel will auto-detect Flask)
   - **Build Command**: Leave empty (Vercel auto-detects)
   - **Output Directory**: Leave empty
   - **Install Command**: `pip install -r requirements.txt`
   - **Python Version**: Set to `3.11` or `3.12` in Project Settings > General

4. **Configure Environment Variables**
   - Go to Project Settings > Environment Variables
   - Add the following required variables (if not already set by MongoDB Atlas integration):
     - `FLASK_ENV=production`
     - `SECRET_KEY=your-strong-secret-key-here`
     - `SESSION_TYPE=null`
     - `FRONTEND_URL=https://your-frontend-domain.vercel.app`
     - `USE_HTTPS=true`
     - `RESEND_API_KEY=your-resend-api-key`
     - `FROM_EMAIL=your-verified-email@domain.com`
     - `RECAPTCHA_SECRET_KEY=your-recaptcha-secret-key`
   - **Note**: `MONGODB_URI` should already be set if you used the MongoDB Atlas integration
   - Apply to Production, Preview, and Development environments as needed

5. **Initialize / migrate the database** (before the first deploy, and before any deploy that carries a new migration)
   - The back end refuses to boot unless the market-key migration is recorded as applied, and that check runs at import - so on Vercel it runs on every cold start, and an unmigrated database fails every request rather than serving markets it can only half see.
   - `mongo-init.js` never runs against Atlas (it is the Docker Mongo entrypoint), so a freshly provisioned cluster has no marker. Run this once, from `back-end/`, with `MONGODB_URI` pointing at the Atlas cluster:
     ```bash
     python init_database.py                    # fresh cluster: creates collections, records the marker
     python migrations/migrate_market_keys.py   # existing data: rewrites markets under the canonical keys
     ```
   - See [RELEASING.md](./RELEASING.md#pre-deploy-database-migrations) for the full pre-deploy migration list. Migrations are never run automatically.

6. **Deploy**
   - Click "Deploy" or push to your main branch
   - Vercel will automatically detect Flask and deploy

### File Structure
```
back-end/
├── app.py              # Flask application (entry point - auto-detected by Vercel)
├── requirements.txt    # Python dependencies
├── runtime.txt         # Python version (optional, can also set in UI)
└── ...                 # Other application files
```

### Troubleshooting

- **Import Errors**: Ensure all dependencies are in `requirements.txt`
- **MongoDB Connection Issues**: Check your MongoDB Atlas network access settings
- **Session Issues**: Verify `SESSION_TYPE=null` is set for Vercel
- **CORS Issues**: Ensure `FRONTEND_URL` matches your frontend domain exactly
- **"The market-key migration has not been applied to this database"**: the function is refusing to boot because it cannot confirm the migration (see step 5 above). Run `migrations/migrate_market_keys.py` against the Atlas database and redeploy. The same error appears when the marker simply cannot be read - an unknown migration state is treated as unmigrated - so check network access too.
