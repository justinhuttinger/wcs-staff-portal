-- 233: Workflow Maps. A visual map of a marketing/ops automation workflow
-- (texts, emails, waits, branches), built and edited in the portal under
-- Marketing -> Workflows. One row per map; the graph is stored as React Flow
-- nodes/edges JSON so the editor can save it whole on every autosave.
--
-- GHL sync is not built yet. source / ghl_location_id / ghl_workflow_id /
-- ghl_synced_at are reserved for it, and each node's data.ghl will carry the
-- matching GHL step id + type.
--
-- Access: new 'marketing:workflows' capability, seeded to every role that has
-- 'marketing:tracker' today (and copied onto per-person tracker overrides), so
-- nobody gains or loses the Marketing tile. Corporate+ get it automatically.

create table if not exists public.workflow_maps (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(name) between 1 and 200),
  description      text not null default '',
  category         text not null default '',
  status           text not null default 'draft' check (status in ('draft', 'live', 'paused', 'idea')),
  clubs            text[] not null default '{}',
  ghl_workflow_url text not null default '',
  nodes            jsonb not null default '[]'::jsonb,
  edges            jsonb not null default '[]'::jsonb,
  viewport         jsonb,
  -- Bumped on every save; the API rejects a save based on an older version
  -- so two people editing the same map can't silently overwrite each other.
  version          int not null default 1,
  source           text not null default 'manual' check (source in ('manual', 'ghl')),
  ghl_location_id  text,
  ghl_workflow_id  text,
  ghl_synced_at    timestamptz,
  created_by       uuid,
  updated_by       uuid,
  updated_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists workflow_maps_updated_idx on public.workflow_maps (updated_at desc);
create unique index if not exists workflow_maps_ghl_idx
  on public.workflow_maps (ghl_location_id, ghl_workflow_id);

alter table public.workflow_maps enable row level security;

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('marketing:workflows', 'Marketing Workflow Maps', 'Marketing', 'team_member')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible)
select role, 'marketing:workflows', true
from role_tool_visibility
where tool_key = 'marketing:tracker' and visible
on conflict (role, tool_key) do update set visible = true;

insert into staff_permission_overrides (staff_id, perm_key, visible)
select staff_id, 'marketing:workflows', visible
from staff_permission_overrides
where perm_key = 'marketing:tracker'
on conflict do nothing;

update staff
set custom_tiles = array_append(custom_tiles, 'marketing:workflows')
where role = 'custom'
  and 'marketing:tracker' = any(custom_tiles)
  and not ('marketing:workflows' = any(custom_tiles));

-- Example map (also offered as a template in the portal).
insert into public.workflow_maps (id, name, description, category, nodes, edges)
values (
  '00000000-0000-4000-8000-00000000f10a',
  'New Lead Follow-up',
  'Free pass lead: welcome text, free pass email, check-in text, then branch on reply.',
  'Leads',
  '[{"id":"trigger","type":"trigger","position":{"x":0,"y":0},"data":{"title":"New lead submits free pass form","body":"Form submitted: Free Pass (website or Meta lead form). Contact is tagged \"free pass\".","link":"","notes":"","change":""}},{"id":"welcome","type":"sms","position":{"x":0,"y":190},"data":{"title":"Welcome text","body":"Hey {{contact.first_name}}! This is {{user.first_name}} at West Coast Strength {{location.name}}. Your free pass is ready. When were you thinking of coming in?","link":"","notes":"","change":""}},{"id":"wait1","type":"wait","position":{"x":0,"y":380},"data":{"title":"Wait 1 day","body":"","link":"","notes":"","change":"","waitMode":"duration","waitAmount":1,"waitUnit":"days","waitUntil":""}},{"id":"email","type":"email","position":{"x":0,"y":570},"data":{"title":"Free pass email","body":"Hi {{contact.first_name}},\n\nThanks for grabbing a free pass to West Coast Strength {{location.name}}. Bring this email to the front desk and we will get you set up.\n\nSee you soon,\nThe {{location.name}} team","link":"","notes":"","change":"","subject":"Your free pass to West Coast Strength","previewText":"Show this at the front desk to get started"}},{"id":"wait2","type":"wait","position":{"x":0,"y":760},"data":{"title":"Wait 2 days","body":"","link":"","notes":"","change":"","waitMode":"duration","waitAmount":2,"waitUnit":"days","waitUntil":""}},{"id":"checkin","type":"sms","position":{"x":0,"y":950},"data":{"title":"Check-in text","body":"Hi {{contact.first_name}}, just checking in. Were you able to use your free pass yet? Happy to save you a time to come in.","link":"","notes":"","change":""}},{"id":"replied","type":"condition","position":{"x":0,"y":1140},"data":{"title":"Replied?","body":"","link":"","notes":"","change":"","branches":[{"id":"yes","label":"Yes"},{"id":"no","label":"No"}]}},{"id":"notify","type":"action","position":{"x":-170,"y":1360},"data":{"title":"Notify club staff","body":"Text the front desk: lead replied, follow up today.","link":"","notes":"","change":"","actionType":"Internal notification"}},{"id":"end","type":"goal","position":{"x":-170,"y":1550},"data":{"title":"End: staff takes over","body":"","link":"","notes":"","change":""}},{"id":"wait3","type":"wait","position":{"x":170,"y":1360},"data":{"title":"Wait 1 day","body":"","link":"","notes":"","change":"","waitMode":"duration","waitAmount":1,"waitUnit":"days","waitUntil":""}},{"id":"call","type":"call","position":{"x":170,"y":1550},"data":{"title":"Follow-up call","body":"Call script: introduce yourself, ask if they still want to use the free pass, offer a tour time.","link":"","notes":"","change":""}},{"id":"note","type":"note","position":{"x":340,"y":0},"data":{"title":"How to use this map","body":"Click any step to see its full copy. Use Edit to change text, + Add to add steps, and drag between the dots to connect them.","link":"","notes":"","change":""}}]'::jsonb,
  '[{"id":"e-trigger-welcome","source":"trigger","target":"welcome"},{"id":"e-welcome-wait1","source":"welcome","target":"wait1"},{"id":"e-wait1-email","source":"wait1","target":"email"},{"id":"e-email-wait2","source":"email","target":"wait2"},{"id":"e-wait2-checkin","source":"wait2","target":"checkin"},{"id":"e-checkin-replied","source":"checkin","target":"replied"},{"id":"e-replied-yes-notify","source":"replied","target":"notify","sourceHandle":"yes"},{"id":"e-notify-end","source":"notify","target":"end"},{"id":"e-replied-no-wait3","source":"replied","target":"wait3","sourceHandle":"no"},{"id":"e-wait3-call","source":"wait3","target":"call"}]'::jsonb
)
on conflict (id) do nothing;
