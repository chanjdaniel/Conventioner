#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"
COOKIE_JAR="$(mktemp /tmp/conventioner_seed.XXXXXX)"
TEST_EMAIL="${TEST_EMAIL:-e2e@example.com}"
TEST_PASSWORD="${TEST_PASSWORD:-e2epassword123}"
CSV_FILE="${FIXTURES_DIR}/vendors.csv"

# ── Detect worktree vs primary checkout ──
SLOT="$(printf '%s' "$PROJECT_DIR" | sed -nE 's#.*/\.treehouse/[^/]+/([0-9]+)/.*#\1#p')"
if [[ "$SLOT" =~ ^[0-9]+$ ]] && [ -x "$PROJECT_DIR/scripts/th-compose.sh" ]; then
  DOCKER_CMD=("$PROJECT_DIR/scripts/th-compose.sh")
  BACKEND_PORT=$((5000 + SLOT * 10))
  FRONTEND_PORT=$((5173 + SLOT * 10))
  echo "Worktree slot: $SLOT (ports: backend=$BACKEND_PORT, frontend=$FRONTEND_PORT)"
else
  DOCKER_CMD=(docker compose)
  BACKEND_PORT=5000
  FRONTEND_PORT=5173
  echo "Primary checkout (default ports)"
fi

BACKEND_URL="https://localhost:${BACKEND_PORT}"
FRONTEND_URL="http://localhost:${FRONTEND_PORT}"

cleanup() {
  rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

echo "=== Conventioner Seed Fixture ==="
echo ""

# ── 1. Ensure Docker stack is running ──
echo "[1/5] Ensuring Docker stack is up..."
cd "$PROJECT_DIR"
if ! "${DOCKER_CMD[@]}" ps --format '{{.Service}}' 2>/dev/null | grep -q 'backend'; then
  echo "  Bringing up Docker stack..."
  "${DOCKER_CMD[@]}" up -d --wait 2>&1 | sed 's/^/  /'
else
  echo "  Docker stack already running."
fi

# Wait for backend to accept connections
echo "  Waiting for backend..."
for i in $(seq 1 30); do
  if curl -k -s -o /dev/null -w '%{http_code}' "$BACKEND_URL/" 2>/dev/null | grep -qE '^(200|404|401)'; then
    echo "  Backend ready."
    break
  fi
  sleep 1
done

# ── 2. Create test user ──
echo "[2/5] Creating test user ($TEST_EMAIL)..."
"${DOCKER_CMD[@]}" exec -T backend python /app/reset_database.py 2>&1 | sed 's/^/  /'
"${DOCKER_CMD[@]}" exec -T backend python /app/create_test_user.py "$TEST_EMAIL" "$TEST_PASSWORD" 2>&1 | sed 's/^/  /'

# ── 3. Login and get session ──
echo "[3/5] Logging in..."
LOGIN_RESPONSE=$(curl -k -s -c "$COOKIE_JAR" \
  -X POST "$BACKEND_URL/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$TEST_EMAIL\", \"password\": \"$TEST_PASSWORD\"}")
echo "  $LOGIN_RESPONSE"

USER_ID=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['user_data']['id'])" 2>/dev/null || echo "")
if [ -z "$USER_ID" ]; then
  echo "  ERROR: Could not extract user ID from login response"
  exit 1
fi
echo "  User ID: $USER_ID"

# ── 4. Create a market ──
echo "[4/5] Creating market..."
MARKET_NAME="Seed Market $(date +%H%M%S)"
CREATE_RESPONSE=$(curl -k -s -b "$COOKIE_JAR" \
  -X POST "$BACKEND_URL/markets" \
  -H "Content-Type: application/json" \
  -H "X-Owner-Email: $TEST_EMAIL" \
  -d "{
    \"name\": \"$MARKET_NAME\",
    \"creationDate\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"roles\": {\"$USER_ID\": \"owner\"},
    \"modificationList\": [],
    \"assignmentObject\": {}
  }")
echo "  $CREATE_RESPONSE"

MARKET_ID=$(echo "$CREATE_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['market_id'])" 2>/dev/null || echo "")
if [ -z "$MARKET_ID" ]; then
  echo "  ERROR: Could not extract market ID from create response"
  exit 1
fi
echo "  Market ID: $MARKET_ID"

# ── 5. Upload CSV fixture ──
echo "[5/5] Uploading CSV fixture..."
UPLOAD_RESPONSE=$(curl -k -s -b "$COOKIE_JAR" \
  -X POST "$BACKEND_URL/source-data/$MARKET_ID" \
  -H "X-Owner-Email: $TEST_EMAIL" \
  -F "file=@$CSV_FILE")
echo "  $UPLOAD_RESPONSE"

# ── Done ──
echo ""
echo "=== Seed complete ==="
echo "Frontend:  $FRONTEND_URL"
echo "Backend:   $BACKEND_URL"
echo "Email:     $TEST_EMAIL"
echo "Password:  $TEST_PASSWORD"
echo "Market ID: $MARKET_ID"
echo ""
echo "Next: open $FRONTEND_URL/login and log in to configure the market."
echo "      The CSV has already been uploaded — go to Market Setup to configure columns."
