#!/bin/bash
set -e

# Fix permissions for volumes mounted as root
# This is needed because Docker volumes are created with root ownership
if [ -d "/app/flask_session" ]; then
    chown -R appuser:appuser /app/flask_session 2>/dev/null || true
    chmod -R 755 /app/flask_session 2>/dev/null || true
fi

if [ -d "/app/csv_exports" ]; then
    chown -R appuser:appuser /app/csv_exports 2>/dev/null || true
    chmod -R 755 /app/csv_exports 2>/dev/null || true
fi

# Switch to non-root user and execute the command
exec gosu appuser "$@"
