export interface DriveSyncConfigured {
  configured: true;
  available: boolean;
  synced: number;
  failed: number;
  remaining: number;
}

export type DriveSyncResult = { configured: false } | DriveSyncConfigured;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseDriveSyncResult(value: unknown): DriveSyncResult | null {
  if (!value || typeof value !== "object" || !("configured" in value)) {
    return null;
  }
  if (value.configured === false) {
    return { configured: false };
  }
  if (
    value.configured === true &&
    "available" in value &&
    typeof value.available === "boolean" &&
    "synced" in value &&
    "failed" in value &&
    "remaining" in value &&
    isCount(value.synced) &&
    isCount(value.failed) &&
    isCount(value.remaining)
  ) {
    return {
      configured: true,
      available: value.available,
      synced: value.synced,
      failed: value.failed,
      remaining: value.remaining,
    };
  }
  return null;
}

export async function requestDriveReceiptSync(
  getAccessToken: () => Promise<string | null>,
  fileIds?: string[],
): Promise<DriveSyncResult | null> {
  try {
    const token = await getAccessToken();
    if (!token) {
      return null;
    }

    const response = await fetch("/api/purchase-receipts/drive-sync", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fileIds ? { fileIds } : {}),
    });
    if (!response.ok) {
      return null;
    }
    return parseDriveSyncResult(await response.json());
  } catch {
    return null;
  }
}
