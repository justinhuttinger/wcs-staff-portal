#!/bin/bash
# Restart parallel check-in backfill for the 4 clubs that still need it.
# One process per club, sleep 100ms. Logs in /tmp/bk-<club>.log.
#
# Usage:
#   bash ghl-sync/scripts/backfill-fast.sh                          # full year
#   bash ghl-sync/scripts/backfill-fast.sh 2026-03-27               # from -> today
#   bash ghl-sync/scripts/backfill-fast.sh 2026-03-27 2026-05-07    # explicit range
#
# Backfill is idempotent (UPSERT by club_number,hour_start) so a narrow
# range is the right move when re-walking everything wastes hours.
set -u
cd "$(dirname "$0")/.."

echo "Killing any existing backfill processes..."
pkill -f backfill-checkins || true
sleep 3

CLUBS=(31598 31600 31601 32073)
FROM="${1:-2025-05-06}"
TO="${2:-$(date -u +%Y-%m-%d)}"
echo "Backfill window: $FROM -> $TO"

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
