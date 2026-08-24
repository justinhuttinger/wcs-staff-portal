-- Day One programs can ship under a second brand (ESAC / Eastside Athletic Club,
-- black-and-white) selected by a GHL custom field on the intake. Store which
-- brand a run used so the success page and the admin monitor can show it.
alter table public.pt_programs
  add column if not exists brand text not null default 'wcs';

comment on column public.pt_programs.brand is 'Branding used for this program: wcs | esac';
