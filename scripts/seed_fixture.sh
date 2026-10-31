#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEST_EMAIL="${TEST_EMAIL:-e2e@example.com}"
TEST_PASSWORD="${TEST_PASSWORD:-e2epassword123}"
# Verified user deliberately left without any organization, so e2e can exercise
# the zero-org state of the market-creation org picker.
NO_ORG_EMAIL="${NO_ORG_EMAIL:-e2e-noorg@example.com}"
NO_ORG_PASSWORD="${NO_ORG_PASSWORD:-e2enoorg123}"

# ── Which stack: told, never guessed ──
# This resets the stack's database before it seeds it, so it seeds only a stack it was told:
#   1) COMPOSE_PROJECT_NAME and the three TH_*_PORT variables, as `th-compose.sh ports` exports them
#   2) the treehouse slot this script's checkout sits in
#   3) --primary, the default stack: the primary checkout's, or CI's one stack
# and otherwise refuses. It used to fall back to the primary stack's defaults, so a run outside a
# slot that had not exported its own stack yet wiped the primary checkout's local database.
refuse() {
  echo "seed_fixture: $1 - refusing to guess, since this resets the stack's database." >&2
  echo "  For a stack th-compose.sh started: eval \"\$(scripts/th-compose.sh ports)\" first, which exports" >&2
  echo "    COMPOSE_PROJECT_NAME, TH_MONGO_PORT, TH_BACKEND_PORT and TH_FRONTEND_PORT." >&2
  echo "  In a treehouse worktree: run this checkout's own scripts/seed_fixture.sh, with none of them set." >&2
  echo "  For the default stack (the primary checkout's, or CI's): pass --primary, with none of them set." >&2
  exit 2
}

PRIMARY=false
for arg in "$@"; do
  case "$arg" in
    --primary) PRIMARY=true ;;
    *)
      echo "seed_fixture: unknown argument: $arg (usage: seed_fixture.sh [--primary])" >&2
      exit 2
      ;;
  esac
done

STACK_VARS=(COMPOSE_PROJECT_NAME TH_MONGO_PORT TH_BACKEND_PORT TH_FRONTEND_PORT)
SET_VARS=()
for var in "${STACK_VARS[@]}"; do
  if [ -n "${!var:-}" ]; then SET_VARS+=("$var"); fi
done
SLOT="$(printf '%s' "$PROJECT_DIR" | sed -nE 's#.*/\.treehouse/[^/]+/([0-9]+)/.*#\1#p')"

if [ "$PRIMARY" = true ]; then
  if [ "${#SET_VARS[@]}" -gt 0 ]; then
    refuse "--primary, but ${SET_VARS[*]} names another stack"
  fi
  DOCKER_CMD=(docker compose)
  BACKEND_PORT=5001
  FRONTEND_PORT=5173
  echo "Default stack, as --primary asks (ports: backend=$BACKEND_PORT, frontend=$FRONTEND_PORT)"
elif [ "${#SET_VARS[@]}" -eq "${#STACK_VARS[@]}" ]; then
  DOCKER_CMD=("$PROJECT_DIR/scripts/th-compose.sh")
  BACKEND_PORT="$TH_BACKEND_PORT"
  FRONTEND_PORT="$TH_FRONTEND_PORT"
  echo "Explicit stack identity: project=$COMPOSE_PROJECT_NAME (ports: backend=$BACKEND_PORT, frontend=$FRONTEND_PORT)"
elif [ "${#SET_VARS[@]}" -gt 0 ]; then
  refuse "the environment names only part of a stack (${SET_VARS[*]} set, not all of ${STACK_VARS[*]})"
elif [[ "$SLOT" =~ ^[0-9]+$ ]] && [ -x "$PROJECT_DIR/scripts/th-compose.sh" ]; then
  DOCKER_CMD=("$PROJECT_DIR/scripts/th-compose.sh")
  BACKEND_PORT=$((5001 + SLOT * 10))
  FRONTEND_PORT=$((5173 + SLOT * 10))
  echo "Worktree slot: $SLOT (ports: backend=$BACKEND_PORT, frontend=$FRONTEND_PORT)"
else
  refuse "no stack given: no stack variables are set and $PROJECT_DIR is not in a treehouse slot"
fi

BACKEND_URL="https://127.0.0.1:${BACKEND_PORT}"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"

