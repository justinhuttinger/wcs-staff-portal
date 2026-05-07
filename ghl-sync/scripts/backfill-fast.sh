#!/bin/bash
# Restart parallel check-in backfill for the 4 clubs that still need it.
# One process per club, sleep 100ms. Logs in /tmp/bk-<club>.log.
# Usage: bash ghl-sync/scripts/backfill-fast.sh
set -u
cd "$(dirname "$0")/.."

echo "Killing any existing backfill processes..."
pkill -f backfill-checkins || true
sleep 3

CLUBS=(31598 31600 31601 32073)
FROM=2025-05-06
TO=2026-05-07

for c in "${CLUBS[@]}"; do
  nohup node scripts/backfill-checkins.js \
    --from "$FROM" --to "$TO" --clubs "$c" --sleep 100 \
    > "/tmp/bk-$c.log" 2>&1 &
  echo "Club $c -> PID $!"
done

sleep 5
echo
echo "--- PIDS ---"
pgrep -fa backfill-checkins
echo
echo "--- TAILS ---"
for c in "${CLUBS[@]}"; do
  echo "=== $c ==="
  tail -n 3 "/tmp/bk-$c.log" 2>/dev/null || echo "(no log yet)"
done
