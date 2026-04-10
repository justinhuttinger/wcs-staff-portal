-- SMS History: stores Twilio inbound SMS messages for persistent querying
create table if not exists sms_history (
  sid text primary key,
  from_number text,
  to_number text,
  body text,
  direction text,
  status text,
  date_sent timestamptz,
  num_segments int,
  error_code text,
  error_message text,
  synced_at timestamptz default now()
);

create index if not exists sms_history_date_sent_idx on sms_history (date_sent);
create index if not exists sms_history_body_idx on sms_history using gin (to_tsvector('english', body));
