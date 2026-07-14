# Conventioner - Development Startup Guide

This guide will help you set up and run the Conventioner application for development.

## Prerequisites

Before starting, ensure you have the following installed:

- **Docker** and **Docker Compose** (recommended - see Docker Setup below)
  - OR **Python 3.8+**, **Node.js 18+**, and **MongoDB** (for local development)

## Quick Start with Docker (Recommended)

The easiest way to get started is using Docker Compose:

1. **Start all services**:
  ```bash
   docker-compose up
  ```
2. **Access the application**:
  - Frontend: [http://localhost:5173](http://localhost:5173)
  - Backend API: [https://localhost:5000](https://localhost:5000)
  - MongoDB: localhost:27017
3. **Stop all services**:
  ```bash
   docker-compose down
  ```
4. **View logs**:
  ```bash
   docker-compose logs -f [service_name]  # e.g., backend, frontend, mongodb
  ```
5. **Rebuild after code changes**:
  ```bash
   docker-compose up --build
  ```

That's it! The Docker setup handles all dependencies automatically.

---

## Local Development Setup (Without Docker)

If you prefer to run services locally without Docker:

## Project Structure

```
Conventioner/
├── back-end/          # Flask backend API
│   ├── Dockerfile     # Backend Docker image
│   ├── requirements.txt
│   └── db_config.py   # MongoDB connection config
├── front-end/         # Vue 3 frontend application
│   ├── Dockerfile     # Frontend Docker image
│   └── package.json
├── docker-compose.yml # Docker Compose configuration
└── STARTUP.md         # This file
```

## Step 1: MongoDB Setup

The application requires MongoDB to be running. The backend connects to:

- **Host**: `localhost:27017` (or `mongodb` in Docker)
- **Database**: `conventioner`
- **Authentication**: `admin:secret` (default development credentials)

### Option A: Local MongoDB Installation

1. Install MongoDB Community Edition:
  ```bash
   # Ubuntu/Debian
   sudo apt-get install mongodb
   # macOS (using Homebrew)
   brew install mongodb-community

   # Or download from https://www.mongodb.com/try/download/community
  ```
2. Start MongoDB:
  ```bash
   # Linux
   sudo systemctl start mongod

   # macOS
   brew services start mongodb-community

   # Or manually
   mongod --dbpath /path/to/data/directory
  ```
3. Create admin user (if not already created):
  ```bash
   mongosh
   use admin
   db.createUser({
     user: "admin",
     pwd: "secret",
     roles: [ { role: "root", db: "admin" } ]
   })
  ```

### Option B: Docker MongoDB (Quick Setup)

```bash
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=secret \
  mongo:latest
```

## Step 2: Backend Setup

1. Navigate to the backend directory:
  ```bash
   cd back-end
  ```
2. Create a Python virtual environment (recommended):
  ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
  ```
3. Install Python dependencies:
  ```bash
   pip install -r requirements.txt
  ```
   Install the file, not a hand-listed subset: `app.py` imports the floorplan and email modules on the way up, and `python-dotenv` is what reads the `.env` you write in step 5.
4. Create necessary directories:
  ```bash
   mkdir -p flask_session csv_exports
  ```
5. Create the environment file:
  ```bash
   cp .env.example .env
  ```
   The template boots as it stands - no keys to go and fetch, no accounts to sign up for.
   `app.py` loads `back-end/.env` on the first line it runs (`back-end/utils/env_file.py`), and anything already set in the environment wins over the file, so a variable you export by hand is never shadowed by it.
   The template works because it sets `ALLOW_INSECURE_LOCAL_DEV=true`, which is what lets a process start without the six variables a deployment must set (`SECRET_KEY`, `RECAPTCHA_SECRET_KEY`, `CORS_ALLOWED_ORIGINS`, `RESEND_API_KEY`, `SESSION_TYPE`, `TRUSTED_PROXY_HOPS`), and which names in the log everything it turns off.
   Sessions are then signed with a random per-process key, so restarting the back end logs you out; set `SECRET_KEY` to a generated value if that gets annoying.
   Never set `ALLOW_INSECURE_LOCAL_DEV` on a deployed environment - see [RELEASING.md](./RELEASING.md#pre-deploy-required-production-environment).
6. Initialize the database:
  ```bash
   python init_database.py
  ```
   This creates the collections and records the market-document migration markers.
   The back end refuses to boot without both markers (see Troubleshooting below), and a MongoDB you started yourself has never run `back-end/mongo-init.js`, which is what records them for the Docker stack.
   Re-running it is harmless.

## Step 3: Frontend Setup

1. Navigate to the frontend directory:
  ```bash
   cd front-end
  ```
2. Install Node.js dependencies:
  ```bash
   npm install
  ```
3. Create the environment file:
  ```bash
   cp .env.example .env
  ```
   The template builds as it stands, and without it `npm run build` refuses: `vite build` will not produce a bundle with no `VITE_RECAPTCHA_SITE_KEY`, because such a bundle sends a placeholder captcha token that a deployed back end verifies against Google and Google rejects - every organizer signup a 400, on a front end that looks fine.
   The template works because it sets `VITE_ALLOW_INSECURE_LOCAL_DEV=true`, the front-end half of the back end's `ALLOW_INSECURE_LOCAL_DEV`, and each build it lets through says so in a warning.
   A bundle built that way only works against a back end that has also been told it is a local development one (`DISABLE_CAPTCHA=true`); never deploy one.
   Vite reads `front-end/.env` only - it never reads `.env.example` - so a checkout that has not copied it has nothing set.
   Note: The frontend uses Vite's proxy to forward `/api` requests to the backend.

## Step 4: Running the Application

### Terminal 1: Start MongoDB (if not running as a service)

```bash
# If using Docker
docker start mongodb

# Or start MongoDB service
sudo systemctl start mongod  # Linux
brew services start mongodb-community  # macOS
```

### Terminal 2: Start Backend Server

```bash
cd back-end

# Activate virtual environment if using one
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Run Flask with HTTPS (adhoc certificate)
flask run --cert=adhoc

# Or redirect errors to log file
flask run --cert=adhoc > error.log 2>&1
```

The backend will start on: **[https://127.0.0.1:5000](https://127.0.0.1:5000)**

**Note**: The app uses HTTPS with an adhoc (self-signed) certificate. Your browser will show a security warning - this is expected in development. Click "Advanced" → "Proceed to 127.0.0.1" to continue.

### Terminal 3: Start Frontend Development Server

```bash
cd front-end
npm run dev
```

The frontend will start on: **[http://localhost:5173](http://localhost:5173)** (or another port if 5173 is busy)

## Step 5: Access the Application

1. Open your browser and navigate to: **[http://localhost:5173](http://localhost:5173)**
2. Accept the SSL certificate warning if prompted (for the backend HTTPS connection)
3. You should see the login page

## Step 6: Testing the Application

> **Automated test suites and a one-command seed fixture are documented in [TESTING.md](./TESTING.md).**
> For a ready-to-use test environment (Docker stack + test users + test organization + seeded market + sample CSV), run `./scripts/seed_fixture.sh` from the repository root.

### Create a Test User

You can register a user via the UI or using curl:

```bash
curl -k -X POST https://127.0.0.1:5000/register-user \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpassword",
    "organizations": [],
    "markets": []
  }'
```

### Basic Workflow Test

1. **Login**: Use the credentials you just created
2. **Create Organization**: Open "Organizations" and create one. Every market belongs to an organization, so a brand-new user must do this before they can create a market. The new-market form links here when you have no organizations.
3. **Create Market**: Click "New Market", select the organization, and fill in the market details. Submission stays disabled until an organization is selected.
4. **Upload CSV**: Upload a vendor CSV file with columns like:
  - Email
  - Vendor name
  - Market date preferences
  - Table preferences
  - Other vendor attributes
5. **Configure Market Setup**:
  - Select columns to include
  - Set up market dates
  - Configure tiers, locations, and sections
  - Set assignment priorities
6. **Generate Assignment**: Click "Assign" to run the assignment algorithm
7. **View Results**: Review the assignment statistics and vendor assignments

### Discord Webhook Setup

The market owner can post the assignment summary to a Discord channel via a per-market webhook URL.

1. In Discord, open the target server and go to **Server Settings → Integrations → Webhooks**.
2. Click **New Webhook**, choose the destination channel, optionally rename the webhook, then click **Copy Webhook URL**.
3. In Conventioner, open the market in **Market Setup** and paste the URL into the **Discord webhook URL** field. The URL is saved with the market on the next save action.
4. After running an assignment, open **Assignment Results** and click **Send to Discord**. The summary (assignments, vendors, tables, satisfaction, top sections, unassigned counts) is posted to the configured channel.

The webhook URL is stored per-market and treated as a secret; it is never logged. Leaving the field blank disables the **Send to Discord** button.

## Troubleshooting

### Docker Issues

**Services won't start**:

```bash
# Check if ports are already in use
docker-compose ps
lsof -i :5000  # Check port 5000
lsof -i :5173  # Check port 5173
lsof -i :27017 # Check port 27017

# Remove old containers
docker-compose down
docker system prune -f
```

**MongoDB connection errors in Docker**:

- Ensure MongoDB container is healthy: `docker-compose ps`
- Check MongoDB logs: `docker-compose logs mongodb`
- Wait for MongoDB to be fully initialized (healthcheck passes)

**Backend can't connect to MongoDB**:

- Verify MongoDB service name is `mongodb` in docker-compose.yml
- Check environment variables in docker-compose.yml
- Ensure both services are on the same network

**Frontend can't connect to backend**:

- Verify backend is running: `docker-compose logs backend`
- Check VITE_BACKEND_URL environment variable
- Ensure proxy configuration in vite.config.ts is correct

**Rebuild after dependency changes**:

```bash
docker-compose build --no-cache
docker-compose up
```

**Backend crash-loops with "`SECRET_KEY` / `RESEND_API_KEY` / `RECAPTCHA_SECRET_KEY` is set to a placeholder this repository has printed"**:

An `.env` you already have was copied from an older template that printed `SECRET_KEY=your-secret-key-here-change-in-production`, `RESEND_API_KEY=re_xxxxxxxx...` and `RECAPTCHA_SECRET_KEY=6Lcxxxxx...` as if they were fill-in values.
They never worked - Resend rejects that key, Google never issued that secret, and the signing key is one `git log` away from anybody - but they are *truthy*, so the app took them for configured secrets and the failure landed at request time (a 500 per signup, a captcha verified against a key that cannot verify anything) or, for the signing key, never at all.
They are refused by name at boot now, on a laptop as on a deployment, escape hatch or not, so the failure lands where it can be read.

**Two files can carry them, and the message does not say which one it read.** Check both:

- **`back-end/.env`** - the file `cp .env.example .env` writes in step 5 of Backend Setup. Nothing read it before this change, so a stale one has been sitting there harmlessly; it is loaded now (`back-end/utils/env_file.py`), which is what makes it able to stop the process. This is the one you meet when you run the back end directly. `back-end/.env.example` ships the shape that boots.
- **`.env` at the repository root** - what `docker-compose.yml` reads. This is the one you meet under `docker compose up`. `.env.example` at the root ships the shape that boots.

In whichever file holds them, blank the secrets and leave the bypasses beside them on:

```bash
SECRET_KEY=
RESEND_API_KEY=
RECAPTCHA_SECRET_KEY=
DISABLE_EMAIL=true
DISABLE_CAPTCHA=true
```

In `back-end/.env` add `ALLOW_INSECURE_LOCAL_DEV=true` as well, which is what lets a process start with those blanks.
Under `docker compose` you do not need it: `docker-compose.yml` sets it for the container.

Both templates now ship exactly that shape, so `cp .env.example .env` - at the root, in `back-end/`, or both - is the other way out.
A blank secret plus the escape hatch is what boots; a placeholder where a secret goes is what passes a check that asks only whether the variable is set, and then fails later, naming none of it.

**Backend exits at startup with "Refusing to start: ... are not configured" (naming `SECRET_KEY`, `CORS_ALLOWED_ORIGINS`, `SESSION_TYPE`, ...)**:

The six variables the refusal names are boot-time requirements, and nothing in this repository supplies a default for them - a security control keyed on a variable whose default is the insecure value is not a control (see [RELEASING.md](./RELEASING.md#pre-deploy-required-production-environment)).
Running under `docker-compose`, that is already handled: the compose file sets `ALLOW_INSECURE_LOCAL_DEV=true`.
Running the back end directly, it means the process has no `.env` to read: do step 5 of Backend Setup (`cd back-end && cp .env.example .env`), which sets the same escape hatch.

**Backend exits at startup with "The market-document migration has not been applied to this database"**:

The back end refuses to boot against a database whose market documents may not be in canonical form (legacy snake_case keys, or missing the stored slug), because it reads the canonical camelCase key only and the public slug lookup queries the stored slug - an unmigrated market would be invisible at every public URL, with nothing logged.
A Mongo volume created before the migration existed has no markers, so an existing dev stack hits this the first time it pulls the change.
The migration is the whole fix: it runs against an existing database, rewrites the documents into canonical form, builds the slug index, and records both markers itself.

```bash
docker compose run --rm backend python migrations/migrate_market_keys.py
docker compose up backend
```

Use `run`, not `exec`: the back-end container is crash-looping, so there is nothing to attach to.
`run` starts a throwaway container (with MongoDB already up as its dependency) and passes the command straight through the entrypoint.
Add `--dry-run` to the migration to preview the changes without applying them.

**A market you published before now reads as a draft: its check-in URL 404s, and opening it drops you back into the setup wizard**:

The market lifecycle is now driven by `phase`, and every read derives the market's state from it.
Publishing used to be a `PUT` of `isDraft: false`, which never moved the phase - so a market published by the older build sits at `phase: "draft"` with `isDraft: false`.
`draft` is a phase this build recognizes, so it is taken at face value and the market reverts to looking unpublished: the public slug lookup, which serves markets past `draft` only, returns `404`, and the SPA routes the organizer to market setup instead of the market's public page.
The migration advances those markets to `archived`, resolving the disagreement in favour of `isDraft` (on those documents it was the only publish signal that existed):

```bash
docker compose exec backend python migrations/migrate_is_draft_consistency.py
```

Unlike the market-key migration this one does not gate boot, so nothing forces it - run it against any database with markets predating the change.
It is idempotent, and `--dry-run` previews the changes without applying them.

### Backend Issues

**MongoDB Connection Error**:

- Verify MongoDB is running: `mongosh --eval "db.adminCommand('ping')"`
- Check connection configuration in `back-end/db_config.py`
- Environment variables (or defaults): `MONGODB_HOST`, `MONGODB_PORT`, `MONGODB_USER`, `MONGODB_PASSWORD`
- Default: `mongodb://admin:secret@localhost:27017/admin`

**Port 5000 Already in Use**:

```bash
# Find process using port 5000
lsof -i :5000  # macOS/Linux
netstat -ano | findstr :5000  # Windows

# Kill the process or use a different port
flask run --cert=adhoc --port=5001
```

**SSL Certificate Warnings**:

- This is expected with `--cert=adhoc`. The browser will show a warning - accept it for development.

**Session Folder Missing**:

```bash
cd back-end
mkdir -p flask_session
```

### Frontend Issues

**Cannot Connect to Backend**:

- Verify backend is running on `https://127.0.0.1:5000`
- Check `front-end/vite.config.ts` proxy configuration
- Verify `.env` file has `VITE_FLASK_HOST=/api`

**Port 5173 Already in Use**:

- Vite will automatically use the next available port
- Check the terminal output for the actual port number

**CORS Errors**:

- The back end answers credentialed requests only from the origins in `CORS_ALLOWED_ORIGINS`. `docker-compose.yml` leaves it empty and sets `ALLOW_INSECURE_LOCAL_DEV`, which allows any loopback origin (`localhost` or `127.0.0.1`, any port) - so a front end served from anywhere else needs its origin listed
- Running the back end outside `docker-compose` means setting one of the two yourself; without either it refuses to boot, and the log says so

### MongoDB Issues

**Authentication Failed**:

- Verify admin user exists: `mongosh -u admin -p secret --authenticationDatabase admin`
- Or recreate the admin user (see Step 1)

**Database Not Found**:

- Databases are created automatically on first use
- Verify MongoDB is running and accessible

## Development Notes

### Docker Services

The `docker-compose.yml` defines three services:

1. **mongodb**: MongoDB database
  - Port: `27017`
  - Data persisted in Docker volume `mongodb_data`
  - Credentials: `admin:secret`
2. **backend**: Flask API server
  - Port: `5000` (HTTPS with adhoc certificate)
  - Hot-reload enabled via volume mount
  - Sessions and CSV exports persisted in volumes
3. **frontend**: Vue 3 development server
  - Port: `5173`
  - Hot-reload enabled via volume mount
  - Proxies `/api` requests to backend

### Environment Variables

**Backend** (set in docker-compose.yml):

- `MONGODB_HOST`: MongoDB service name (default: `mongodb`)
- `MONGODB_PORT`: MongoDB port (default: `27017`)
- `MONGODB_USER`: MongoDB username (default: `admin`)
- `MONGODB_PASSWORD`: MongoDB password (default: `secret`)

**Frontend** (set in docker-compose.yml):

- `VITE_FLASK_HOST`: API base path (default: `/api`)
- `VITE_BACKEND_URL`: Backend URL for Vite proxy (default: `https://backend:5000`)

### Vision AI Setup (Optional)

The floorplan feature includes AI-powered auto-detection of table placements. This is **optional** — the floorplan editor works without these keys, but the automatic table detection feature will be disabled.

1. **Gemini API Key**: Visit [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign in with your Google account, and click **Create API Key**. Copy the key and set `GEMINI_API_KEY` in your `.env`.
2. **OpenAI API Key**: Visit [platform.openai.com/api-keys](https://platform.openai.com/api-keys), sign in, and click **Create new secret key**. Copy the key and set `OPENAI_API_KEY` in your `.env`.

Both keys are configured in `.env` and forwarded to the backend via `docker-compose.yml`. If neither key is set, the AI auto-detection button is hidden in the UI and the floorplan editor behaves as a manual layout tool.

### Backend Structure

- **API Routes**: Defined in `back-end/app.py`
- **API Modules**: `back-end/api/` (users, markets, source_data)
- **Assignment Logic**: `back-end/assignment/assignment.py`
- **Data Types**: `back-end/datatypes.py` (Pydantic models)
- **Phase Guards**: `back-end/guards.py` (every precondition for every market phase transition)
- **Market Documents**: `back-end/market_documents.py` (canonical market document form - camelCase keys + stored slug - and the migration markers the app boots on)
- **Database Config**: `back-end/db_config.py` (MongoDB connection)

### Frontend Structure

- **Views**: `front-end/src/views/`
- **Components**: `front-end/src/components/`
- **API Client**: `front-end/src/utils/api.ts`
- **Router**: `front-end/src/router/index.ts`

### Important Files

- **Backend Config**: `back-end/app.py` (Flask app configuration)
- **Frontend Config**: `front-end/vite.config.ts` (Vite proxy settings)
- **Environment**: `back-end/.env` (loaded by `back-end/utils/env_file.py`) and `front-end/.env` (read by Vite); copy each from its `.env.example`
- **Docker Compose**: `docker-compose.yml` (Service orchestration)

### CSV Export Location

- Assignment CSV files are saved to: `back-end/csv_exports/`
- Files are named: `{market_name}_assigned.csv`
- In Docker: Persisted in volume `backend_csv`

### Generate Shared Market Contract

Use the schema utility to regenerate the backend/frontend contract declaration directly from backend Pydantic contract types.

1. Run from the repository root:
  ```bash
   python back-end/generate_market_schema.py \
     --output docs/schema.d.ts
  ```
2. The generated contract will be written to:
  - `docs/schema.d.ts`

### Discord Webhook Setup (per market)

The Conventioner UI lets a market owner post the assignment summary to a Discord channel. No bot or token is required — Conventioner uses incoming webhooks.

1. In Discord, open the target server → **Server Settings → Integrations → Webhooks → New Webhook**.
2. Pick the channel that should receive the assignment summary, click **Copy Webhook URL**.
3. In Conventioner, open the market → **Market Setup → Discord webhook URL** field → paste the URL → save.
4. From **Assignment Results**, click **Send to Discord** to post the summary. The webhook URL is stored per market and is not part of the global `.env`.

Webhook URLs are sensitive — anyone with the URL can post to the channel. Treat them like a password and rotate via Discord if leaked.

## Next Steps

Once the application is running:

1. Review the [TODO.md](./TODO.md) for remaining features
2. Check the codebase for implementation details
3. Explore the API endpoints via the browser dev tools Network tab
4. Test the assignment algorithm with sample vendor data

## Additional Resources

- **Flask Documentation**: [https://flask.palletsprojects.com/](https://flask.palletsprojects.com/)
- **Vue 3 Documentation**: [https://vuejs.org/](https://vuejs.org/)
- **MongoDB Documentation**: [https://docs.mongodb.com/](https://docs.mongodb.com/)
- **Vite Documentation**: [https://vitejs.dev/](https://vitejs.dev/)

---

**Happy Coding!** 🚀