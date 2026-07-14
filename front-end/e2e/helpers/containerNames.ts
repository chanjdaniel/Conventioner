/**
 * Docker container name resolution for the e2e suite.
 *
 * The stack's container names are fixed in `docker-compose.yml` but worktree stacks
 * offset theirs in `docker-compose.worktree.yml` via `COMPOSE_PROJECT_NAME`. Every caller
 * that shells into a container reads the name from here so the override point is one place.
 *
 * Override via environment:
 *   E2E_MONGO_CONTAINER   - Mongo container name (default: conventioner_mongodb)
 *   E2E_BACKEND_CONTAINER - Backend container name (default: conventioner_backend)
 */

const DEFAULT_MONGO = 'conventioner_mongodb'
const DEFAULT_BACKEND = 'conventioner_backend'

export function mongoContainer(): string {
  return process.env.E2E_MONGO_CONTAINER || DEFAULT_MONGO
}

export function backendContainer(): string {
  return process.env.E2E_BACKEND_CONTAINER || DEFAULT_BACKEND
}
