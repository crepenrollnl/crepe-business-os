import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";

export const RECIPE_PHOTO_BUCKET = "recipe-photos";
export const RECIPE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const RECIPE_PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const PUBLIC_OBJECT_MARKER = `/storage/v1/object/public/${RECIPE_PHOTO_BUCKET}/`;

const MIME_TYPE_SET = new Set<string>(RECIPE_PHOTO_MIME_TYPES);

export function validateRecipePhotoFile(file: File): string | null {
  if (file.size > RECIPE_PHOTO_MAX_BYTES) {
    return "Photo must be 5 MB or smaller.";
  }

  if (!MIME_TYPE_SET.has(file.type)) {
    return "Photo must be a JPEG, PNG, or WebP image.";
  }

  return null;
}

/**
 * Extract the storage object path from a recipe-photos public URL.
 * Returns null when the URL is not a recipe-photos public object URL.
 */
export function parseRecipePhotoStoragePath(url: string): string | null {
  const trimmed = url.trim();
  const markerIndex = trimmed.indexOf(PUBLIC_OBJECT_MARKER);

  if (markerIndex === -1) {
    return null;
  }

  const raw = trimmed
    .slice(markerIndex + PUBLIC_OBJECT_MARKER.length)
    .split("?")[0]
    .split("#")[0];

  if (!raw) {
    return null;
  }

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function isMissingStorageObjectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const record = error as {
    message?: unknown;
    statusCode?: unknown;
    status?: unknown;
    error?: unknown;
  };

  const status = String(record.statusCode ?? record.status ?? "");
  if (status === "404") {
    return true;
  }

  const message = [record.message, record.error]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return (
    message.includes("not found") ||
    message.includes("nosuchkey") ||
    message.includes("does not exist")
  );
}

function toStorageFileName(fileName: string): string {
  const trimmed = fileName.trim() || "photo";
  return trimmed.replace(/[/\\]/g, "_");
}

export const recipePhotoService = {
  async uploadPhoto(
    recipeId: string,
    file: File,
  ): Promise<ServiceResult<{ url: string }>> {
    const id = recipeId.trim();

    if (!id) {
      return fail("Recipe is required to upload a photo.");
    }

    const validationError = validateRecipePhotoFile(file);

    if (validationError) {
      return fail(validationError);
    }

    const path = `${id}/${Date.now()}-${toStorageFileName(file.name)}`;

    try {
      const { error } = await supabase.storage
        .from(RECIPE_PHOTO_BUCKET)
        .upload(path, file, {
          upsert: false,
          contentType: file.type,
        });

      if (error) {
        return fail(error.message || "Failed to upload photo.");
      }

      const { data } = supabase.storage
        .from(RECIPE_PHOTO_BUCKET)
        .getPublicUrl(path);

      if (!data.publicUrl) {
        return fail("Failed to resolve photo URL.");
      }

      return ok({ url: data.publicUrl });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Failed to upload photo.";
      return fail(message);
    }
  },

  async removePhotoByUrl(url: string): Promise<ServiceResult<null>> {
    const path = parseRecipePhotoStoragePath(url);

    if (!path) {
      return ok(null);
    }

    try {
      const { error } = await supabase.storage
        .from(RECIPE_PHOTO_BUCKET)
        .remove([path]);

      if (error && !isMissingStorageObjectError(error)) {
        return fail(error.message || "Failed to remove photo.");
      }

      return ok(null);
    } catch (error) {
      if (isMissingStorageObjectError(error)) {
        return ok(null);
      }

      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Failed to remove photo.";
      return fail(message);
    }
  },
};
