-- 055_blog_posts.sql
-- Autonomous blog generator job + history. One row per generated post.
-- Service-role only (auth API). RLS on, no policy, per portal convention.
create table if not exists public.blog_posts (
  id               uuid primary key default gen_random_uuid(),
  location         text not null,            -- matches media_assets.location (Salem/Keizer/...)
  category         text not null,
  topic            text not null,
  status           text not null default 'generating', -- generating|published|failed|skipped
  title            text,
  slug             text,
  meta_description text,
  focus_keyword    text,
  content_html     text,
  faq_json         jsonb,
  excerpt          text,
  image_asset_id   uuid,
  image_drive_id   text,
  wp_post_id       bigint,
  wp_media_id      bigint,
  wp_url           text,
  validation_report jsonb,
  error_message    text,
  created_at       timestamptz not null default now(),
  published_at     timestamptz
);

create index if not exists blog_posts_location_created_idx
  on public.blog_posts (location, created_at desc);

alter table public.blog_posts enable row level security;
