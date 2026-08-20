-- Recipe photos — Storage bucket + recipes.image_url (Phase 5.1, task A)
-- Run in Supabase SQL editor after sql/102_purchase_item_tax_fields.sql
-- (this script does not depend on purchases VAT; numbering is sequential).
-- Apply on both databases (dev + prod), as with every previous sql/*.sql.
--
-- Phase 5.1 of the project plan, task A of three:
--   A (this file) — schema + bucket + storage RLS only. No UI.
--   B+C (later) — recipe-editor upload, recipe-service persistence,
--     Quick Sale / POS tiles reading image_url.
--
-- 1. recipes.image_url — optional public URL (or storage path written by
--    a future upload service) for the dish photo shown on Quick Sale and
--    POS tiles. Nullable: recipes without a photo stay valid. Never read
--    by confirm_sale, create_and_confirm_sale, or FIFO allocation.
--
-- 2. Public storage bucket recipe-photos — menu photos are not secret;
--    tiles can use getPublicUrl. Uploads/deletes are not open to anon.
--
-- 3. storage.objects policies for that bucket only, matching sql/098:
--    writes gated with get_my_role() IN ('owner', 'partner') — not
--    require_role() (that helper raises inside RPCs; table/storage RLS
--    uses get_my_role() in USING / WITH CHECK). SELECT for authenticated
--    is a belt-and-suspenders read via the Storage API; the public URL
--    path works without it on a public bucket.
--
-- Additive and safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING /
-- pg_policies guards). Does NOT:
--   - change recipe create/update RPCs (none exist — persistRecipe writes
--     the recipes table directly)
--   - add TypeScript, UI, or a file-upload component
--   - restrict recipes table RLS (still recipes_authenticated_all from
--     sql/002; a future Sales RBAC tranche, not this task)

-- ---------------------------------------------------------------------------
-- 1. recipes.image_url
-- ---------------------------------------------------------------------------

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN recipes.image_url IS
  'Optional dish photo for Quick Sale / POS tiles. Nullable -- not every recipe has one yet. Written by a future upload flow against the recipe-photos bucket; never read by confirm_sale, create_and_confirm_sale, or FIFO allocation.';

-- ---------------------------------------------------------------------------
-- 2. Public bucket recipe-photos
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'recipe-photos',
  'recipe-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. storage.objects policies (bucket_id = recipe-photos only)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'recipe_photos_authenticated_select'
  ) THEN
    CREATE POLICY recipe_photos_authenticated_select
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (bucket_id = 'recipe-photos');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'recipe_photos_owner_partner_insert'
  ) THEN
    CREATE POLICY recipe_photos_owner_partner_insert
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'recipe-photos'
        AND get_my_role() IN ('owner', 'partner')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'recipe_photos_owner_partner_update'
  ) THEN
    CREATE POLICY recipe_photos_owner_partner_update
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'recipe-photos'
        AND get_my_role() IN ('owner', 'partner')
      )
      WITH CHECK (
        bucket_id = 'recipe-photos'
        AND get_my_role() IN ('owner', 'partner')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'recipe_photos_owner_partner_delete'
  ) THEN
    CREATE POLICY recipe_photos_owner_partner_delete
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'recipe-photos'
        AND get_my_role() IN ('owner', 'partner')
      );
  END IF;
END $$;
