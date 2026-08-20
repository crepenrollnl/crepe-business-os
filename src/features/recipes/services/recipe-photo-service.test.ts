/**
 * @vitest-environment jsdom
 *
 * Client-side recipe photo upload: size/MIME validation must reject before
 * Storage is called. Path parsing is used by delete/clear cleanup.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock, uploadMock, removeMock, getPublicUrlMock } = vi.hoisted(
  () => {
    const uploadMock = vi.fn();
    const removeMock = vi.fn();
    const getPublicUrlMock = vi.fn();

    return {
      uploadMock,
      removeMock,
      getPublicUrlMock,
      supabaseMock: {
        storage: {
          from: vi.fn(() => ({
            upload: uploadMock,
            remove: removeMock,
            getPublicUrl: getPublicUrlMock,
          })),
        },
      },
    };
  },
);

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import {
  RECIPE_PHOTO_MAX_BYTES,
  parseRecipePhotoStoragePath,
  recipePhotoService,
  validateRecipePhotoFile,
} from "./recipe-photo-service";

const RECIPE_ID = "44444444-4444-4444-8444-444444444444";

function makeFile(options?: {
  name?: string;
  type?: string;
  size?: number;
}): File {
  const file = new File(["photo"], options?.name ?? "dish.jpg", {
    type: options?.type ?? "image/jpeg",
  });

  if (options?.size !== undefined) {
    Object.defineProperty(file, "size", { value: options.size });
  }

  return file;
}

describe("validateRecipePhotoFile", () => {
  it("accepts a JPEG within the 5 MB limit", () => {
    expect(
      validateRecipePhotoFile(
        makeFile({ type: "image/jpeg", size: RECIPE_PHOTO_MAX_BYTES }),
      ),
    ).toBeNull();
  });

  it("accepts PNG and WebP", () => {
    expect(
      validateRecipePhotoFile(makeFile({ type: "image/png", name: "dish.png" })),
    ).toBeNull();
    expect(
      validateRecipePhotoFile(
        makeFile({ type: "image/webp", name: "dish.webp" }),
      ),
    ).toBeNull();
  });

  it("rejects a file larger than 5 MB", () => {
    expect(
      validateRecipePhotoFile(
        makeFile({ size: RECIPE_PHOTO_MAX_BYTES + 1 }),
      ),
    ).toBe("Photo must be 5 MB or smaller.");
  });

  it("rejects a disallowed MIME type", () => {
    expect(
      validateRecipePhotoFile(
        makeFile({ type: "image/gif", name: "dish.gif" }),
      ),
    ).toBe("Photo must be a JPEG, PNG, or WebP image.");
  });

  it("rejects an empty MIME type", () => {
    expect(validateRecipePhotoFile(makeFile({ type: "" }))).toBe(
      "Photo must be a JPEG, PNG, or WebP image.",
    );
  });
});

describe("parseRecipePhotoStoragePath", () => {
  it("extracts the object path from a public URL", () => {
    expect(
      parseRecipePhotoStoragePath(
        `https://proj.supabase.co/storage/v1/object/public/recipe-photos/${RECIPE_ID}/123-dish.jpg`,
      ),
    ).toBe(`${RECIPE_ID}/123-dish.jpg`);
  });

  it("strips query strings and decodes the path", () => {
    expect(
      parseRecipePhotoStoragePath(
        `https://proj.supabase.co/storage/v1/object/public/recipe-photos/${RECIPE_ID}/123-dish%20name.jpg?token=abc`,
      ),
    ).toBe(`${RECIPE_ID}/123-dish name.jpg`);
  });

  it("returns null for a URL that is not a recipe-photos public object", () => {
    expect(
      parseRecipePhotoStoragePath("https://cdn.example/photo.jpg"),
    ).toBeNull();
  });
});

describe("recipePhotoService.uploadPhoto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.storage.from.mockReturnValue({
      upload: uploadMock,
      remove: removeMock,
      getPublicUrl: getPublicUrlMock,
    });
  });

  it("does not call Storage when the file is too large", async () => {
    const result = await recipePhotoService.uploadPhoto(
      RECIPE_ID,
      makeFile({ size: RECIPE_PHOTO_MAX_BYTES + 1 }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Photo must be 5 MB or smaller.");
    expect(supabaseMock.storage.from).not.toHaveBeenCalled();
  });

  it("does not call Storage when the MIME type is not allowed", async () => {
    const result = await recipePhotoService.uploadPhoto(
      RECIPE_ID,
      makeFile({ type: "application/pdf", name: "dish.pdf" }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Photo must be a JPEG, PNG, or WebP image.");
    expect(supabaseMock.storage.from).not.toHaveBeenCalled();
  });

  it("uploads with a unique path and returns the public URL", async () => {
    uploadMock.mockResolvedValue({ data: { path: "ok" }, error: null });
    getPublicUrlMock.mockReturnValue({
      data: {
        publicUrl: `https://proj.supabase.co/storage/v1/object/public/recipe-photos/${RECIPE_ID}/1-dish.jpg`,
      },
    });

    const file = makeFile({ name: "dish.jpg", type: "image/jpeg" });
    const result = await recipePhotoService.uploadPhoto(RECIPE_ID, file);

    expect(result.error).toBeNull();
    expect(result.data?.url).toContain("/recipe-photos/");
    expect(uploadMock).toHaveBeenCalledTimes(1);

    const [path, body, options] = uploadMock.mock.calls[0] as [
      string,
      File,
      { upsert: boolean; contentType: string },
    ];
    expect(path.startsWith(`${RECIPE_ID}/`)).toBe(true);
    expect(path.endsWith("-dish.jpg")).toBe(true);
    expect(body).toBe(file);
    expect(options.upsert).toBe(false);
    expect(options.contentType).toBe("image/jpeg");
  });
});

describe("recipePhotoService.removePhotoByUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.storage.from.mockReturnValue({
      upload: uploadMock,
      remove: removeMock,
      getPublicUrl: getPublicUrlMock,
    });
  });

  it("removes the object at the parsed path", async () => {
    removeMock.mockResolvedValue({ data: [], error: null });

    const result = await recipePhotoService.removePhotoByUrl(
      `https://proj.supabase.co/storage/v1/object/public/recipe-photos/${RECIPE_ID}/1-dish.jpg`,
    );

    expect(result.error).toBeNull();
    expect(removeMock).toHaveBeenCalledWith([`${RECIPE_ID}/1-dish.jpg`]);
  });

  it("succeeds when the object is already gone", async () => {
    removeMock.mockResolvedValue({
      data: null,
      error: { message: "Object not found", statusCode: "404" },
    });

    const result = await recipePhotoService.removePhotoByUrl(
      `https://proj.supabase.co/storage/v1/object/public/recipe-photos/${RECIPE_ID}/missing.jpg`,
    );

    expect(result.error).toBeNull();
    expect(result.data).toBeNull();
  });

  it("succeeds without calling Storage when the URL is not a recipe-photos path", async () => {
    const result = await recipePhotoService.removePhotoByUrl(
      "https://cdn.example/unrelated.jpg",
    );

    expect(result.error).toBeNull();
    expect(supabaseMock.storage.from).not.toHaveBeenCalled();
  });
});
