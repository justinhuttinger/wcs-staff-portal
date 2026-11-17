-- Hub Suggestions (texts): the owner's private key for the iPhone Shortcut
-- that forwards texts from staff contacts. Only a sha256 hash is stored; the
-- key is shown once when created or reset. Service role only. Idempotent.

alter table hub_settings add column if not exists text_key_hash text;
alter table hub_settings add column if not exists text_key_created_at timestamptz;
create unique index if not exists hub_settings_text_key_idx on hub_settings (text_key_hash) where text_key_hash is not null;
create index if not exists hub_suggestions_open_text_idx on hub_suggestions (owner_staff_id, last_message_at)
  where status = 'open' and source = 'text';
