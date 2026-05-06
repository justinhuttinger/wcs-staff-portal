-- Hourly check-in summary per ABC club, populated by ghl-sync's delta loop.
-- One row per (club_number, hour_start). The current hour's row is refreshed
-- on every delta tick (~10 min), then becomes immutable once the hour rolls
-- over.
--
-- total_checkins  = SUM of member.count across the response (visits in window)
-- unique_members  = number of distinct members in the response

CREATE TABLE IF NOT EXISTS checkins_hourly (
  club_number     TEXT        NOT NULL,
  hour_start      TIMESTAMPTZ NOT NULL,
  total_checkins  INTEGER     NOT NULL DEFAULT 0,
  unique_members  INTEGER     NOT NULL DEFAULT 0,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (club_number, hour_start)
);

CREATE INDEX IF NOT EXISTS checkins_hourly_hour_idx
  ON checkins_hourly (hour_start);

CREATE INDEX IF NOT EXISTS checkins_hourly_club_hour_idx
  ON checkins_hourly (club_number, hour_start DESC);
