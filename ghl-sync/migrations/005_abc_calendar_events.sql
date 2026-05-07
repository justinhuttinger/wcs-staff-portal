-- Migration: PT/Appointment calendar events from ABC /calendars/events
-- Filtered at sync time to category='Appointment' AND status in
-- ('Completed','Canceled-Charge'). Multi-member events (Classes) are out of scope.

CREATE TABLE IF NOT EXISTS abc_calendar_events (
  club_number               TEXT NOT NULL,
  event_id                  TEXT NOT NULL,
  event_type_id             TEXT,
  event_name                TEXT,
  category                  TEXT,
  event_timestamp           TIMESTAMPTZ,
  event_timestamp_local     TIMESTAMP,
  status                    TEXT,
  duration_minutes          INTEGER,
  employee_id               TEXT,
  employee_first_name       TEXT,
  employee_last_name        TEXT,
  location_id               TEXT,
  location_name             TEXT,
  training_level            TEXT,
  earnings_code             TEXT,
  member_id                 TEXT,
  member_first_name         TEXT,
  member_last_name          TEXT,
  attended_status           TEXT,
  modified_timestamp_abc    TIMESTAMPTZ,
  fetched_at                TIMESTAMPTZ DEFAULT now(),
  raw                       JSONB,
  PRIMARY KEY (club_number, event_id)
);

CREATE INDEX IF NOT EXISTS abc_cal_events_club_time
  ON abc_calendar_events (club_number, event_timestamp);
CREATE INDEX IF NOT EXISTS abc_cal_events_employee_time
  ON abc_calendar_events (employee_id, event_timestamp);
CREATE INDEX IF NOT EXISTS abc_cal_events_event_type
  ON abc_calendar_events (event_type_id);
