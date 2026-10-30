-- Memos become lists of items, each with a title and a description, so the portal
-- and the iPad image can size and arrange them automatically. Main items live on
-- memo_editions, a club's own items on club_memos. Anything already written
-- carries over as one item. The old text columns stay until this has settled, so
-- the code running during the deploy keeps working; nothing reads them after it.
-- Idempotent: safe to re-run.

alter table memo_editions add column if not exists items jsonb not null default '[]'::jsonb;
alter table club_memos add column if not exists items jsonb not null default '[]'::jsonb;

update memo_editions
set items = jsonb_build_array(jsonb_build_object('title', 'Update', 'description', company_body))
where items = '[]'::jsonb and company_body <> '';

update club_memos
set items = jsonb_build_array(jsonb_build_object('title', 'Club Update', 'description', notes))
where items = '[]'::jsonb and notes <> '';

notify pgrst, 'reload schema';
