---
id: E06/F02/S01
title: Remove the csv_exports directory nothing writes to
type: story
status: ready
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

- [ ] No reference to `csv_exports` or `backend_csv` remains anywhere in the repository
- [ ] The stack builds and comes up from a clean clone with no volume left orphaned
- [ ] Assignment CSV download still works, demonstrated rather than assumed
- [ ] Existing developers' orphaned `backend_csv` volumes are mentioned wherever the change is
      described, since removing the mount does not remove a volume already created
