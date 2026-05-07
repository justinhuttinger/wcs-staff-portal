#!/bin/bash
# Show running check-in backfill processes and the last few lines of each log.
# Usage: bash ghl-sync/scripts/backfill-status.sh
echo "--- PIDS ---"
pgrep -fa backfill-checkins || echo "(none running)"
echo
echo "--- TAILS ---"
for c in 31598 31600 31601 32073 30935 31599 7655; do
  if [ -f "/tmp/bk-$c.log" ]; then
    echo "=== $c ==="
    tail -n 3 "/tmp/bk-$c.log"
  fi
done
