-- The intake site generates programs without a CRM record: the trainer types
-- the client's details on the form, so there is no GHL contact to point at.
-- Programs from the GHL webhook still carry one.
alter table public.pt_programs
  alter column contact_id drop not null;

comment on column public.pt_programs.contact_id is
  'GHL contact id. Null for programs generated from the intake site, which creates no CRM record.';
