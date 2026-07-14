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
SECRET_KEY=<generate: python -c 'import secrets; print(secrets.token_urlsafe(48))'>
SESSION_TYPE=null
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/conventioner?retryWrites=true&w=majority
# Note: MONGODB_URI is automatically set if you use MongoDB Atlas integration from Vercel Marketplace
FRONTEND_URL=https://your-frontend-domain.vercel.app
RECAPTCHA_SECRET_KEY=<the reCAPTCHA v3 secret from the Google admin console>
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.vercel.app
RESEND_API_KEY=<the API key from the Resend dashboard>
TRUSTED_PROXY_HOPS=1
```

All six of `SECRET_KEY`, `SESSION_TYPE`, `RECAPTCHA_SECRET_KEY`, `CORS_ALLOWED_ORIGINS`, `RESEND_API_KEY` and `TRUSTED_PROXY_HOPS` are **boot-time requirements**: the function refuses to start without them, so a deployment that is missing one serves nothing at all.
See [RELEASING.md](./RELEASING.md#pre-deploy-required-production-environment) for what each one defends and what an unset value would do.

`TRUSTED_PROXY_HOPS=1` is the right answer on Vercel: a request reaches the function through Vercel's own ingress, so the peer address Flask sees is the ingress, not the caller.
That address is what organizer signup reports to Google as reCAPTCHA's `remoteip`, and reCAPTCHA v3 scores on it - so a function that has not been told about the hop in front of it reports the same client for every signup in the world.
Do not raise it above the number of proxies you actually own: `X-Forwarded-For` is written by the caller, and a hop you do not own is a hop the caller fills in.

The three secrets above are written as `<...>` on purpose, and pasting one of those brackets in verbatim is refused: **every value this repository has printed where a secret goes is rejected by name**, along with anything shaped like a placeholder (a run of x's, a `your-` prefix).
This guide used to print `RESEND_API_KEY=your-resend-api-key` and `RECAPTCHA_SECRET_KEY=6Lcxxxxx...` as if they were fill-in values, and a placeholder is *truthy* - so a deployment that copied one passed the boot check with a secret that cannot do its job, and the failure landed later, as a 500 that named nothing.

`SECRET_KEY` must be **generated**, not typed: it refuses the old `TEMP_KEY_CHANGE_IN_PRODUCTION` fallback and every placeholder this repo has published, because each is readable by anyone who can read it.
It also refuses anything under 32 characters.
Setting it for the first time, or rotating it, ends every session signed with the old key - organizers log in again, once.

`SESSION_TYPE=null` is not optional on Vercel, and it is now a boot requirement rather than a default: a serverless function has no filesystem that outlives a request, so the on-disk session store raises at import there.
`null` installs no server-side store at all - Flask signs the session into the cookie, which is the only place a serverless function can keep one.
Nothing keys on `FLASK_ENV` any more - it defaulted to `development` in our own image, so every check that read it was exempting the deployments it existed for, and the old `SESSION_TYPE` default was derived from exactly that. Set the variables above by name instead.

#### Required on the front-end project (build-time):
```
VITE_RECAPTCHA_SITE_KEY=<the reCAPTCHA v3 site key from the same property as RECAPTCHA_SECRET_KEY above>
```

This is set on the **front end's** Vercel project, not this one, and it is the other half of the back end's `RECAPTCHA_SECRET_KEY`: the two must come from the same reCAPTCHA property.
Vite bakes it into the bundle at build time, so setting it later does nothing until the front end is rebuilt.

A front end deployed without it ships a bundle that has no captcha to solve and sends a placeholder token.
The back end no longer waves that through - it has a real secret now, and Google never issued that token - so `POST /register` answers 400 and **no organizer can sign up**, on a deployment that otherwise looks healthy.
`vite build` refuses to produce such a bundle for exactly that reason; the refusal names the variable.

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
FROM_EMAIL=your-verified-email@domain.com
```
`RESEND_API_KEY` belongs with the required variables above, not here: without it no organizer can register, verify an address, reset a password, or receive an OTP, so the app refuses to boot rather than serve that.

## Important Notes

