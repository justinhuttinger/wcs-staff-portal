-- 056_inventory_abc_push.sql
-- Best-effort mirror of portal stock changes to ABC PUT Stock Level. Each
-- stock-changing movement carries its own push status; this row IS the retry
-- queue. POS-origin movements are inserted with abc_push_status='na'.
alter table public.inventory_movements
  add column if not exists abc_push_status   text,            -- na|pending|synced|failed|skipped
  add column if not exists abc_action        text,            -- add|override
  add column if not exists abc_push_error     text,
  add column if not exists abc_push_attempts  integer not null default 0,
  add column if not exists abc_pushed_at      timestamptz;

-- The retry job scans for failed/stuck-pending rows; index just those.
create index if not exists inventory_movements_abc_push_pending_idx
  on public.inventory_movements (abc_push_status)
  where abc_push_status in ('pending', 'failed');
