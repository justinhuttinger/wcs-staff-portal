-- 013: Retune the business-hours Speed to Lead staffed window from 08:00-20:00
-- to 11:00-19:30 (11:00am-7:30pm), every day, all locations. Experimental tile,
-- so the window is being tuned to the real staffed lead-response hours.
--
-- Updates the existing per-location config rows AND the column defaults so any
-- location added later inherits the new window.

UPDATE stl_business_hours_config
   SET window_start = '11:00',
       window_end   = '19:30',
       updated_at   = now();

ALTER TABLE stl_business_hours_config
  ALTER COLUMN window_start SET DEFAULT '11:00',
  ALTER COLUMN window_end   SET DEFAULT '19:30';
