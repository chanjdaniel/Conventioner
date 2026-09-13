---
id: E06/F02/S01
title: Remove the csv_exports directory nothing writes to
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

The `csv_exports` directory and its named Docker volume are gone, and nothing creates, mounts,
chowns or documents them.

## What is known

Assignment CSV download does not touch the disk. `GET /markets/<id>/assignment-csv` builds the CSV
in memory and returns it with a `Content-Disposition` attachment header; the browser saves it. No
Python file in `back-end/` mentions `csv_exports` at all.

What still exists for it:

- `back-end/Dockerfile` creates it and chowns it at build time
- `back-end/docker-entrypoint.sh` chowns and chmods it on every container start
- `docker-compose.yml` mounts a named volume `backend_csv` at it, and declares that volume
- `docs/STARTUP.md` tells the reader to `mkdir -p csv_exports` and documents where exported files
  land (that half is E04/F02/S01's to remove)

Found while reading `docs/STARTUP.md` for E04/F02/S01.

## Acceptance criteria

- [x] No reference remains in the Dockerfile, the entrypoint, `docker-compose.yml`, `.gitignore`,
      `.dockerignore` or `docs/STARTUP.md`. The one surviving mention is the STARTUP line saying it
      is gone.
- [x] The stack builds and comes up: the image was rebuilt and the full e2e suite run against it
- [x] Assignment CSV download still works, demonstrated - `tier2.spec.ts`'s "download CSV with
      expected columns" performs a real download and reads its columns, and passed in that run
- [x] Named in the commit message: removing the mount does not remove a volume already created, so
      an existing developer has an orphaned `<project>_backend_csv` to `docker volume rm`
