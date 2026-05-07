#!/bin/bash
# Restart parallel check-in backfill. One process per club, sleep 100ms.
# Logs in /tmp/bk-<club>.log.
#
# Usage:
#   bash ghl-sync/scripts/backfill-fast.sh                                    # default 4 troubled clubs, full year
#   bash ghl-sync/scripts/backfill-fast.sh 2026-03-27                         # narrow window
#   bash ghl-sync/scripts/backfill-fast.sh 2026-03-27 2026-05-07              # explicit range
#   bash ghl-sync/scripts/backfill-fast.sh 2026-05-05 2026-05-07 all          # all 7 clubs
#   bash ghl-sync/scripts/backfill-fast.sh 2026-05-05 2026-05-07 30935,31599  # custom subset
#
# Backfill is idempotent (UPSERT by club_number,hour_start) so a narrow
# range is the right move when re-walking everything wastes hours.
set -u
cd "$(dirname "$0")/.."

echo "Killing any existing backfill processes..."
pkill -f backfill-checkins || true
sleep 3

DEFAULT_CLUBS="31598,31600,31601,32073"
ALL_CLUBS="30935,31599,7655,31598,31600,31601,32073"

CLUBS_ARG="${3:-$DEFAULT_CLUBS}"
if [ "$CLUBS_ARG" = "all" ]; then CLUBS_ARG="$ALL_CLUBS"; fi
IFS=',' read -ra CLUBS <<< "$CLUBS_ARG"

FROM="${1:-2025-05-06}"
TO="${2:-$(date -u +%Y-%m-%d)}"
echo "Backfill window: $FROM -> $TO"
echo "Clubs: ${CLUBS[*]}"

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
