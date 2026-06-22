-- 052_media_search.sql
-- Visual search over the shared "Media" Drive folder. ghl-sync crawls the
-- folder and writes one media_assets row per file plus one or more
-- media_embeddings rows (1 per photo, N per sampled video frame). The auth
-- API embeds the text query and calls match_media_embeddings() for cosine ANN.
-- All access is server-side via the service role, so RLS is enabled with no
-- policy (denies anon/authenticated PostgREST; service role bypasses it).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS media_assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_file_id       text NOT NULL UNIQUE,
  kind                text NOT NULL,                 -- 'image' | 'video'
  title               text,
  mime_type           text,
  location            text,                          -- top-level folder (Salem/Eugene/.../Etc.)
  folder_path         text,                          -- path under the Media root
  file_size           bigint,
  drive_modified_time timestamptz,
  md5                 text,                          -- Drive md5Checksum (change detection)
  web_view_link       text,
  status              text NOT NULL DEFAULT 'indexed', -- 'indexed' | 'error'
  error               text,
  indexed_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_location ON media_assets(location);
CREATE INDEX IF NOT EXISTS idx_media_assets_kind ON media_assets(kind);

CREATE TABLE IF NOT EXISTS media_embeddings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id           uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  embedding          vector(1024) NOT NULL,
  frame_time_seconds numeric,                        -- null for photos
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_embeddings_asset ON media_embeddings(asset_id);
CREATE INDEX IF NOT EXISTS idx_media_embeddings_hnsw
  ON media_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION media_assets_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_media_assets_updated_at ON media_assets;
CREATE TRIGGER trg_media_assets_updated_at
  BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION media_assets_touch_updated_at();

ALTER TABLE public.media_assets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_embeddings ENABLE ROW LEVEL SECURITY;

-- Cosine ANN search, deduped to the best-matching frame per asset.
CREATE OR REPLACE FUNCTION match_media_embeddings(
  query_embedding vector(1024),
  match_count     int  DEFAULT 40,
  filter_location text DEFAULT NULL,
  filter_kind     text DEFAULT NULL
) RETURNS TABLE (
  asset_id uuid, drive_file_id text, kind text, title text, location text,
  folder_path text, web_view_link text, mime_type text,
  frame_time_seconds numeric, similarity float
) LANGUAGE sql STABLE AS $$
  SELECT * FROM (
    SELECT DISTINCT ON (a.id)
      a.id AS asset_id, a.drive_file_id, a.kind, a.title, a.location,
      a.folder_path, a.web_view_link, a.mime_type, e.frame_time_seconds,
      1 - (e.embedding <=> query_embedding) AS similarity
    FROM media_embeddings e
    JOIN media_assets a ON a.id = e.asset_id
    WHERE (filter_location IS NULL OR a.location = filter_location)
      AND (filter_kind IS NULL OR a.kind = filter_kind)
    ORDER BY a.id, e.embedding <=> query_embedding
  ) t
  ORDER BY t.similarity DESC
  LIMIT match_count;
$$;
