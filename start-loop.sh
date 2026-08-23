#!/usr/bin/env bash
# Linux/macOS launcher. Keeps the app running and brings it back after the
# owner console's "Restart application" (the process exits with code 42).
cd "$(dirname "$0")" || exit 1

while true; do
  node src/server.js
  code=$?
  if [ "$code" -eq 42 ]; then
    echo "Restarting application..."
    sleep 2
    continue
  fi
  exit "$code"
done
