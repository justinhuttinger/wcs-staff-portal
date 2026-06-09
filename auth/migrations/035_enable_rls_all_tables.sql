-- 035_enable_rls_all_tables.sql
-- Security hardening: enable Row-Level Security on every public table that had
-- it disabled (Supabase advisor: rls_disabled_in_public / sensitive_columns_exposed).
--
-- ALL database access in this project is server-side via the Supabase SERVICE
-- ROLE (auth API, ghl-sync, prospects-documents). The service role bypasses RLS,
-- so enabling RLS WITHOUT policies is a no-op for our servers but denies the
-- public anon/authenticated roles (PostgREST). The frontend never uses
-- supabase-js, so there is no client-side reader to break. This matches the
-- existing online_join_* / mastermind_* tables, which already run RLS-on/no-policy.

ALTER TABLE public.abc_calendar_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abc_members                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abc_membership_skip_list       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abc_revenue_imports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abc_revenue_transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abc_sync_run_log               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abc_sync_runs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins_hourly                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.click2save_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_note_comments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_notes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_deletion_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_vault               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_tiles                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deleted_contacts_archive       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_folder_locations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drive_folders                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_contacts                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_contacts_v2                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_custom_field_cache         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_custom_field_defs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_dayone_webhooks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_first_contact              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_locations                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_opportunities              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_opportunities_v2           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_pipeline_stages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_pipelines                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_sync_log                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_sync_state                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_articles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_categories                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_documents                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_effort_comments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_efforts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operandio_job_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operandio_location_reports     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operandio_qa_reports           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operandio_raw_emails           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operandio_task_completions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paychex_training_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paychex_training_reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paychex_user_locations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_recurring_commissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_sales_commissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_rewards               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_tool_visibility           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_credentials             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_history                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_google_tokens            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_locations                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_embeds                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tile_locations                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_submissions            ENABLE ROW LEVEL SECURITY;
