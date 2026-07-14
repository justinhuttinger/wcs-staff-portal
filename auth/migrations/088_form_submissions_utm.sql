-- Form Builder: store UTM attribution (utm_source / utm_medium / utm_campaign)
-- captured from the public form URL. Single jsonb column so adding more params
-- later never needs a schema change. Existing rows default to '{}'.
alter table form_submissions add column if not exists utm jsonb not null default '{}'::jsonb;
