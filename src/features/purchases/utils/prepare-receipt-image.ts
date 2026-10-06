export const RECEIPT_IMAGE_MAX_EDGE = 2000;
export const RECEIPT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const RECEIPT_JPEG_QUALITY = 0.8;

export const UNSUPPORTED_RECEIPT_PHOTO_MESSAGE =
  "This photo format is not supported. Use the Take photo button.";

export const RECEIPT_PHOTO_TOO_LARGE_MESSAGE =
  "This photo is still larger than 8 MB after compression. Take a smaller photo.";

export function fitLongEdge(
  width: number,
  height: number,
  maxEdge: number = RECEIPT_IMAGE_MAX_EDGE,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Photo dimensions are not valid.");
  }

  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function receiptImageTooLargeMessage(sizeBytes: number): string | null {
  if (sizeBytes > RECEIPT_IMAGE_MAX_BYTES) {
    return RECEIPT_PHOTO_TOO_LARGE_MESSAGE;
  }

  return null;
}

export type PreparedReceiptImage =
  | { ok: true; blob: Blob; originalFilename: string | null }
  | { ok: false; error: string };

function filenameOrNull(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dimensionsOf(source: CanvasImageSource): { width: number; height: number } {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    return { width: source.width, height: source.height };
  }

  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }

  if ("width" in source && "height" in source) {
    return { width: Number(source.width), height: Number(source.height) };
  }

  return { width: 0, height: 0 };
}

function closeSource(source: CanvasImageSource): void {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close();
  }
}

async function decodeWithImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);

  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(UNSUPPORTED_RECEIPT_PHOTO_MESSAGE));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeReceiptFile(file: File): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Phone browsers that cannot decode the file fall through to <img>.
    }
  }

  return decodeWithImage(file);
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", RECEIPT_JPEG_QUALITY);
  });
}

export async function prepareReceiptImage(file: File): Promise<PreparedReceiptImage> {
  let source: CanvasImageSource;
  try {
    source = await decodeReceiptFile(file);
  } catch {
    return { ok: false, error: UNSUPPORTED_RECEIPT_PHOTO_MESSAGE };
  }

  try {
    const raw = dimensionsOf(source);
    let fitted: { width: number; height: number };
    try {
      fitted = fitLongEdge(raw.width, raw.height);
    } catch {
      return { ok: false, error: UNSUPPORTED_RECEIPT_PHOTO_MESSAGE };
    }

    const canvas = document.createElement("canvas");
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const context = canvas.getContext("2d");
    if (!context) {
      return { ok: false, error: UNSUPPORTED_RECEIPT_PHOTO_MESSAGE };
    }

    context.drawImage(source, 0, 0, fitted.width, fitted.height);
    const blob = await canvasBlob(canvas);
    if (!blob) {
      return { ok: false, error: UNSUPPORTED_RECEIPT_PHOTO_MESSAGE };
    }

    const tooLarge = receiptImageTooLargeMessage(blob.size);
    if (tooLarge) {
      return { ok: false, error: tooLarge };
    }

    return {
      ok: true,
      blob,
      originalFilename: filenameOrNull(file.name),
    };
  } finally {
    closeSource(source);
  }
}
