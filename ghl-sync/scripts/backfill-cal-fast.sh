#!/bin/bash
# Restart parallel calendar-events backfill — one process per club.
# Logs in /tmp/bk-cal-<club>.log. Idempotent: safe to re-run.
# Usage: bash ghl-sync/scripts/backfill-cal-fast.sh [from] [to]
set -u
cd "$(dirname "$0")/.."

FROM="${1:-2026-01-01}"
TO="${2:-$(date -u +%Y-%m-%d)}"

echo "Killing any existing backfill-calendar-events processes..."
pkill -f backfill-calendar-events || true
sleep 3

CLUBS=(30935 31599 7655 31598 31600 31601 32073)
for c in "${CLUBS[@]}"; do
  nohup node scripts/backfill-calendar-events.js \
    --from "$FROM" --to "$TO" --clubs "$c" --sleep 100 \
    > "/tmp/bk-cal-$c.log" 2>&1 &
  echo "Club $c -> PID $!"
done

sleep 5
echo
echo "--- PIDS ---"
pgrep -fa backfill-calendar-events
echo
echo "--- TAILS ---"
for c in "${CLUBS[@]}"; do
  echo "=== $c ==="
  tail -n 3 "/tmp/bk-cal-$c.log" 2>/dev/null || echo "(no log yet)"
done
