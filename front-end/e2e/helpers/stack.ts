/**
 * Single source of truth for stack identity.
 *
 * Detects the treehouse worktree slot and derives every port, container name,
 * and URL from it — exactly matching the conventions in `scripts/th-compose.sh`
 * and `docker-compose.worktree.yml`.
 *
 * Three consumers import from here instead of maintaining their own detection
 * or hard-coded defaults:
 *   - `playwright.config.ts`                 (frontend port)
 *   - `e2e/fixtures.ts`                      (BACKEND_URL)
 *   - `e2e/helpers/containerNames.ts`        (DB/backend container names)
 *
 * ## Detection order
 *
 * 1. `TH_BACKEND_PORT` / `COMPOSE_PROJECT_NAME` from `th-compose.sh`
 *    — authoritative for treehouse worktree stacks.
 * 2. `.treehouse` CWD regex — slot-based worktree detection (fallback when
 *    th-compose.sh vars are not exported to the current shell).
 * 3. `CI=true` — CI is genuinely single-stack; project name derived from
 *    `COMPOSE_PROJECT_NAME` or CWD basename (same default Docker Compose uses).
 *
 * If NONE of these identify the stack, `detectStack()` throws with a clear
 * remediation message. A silent fallback to the primary stack is precisely the
 * defect that corrupted shared databases and made local E2E meaningless in
 * worktrees. Consumers that accept environment-variable overrides
 * (`BACKEND_URL`, `E2E_BACKEND_CONTAINER`, `FRONTEND_PORT`) check those
 * BEFORE calling `stack()`, so they serve as the escape hatch.
 *
 * ## Conventions
 *
 * Primary-checkout / CI (no worktree slot, no container_name in compose):
 *   ports:     mongo=27017  backend=5000  frontend=5173
 *   containers: <project>-mongodb-1  <project>-backend-1  (auto-named by Compose)
 *
 * Worktree slot N (offset = N * 10):
 *   ports:     mongo=27017+N*10  backend=5000+N*10  frontend=5173+N*10
 *   containers: conventioner-N-mongodb  conventioner-N-backend
 */

import fs from 'fs';
import path from 'path';

export interface StackIdentity {
  /** Treehouse slot number, or null for CI. */
  slot: number | null;
  /** docker compose project name (e.g. "conventioner-2" or "conventioner"). */
  projectName: string;
  /** Host-facing backend port (e.g. 5020). */
  backendPort: number;
  /** Host-facing frontend port (e.g. 5193). */
  frontendPort: number;
  /** Host-facing MongoDB port (e.g. 27037). */
  mongoPort: number;
  /** Container name for the backend service. */
  backendContainerName: string;
  /** Container name for the MongoDB service. */
  mongoContainerName: string;
  /** Full backend URL including scheme and port. */
  backendURL: string;
}

function detectSlotFromCwd(): number | null {
  const cwd = process.cwd();
  const match = cwd.match(/\.treehouse\/[^/]+\/(\d+)\//);
  return match ? parseInt(match[1], 10) : null;
}

function worktreeIdentity(slot: number): StackIdentity {
  const offset = slot * 10;
  const projectName = `conventioner-${slot}`;
  return {
    slot,
    projectName,
    backendPort: 5000 + offset,
    frontendPort: 5173 + offset,
    mongoPort: 27017 + offset,
    backendContainerName: `${projectName}-backend`,
    mongoContainerName: `${projectName}-mongodb`,
    backendURL: `https://localhost:${5000 + offset}`,
  };
}

/** Derive Compose project name from env or project root — same default Docker Compose uses. */
function deriveProjectName(): string {
  if (process.env.COMPOSE_PROJECT_NAME) {
    return process.env.COMPOSE_PROJECT_NAME;
  }
  // Walk up from CWD to find docker-compose.yml to locate the Compose project root.
  // This handles CI where tests run from a subdirectory (front-end/) but Compose
  // runs from the repo root, so CWD basename would be wrong.
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, 'docker-compose.yml'))) {
      return path.basename(dir).toLowerCase();
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.basename(process.cwd()).toLowerCase();
}

function ciIdentity(): StackIdentity {
  const projectName = deriveProjectName();
  return {
    slot: null,
    projectName,
    backendPort: 5000,
    frontendPort: 5173,
    mongoPort: 27017,
    backendContainerName: `${projectName}-backend-1`,
    mongoContainerName: `${projectName}-mongodb-1`,
    backendURL: 'https://localhost:5000',
  };
}

const FAIL_LOUD_MESSAGE =
  'E2E stack identity could not be determined — refusing to guess.\n' +
  'In a treehouse worktree, run tests via `scripts/th-compose.sh` which\n' +
  'exports TH_BACKEND_PORT, TH_FRONTEND_PORT, and COMPOSE_PROJECT_NAME.\n' +
  'Otherwise, set FRONTEND_PORT, BACKEND_URL (e.g. https://localhost:5173,\n' +
  'https://localhost:5000) and E2E_BACKEND_CONTAINER /\n' +
  'E2E_MONGO_CONTAINER explicitly.\n' +
  'A silent fallback to the primary stack corrupts shared databases\n' +
  'and produces meaningless test results.';

export function detectStack(): StackIdentity {
  // 1. th-compose.sh exports are authoritative for worktree stacks.
  const thBackendPort = process.env.TH_BACKEND_PORT;
  const composeProject = process.env.COMPOSE_PROJECT_NAME;
  if (thBackendPort && composeProject) {
    const backendPort = parseInt(thBackendPort, 10);
    const frontendPort = parseInt(process.env.TH_FRONTEND_PORT ?? '', 10) || 0;
    const mongoPort = parseInt(process.env.TH_MONGO_PORT ?? '', 10) || 0;
    const slotMatch = composeProject.match(/^conventioner-(\d+)$/);
    const slot = slotMatch ? parseInt(slotMatch[1], 10) : null;
    // Derive from the authoritative vars, filling gaps with slot offset.
    const offset = slot !== null ? slot * 10 : backendPort - 5000;
    return {
      slot,
      projectName: composeProject,
      backendPort,
      frontendPort: frontendPort || 5173 + offset,
      mongoPort: mongoPort || 27017 + offset,
      backendContainerName: `${composeProject}-backend`,
      mongoContainerName: `${composeProject}-mongodb`,
      backendURL: `https://localhost:${backendPort}`,
    };
  }

  // 2. Treehouse worktree detected from CWD path.
  const slot = detectSlotFromCwd();
  if (slot !== null) {
    return worktreeIdentity(slot);
  }

  // 3. CI is genuinely single-stack.
  if (process.env.CI) {
    return ciIdentity();
  }

  // 4. Ambiguous — refuse to guess.
  throw new Error(FAIL_LOUD_MESSAGE);
}

/** Singleton — compute once per process. */
let _cached: StackIdentity | null = null;

export function stack(): StackIdentity {
  if (!_cached) {
    _cached = detectStack();
  }
  return _cached;
}
