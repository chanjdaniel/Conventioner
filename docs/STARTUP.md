# MakersMarketManagement - Development Startup Guide

This guide will help you set up and run the MakersMarketManagement application for development.

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
MakersMarketManagement/
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
- **Database**: `market_maker`
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
   pip install flask flask-session flask-login flask-bcrypt flask-cors pymongo pydantic
  ```
   Or if you have a `requirements.txt`:
4. Create necessary directories:
  ```bash
   mkdir -p flask_session csv_exports
  ```

## Step 3: Frontend Setup

1. Navigate to the frontend directory:
  ```bash
   cd front-end
  ```
2. Install Node.js dependencies:
  ```bash
   npm install
  ```
3. Configure environment variables:
  Create or verify `.env` file in `front-end/` directory:
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
2. **Create Market**: Click "New Market" and fill in the market details
3. **Upload CSV**: Upload a vendor CSV file with columns like:
  - Email
  - Vendor name
  - Market date preferences
  - Table preferences
  - Other vendor attributes
4. **Configure Market Setup**:
  - Select columns to include
  - Set up market dates
  - Configure tiers, locations, and sections
  - Set assignment priorities
5. **Generate Assignment**: Click "Assign" to run the assignment algorithm
6. **View Results**: Review the assignment statistics and vendor assignments

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

- Backend has CORS enabled with `supports_credentials=True`
- Ensure you're accessing frontend via `http://localhost` (not `127.0.0.1`)

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

### Backend Structure

- **API Routes**: Defined in `back-end/app.py`
- **API Modules**: `back-end/api/` (users, markets, source_data)
- **Assignment Logic**: `back-end/assignment/assignment.py`
- **Data Types**: `back-end/datatypes.py` (Pydantic models)
- **Database Config**: `back-end/db_config.py` (MongoDB connection)

### Frontend Structure

- **Views**: `front-end/src/views/`
- **Components**: `front-end/src/components/`
- **API Client**: `front-end/src/utils/api.ts`
- **Router**: `front-end/src/router/index.ts`

### Important Files

- **Backend Config**: `back-end/app.py` (Flask app configuration)
- **Frontend Config**: `front-end/vite.config.ts` (Vite proxy settings)
- **Environment**: `front-end/.env` (Frontend environment variables)
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