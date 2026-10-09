-- Cancel tool (wcs-save) -> portal tickets.
--
-- Whenever a save request ends with something staff must do (outcome
-- needs_staff, or a saved offer with a staff_reason such as a perk to hand
-- out), the wcs-save Worker opens a "Cancel Action - Save or Cancel" ticket
-- assigned to save_settings.staff_ticket_assignee_id.
--
-- The type is INACTIVE on purpose: hidden from the staff submit form (these
-- only come from the cancel tool) but its tickets still show in the inbox and
-- can be worked like any other. Field ids are fixed because the Worker writes
-- tickets.data directly.

insert into ticket_types (slug, name, description, schema, active, sort_order, handler_ids, title_template)
values (
  'cancel-action',
  'Cancel Action - Save or Cancel',
  'Opened by the online cancel tool when a member''s save or cancel needs a person to finish it.',
  '[
    {"id": "action",   "type": "short_text", "label": "Save or Cancel"},
    {"id": "member",   "type": "short_text", "label": "Member"},
    {"id": "club",     "type": "short_text", "label": "Club"},
    {"id": "member_id", "type": "short_text", "label": "ABC member ID"},
    {"id": "email",    "type": "short_text", "label": "Email"},
    {"id": "todo",     "type": "long_text",  "label": "What staff need to do"},
    {"id": "reason",   "type": "short_text", "label": "Reason for leaving"},
    {"id": "offer",    "type": "short_text", "label": "Offer taken"},
    {"id": "cancel_date", "type": "short_text", "label": "Effective cancel date"},
    {"id": "request",  "type": "short_text", "label": "Cancel tool request"}
  ]'::jsonb,
  false,
  900,
  array['27c2833e-d328-47dc-8d9b-80ed1e1d7b82']::uuid[],
  'Cancel Action - {{action}} - {{member}}'
)
on conflict (slug) do nothing;

-- Who the tickets are assigned to (Justin to start). Null = unassigned.
alter table save_settings
  add column if not exists staff_ticket_assignee_id uuid references staff(id);
update save_settings
  set staff_ticket_assignee_id = '27c2833e-d328-47dc-8d9b-80ed1e1d7b82'
  where id = 1 and staff_ticket_assignee_id is null;

-- The ticket opened for a request, so it is never opened twice and Activity
-- can link to it.
alter table save_requests
  add column if not exists ticket_id uuid references tickets(id) on delete set null;
