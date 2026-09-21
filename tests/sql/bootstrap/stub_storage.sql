-- Scratch/CI prelude for vanilla postgres:16 (no Supabase Storage).
-- Not a numbered migration. Do not apply on live Supabase.
-- Minimal tables so sql/103_recipe_photos.sql can INSERT a bucket and
-- CREATE POLICY on storage.objects.

CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
