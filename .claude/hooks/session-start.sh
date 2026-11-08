#!/bin/bash
set -euo pipefail

# Print only when there is work to do: whatever this prints joins the
# session's context on every start, resume and compaction.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm ci wipes node_modules first, so skip it while the installed tree
# matches the lockfile.
if [ -f package-lock.json ]; then
  SENTINEL="node_modules/.lockfile-sha1"
  LOCK_SHA=$(sha1sum package-lock.json | cut -d' ' -f1)
  if [ "$(cat "$SENTINEL" 2>/dev/null)" != "$LOCK_SHA" ]; then
    echo "Installing npm dependencies..."
    npm ci
    echo "$LOCK_SHA" > "$SENTINEL"
  fi
fi

# Only the cloud environment sets ACCESS_URL. The endpoint answers with the
# whole ~/.aws/config, a profile for each AWS account, so it replaces the
# file. Its first line names the profiles.
if [ -n "${ACCESS_URL:-}" ]; then
  mkdir -p ~/.aws
  if err=$(curl -fsS --max-time 20 "${ACCESS_URL%/}/config?region=${AWS_REGION:-us-east-1}" 2>&1 > ~/.aws/config.part); then
    mv ~/.aws/config.part ~/.aws/config
    head -1 ~/.aws/config
  else
    rm -f ~/.aws/config.part
    echo "# access: the AWS profiles could not be fetched (${err%%$'\n'*})"
  fi
fi