### Session Storage
- **For Vercel**: Set `SESSION_TYPE=null` (the session is signed into the cookie; no server-side store is installed)
- **For a container or VM**: Set `SESSION_TYPE=filesystem` (sessions on local disk)
- There is **no default**, and an unset value is a boot refusal: neither answer is right for both hosts, and the one that used to be derived from `FLASK_ENV` was `filesystem` on every deployment built from our image - including the serverless ones that have no filesystem
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
     - `SECRET_KEY=` a value you generated with `python -c 'import secrets; print(secrets.token_urlsafe(48))'` - a placeholder or a value from this repo's history is refused
     - `SESSION_TYPE=null`
     - `FRONTEND_URL=https://your-frontend-domain.vercel.app`
     - `RESEND_API_KEY=` the key from your [Resend dashboard](https://resend.com/api-keys) - a placeholder such as `re_xxxxx` is refused
     - `FROM_EMAIL=your-verified-email@domain.com`
     - `RECAPTCHA_SECRET_KEY=` the secret from the [reCAPTCHA admin console](https://www.google.com/recaptcha/admin) - a placeholder such as `6Lcxxxxx` is refused
     - `CORS_ALLOWED_ORIGINS=https://your-frontend-domain.vercel.app`
     - `TRUSTED_PROXY_HOPS=1` - the Vercel ingress is one hop, and it is the reason `remote_addr` is not the caller's address here
   - **Note**: `MONGODB_URI` should already be set if you used the MongoDB Atlas integration
   - **Note**: `SECRET_KEY`, `SESSION_TYPE`, `RECAPTCHA_SECRET_KEY`, `CORS_ALLOWED_ORIGINS`, `RESEND_API_KEY` and `TRUSTED_PROXY_HOPS` are checked at import, and on a serverless function that runs on **every cold start**. Miss one and the function does not boot at all - it does not degrade, and no request is served; the log names every one that is missing. Set them **before** promoting, not after.
   - Apply to Production, Preview, and Development environments as needed

5. **Initialize / migrate the database** (before the first deploy, and before any deploy that carries a new migration)
   - The back end refuses to boot unless the market-key migration is recorded as applied, and that check runs at import - so on Vercel it runs on every cold start, and an unmigrated database fails every request rather than serving markets it can only half see.
   - `mongo-init.js` never runs against Atlas (it is the Docker Mongo entrypoint), so a freshly provisioned cluster has no marker. Run this once, from `back-end/`, with `MONGODB_URI` pointing at the Atlas cluster:
     ```bash
     python init_database.py                              # fresh cluster: creates collections and indexes, records the marker
     python migrations/migrate_market_keys.py             # existing data: rewrites markets under the canonical keys
     python migrations/create_applications_collection.py  # existing data: the applications collection and its `market_id` index
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
- **Session Issues**: Verify `SESSION_TYPE=null` is set for Vercel. There is no default - the function refuses to boot without it - and `filesystem` is a store a serverless function does not keep between requests.
- **CORS Issues**: Ensure `CORS_ALLOWED_ORIGINS` lists your frontend's origin exactly as the browser sends it (`https://your-frontend-domain.vercel.app` - scheme and host, no trailing slash, no path). A preview deployment served from a different domain is a different origin and has to be listed too. `FRONTEND_URL` is only used for the links in outgoing mail and has no say in CORS.
- **"Refusing to start: N of the things this app's public surface rests on are not configured"**: one or more of `SECRET_KEY`, `SESSION_TYPE`, `RECAPTCHA_SECRET_KEY`, `CORS_ALLOWED_ORIGINS`, `RESEND_API_KEY`, `TRUSTED_PROXY_HOPS` is unset. The log names every one of them, and each names what it defends, delivers or stores. Set them and redeploy; do not work around it by setting `ALLOW_INSECURE_LOCAL_DEV`, which turns all of that off. See [RELEASING.md](./RELEASING.md#pre-deploy-required-production-environment).
- **"`SECRET_KEY` is set to a value this repository has published"**: the key you set is one of the placeholders or fallbacks that appear in this repo (or its history), so it is readable by anyone who can read the repo. Generate a real one with `python -c 'import secrets; print(secrets.token_urlsafe(48))'`. This ends every session signed with the old key, so organizers log in again once - that is the cost of the key not being public.
- **"`RECAPTCHA_SECRET_KEY` / `RESEND_API_KEY` is set to a placeholder this repository has printed"**: the value you set is one of the example strings from an env template or an older version of this guide (`6Lcxxxxx...`, `re_xxxxx...`, `your-...`), not a secret an issuer ever gave you. Google and Resend both reject it, so the captcha would fail every signup and no verification mail would ever be delivered - a check that passed on a value nothing works with is the failure this refusal exists to move to boot time. Set the real key from the linked console, or, if this is a local machine, clear the variable and set `ALLOW_INSECURE_LOCAL_DEV=true` with `DISABLE_CAPTCHA=true` / `DISABLE_EMAIL=true`.
- **"The market-key migration has not been applied to this database"**: the function is refusing to boot because it cannot confirm the migration (see step 5 above). Run `migrations/migrate_market_keys.py` against the Atlas database and redeploy. The same error appears when the marker simply cannot be read - an unknown migration state is treated as unmigrated - so check network access too.
