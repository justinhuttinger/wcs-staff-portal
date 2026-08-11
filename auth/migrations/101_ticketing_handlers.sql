-- Per-type ticket handlers.
--
-- Ticketing has two personas: MAKERS (create tickets + view status, read-only)
-- and HANDLERS (edit, add progress, mark done). Handlers are assigned per
-- ticket *type*, so different teams can own different types. Admins always
-- handle every type.
--
-- handler_ids is a plain uuid[] of staff ids (same convention as
-- staff.marketing_locations). Empty array = only admins can handle this type.

alter table ticket_types
  add column if not exists handler_ids uuid[] not null default '{}';

-- The file-upload field is a new schema field type (type: 'file'); it needs no
-- table change — the bytes live in the existing ticket_attachments / storage
-- bucket, tagged with the field id, and the schema itself lives in
-- ticket_types.schema.
