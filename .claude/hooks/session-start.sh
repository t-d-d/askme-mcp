#!/bin/bash
set -euo pipefail

# Runs at the start of a Claude cloud session. It does nothing on a laptop.
# It prints only when there is work to do, because whatever it prints is
# added to the session's context on every start, resume and compaction.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install dependencies when the lockfile has changed since the last install.
# `npm ci` never rewrites package-lock.json, and it wipes node_modules first,
# so skip it when the installed tree already matches the lockfile.
if [ -f package-lock.json ]; then
  SENTINEL="node_modules/.lockfile-sha1"
  LOCK_SHA=$(sha1sum package-lock.json | cut -d' ' -f1)
  if [ "$(cat "$SENTINEL" 2>/dev/null)" != "$LOCK_SHA" ]; then
    echo "Installing npm dependencies..."
    npm ci
    echo "$LOCK_SHA" > "$SENTINEL"
  fi
fi
