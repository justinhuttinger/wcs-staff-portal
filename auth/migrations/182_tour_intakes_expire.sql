-- 182_tour_intakes_expire.sql
--
-- A tour card means "this person is at the front desk now". The queue had no
-- expiry, so Salem accumulated eight days of them: 27 ready, 22 older than a
-- day, five genuine arrivals buried underneath. Staff stopped trusting the
-- list, which is the likeliest reason only 2 of 27 tours were ever completed.
--
-- Cards are now retired at the start of the next tour day (4am Pacific) by the
-- queue read itself. This migration retires the ones already stranded, and
-- indexes the two queries that do it.
--
-- Retired, not deleted: a check-in nobody toured is a real number - the gap
-- between people walking in and people being seen - and deleting it would
-- report the day as though they never arrived.

-- One-time cleanup of what is already stale. 4am Pacific today, expressed
-- without assuming the server's timezone.
update tour_intakes
   set status = 'abandoned',
       -- A prospect's face held indefinitely for a card nobody will ever work.
       photo_base64 = null
 where status = 'ready'
   and received_at < (
     date_trunc('day', (now() at time zone 'America/Los_Angeles'))
     + interval '4 hours'
   ) at time zone 'America/Los_Angeles';

-- The queue read: one club's live cards, newest first.
create index if not exists tour_intakes_live_queue_idx
  on tour_intakes (location_id, received_at desc)
  where status = 'ready';

-- Counting what was never worked, per club per day.
create index if not exists tour_intakes_abandoned_idx
  on tour_intakes (location_id, received_at desc)
  where status = 'abandoned';

comment on column tour_intakes.status is
  'ready = waiting at the desk today. completed = a tour was recorded. '
  'abandoned = the day ended without one, retired automatically at 4am Pacific.';