COOKIE_JAR="$(mktemp /tmp/conventioner_seed.XXXXXX)"

cleanup() {
  rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

echo "=== Conventioner Seed Fixture ==="
echo ""

# ── 1. Ensure Docker stack is running ──
echo "[1/4] Ensuring Docker stack is up..."
cd "$PROJECT_DIR"
if ! "${DOCKER_CMD[@]}" ps --format '{{.Service}}' 2>/dev/null | grep -q 'backend'; then
  echo "  Bringing up Docker stack..."
  "${DOCKER_CMD[@]}" up -d --wait 2>&1 | sed 's/^/  /'
else
  echo "  Docker stack already running."
fi

# Wait for backend to accept connections
echo "  Waiting for backend..."
for _ in $(seq 1 30); do
  if curl -k -s -o /dev/null -w '%{http_code}' "$BACKEND_URL/" 2>/dev/null | grep -qE '^(200|404|401)'; then
    echo "  Backend ready."
    break
  fi
  sleep 1
done

# ── 2. Create test users ──
echo "[2/4] Creating test users ($TEST_EMAIL, $NO_ORG_EMAIL)..."
"${DOCKER_CMD[@]}" exec -T backend python /app/reset_database.py 2>&1 | sed 's/^/  /'
"${DOCKER_CMD[@]}" exec -T backend python /app/create_test_user.py "$TEST_EMAIL" "$TEST_PASSWORD" 2>&1 | sed 's/^/  /'
"${DOCKER_CMD[@]}" exec -T backend python /app/create_test_user.py "$NO_ORG_EMAIL" "$NO_ORG_PASSWORD" 2>&1 | sed 's/^/  /'

# ── 3. Login and get session ──
echo "[3/4] Logging in..."
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

# ── 3b. Create test organization ──
echo "[3b/4] Setting up test organization..."
ORG_CHECK=$(curl -k -s -b "$COOKIE_JAR" \
  -X GET "$BACKEND_URL/organizations" \
  -H "X-Owner-Email: $TEST_EMAIL")
ORG_COUNT=$(echo "$ORG_CHECK" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('organizations', [])))" 2>/dev/null || echo "0")
if [ "$ORG_COUNT" -eq 0 ]; then
  ORG_RESPONSE=$(curl -k -s -b "$COOKIE_JAR" \
    -X POST "$BACKEND_URL/organizations" \
    -H "Content-Type: application/json" \
    -H "X-Owner-Email: $TEST_EMAIL" \
    -d "{\"name\": \"Seed Test Org\"}")
  echo "  $ORG_RESPONSE"
  ORG_ID=$(echo "$ORG_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['organization_id'])" 2>/dev/null || echo "")
  if [ -z "$ORG_ID" ]; then
    echo "  ERROR: Could not create test organization"
    exit 1
  fi
  echo "  Organization ID: $ORG_ID"
else
  echo "  User already has $ORG_COUNT organization(s), skipping creation."
  ORG_ID=$(echo "$ORG_CHECK" | python3 -c "import sys,json; print(json.load(sys.stdin)['organizations'][0]['id'])" 2>/dev/null || echo "")
  if [ -z "$ORG_ID" ]; then
    echo "  ERROR: Could not extract existing organization ID"
    exit 1
  fi
  echo "  Organization ID: $ORG_ID"
fi

# ── 4. Create a market ──
echo "[4/4] Creating market..."
MARKET_NAME="Seed Market $(date +%H%M%S)"
CREATE_RESPONSE=$(curl -k -s -b "$COOKIE_JAR" \
  -X POST "$BACKEND_URL/markets" \
  -H "Content-Type: application/json" \
  -H "X-Owner-Email: $TEST_EMAIL" \
  -d "{
    \"name\": \"$MARKET_NAME\",
    \"creationDate\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"organizationId\": \"$ORG_ID\",
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

# ── Done ──
echo ""
echo "=== Seed complete ==="
echo "Frontend:  $FRONTEND_URL"
echo "Backend:   $BACKEND_URL"
echo "Email:     $TEST_EMAIL"
echo "Password:  $TEST_PASSWORD"
echo "No-org:    $NO_ORG_EMAIL / $NO_ORG_PASSWORD (verified, belongs to no organization)"
echo "Market ID: $MARKET_ID"
echo ""
echo "Next: open $FRONTEND_URL/login and log in to configure the market."
