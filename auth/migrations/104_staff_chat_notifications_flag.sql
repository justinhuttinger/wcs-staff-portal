-- Per-user opt-out for ticket Google Chat DMs.
--
-- services/ticketNotify.js has always read staff.chat_notifications_enabled to
-- decide whether to DM someone, but migration 103 never created the column.
-- Selecting a column that doesn't exist fails the whole PostgREST query, so
-- every recipient lookup returned null and every notification was recorded as
-- "recipient has no Google email on file" — even when the email was present.
-- That misreported the cause and blocked 100% of DMs.
--
-- Default true: everyone receives ticket DMs unless they explicitly opt out.

alter table staff
  add column if not exists chat_notifications_enabled boolean not null default true;

comment on column staff.chat_notifications_enabled is
  'When false, this person receives no ticket assignment/@mention Google Chat DMs.';
