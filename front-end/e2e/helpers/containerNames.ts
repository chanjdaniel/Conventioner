/**
 * Docker container name resolution for the e2e suite.
 *
 * The primary/CI stack has no explicit `container_name` in `docker-compose.yml`;
 * Docker Compose auto-names them as `<project>-<service>-1`. Worktree stacks
 * override names in `docker-compose.worktree.yml` via `COMPOSE_PROJECT_NAME`.
 * Every caller that shells into a container reads the name from here so the
 * override point is one place.
 *
 * Both functions delegate to `stack.ts` for the default value, so worktree-aware
 * detection is shared with playwright.config.ts and fixtures.ts.
 *
 * Override via environment:
 *   E2E_MONGO_CONTAINER   - Mongo container name
 *   E2E_BACKEND_CONTAINER - Backend container name
 */

import { stack } from './stack'

export function mongoContainer(): string {
  return process.env.E2E_MONGO_CONTAINER || stack().mongoContainerName
}

export function backendContainer(): string {
  return process.env.E2E_BACKEND_CONTAINER || stack().backendContainerName
}
