import { driveHttpFailure } from "../utils/drive-receipt-copy";
import type { GoogleDriveSecrets } from "./google-drive-secrets";
import { driveFailureScopeForStatus, SafeDriveFailure } from "./safe-drive-failure";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FOLDER_MIME = "application/vnd.google-apps.folder";

async function googleFetch(
  url: string,
  accessToken: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...init.headers,
      },
    });
  } catch {
    throw new SafeDriveFailure("Could not reach Google Drive.", "global");
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The status is enough. The body is never stored.
  }
}

function readId(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("id" in value)) {
    return null;
  }
  const id = value.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function readFirstFileId(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("files" in value)) {
    return null;
  }
  const files = value.files;
  if (!Array.isArray(files) || files.length === 0) {
    return null;
  }
  return readId(files[0]);
}

export async function fetchGoogleAccessToken(secrets: GoogleDriveSecrets): Promise<string> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: secrets.clientId,
        client_secret: secrets.clientSecret,
        refresh_token: secrets.refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    throw new SafeDriveFailure("Could not reach Google Drive.", "global");
  }

  if (!response.ok) {
    await discardBody(response);
    throw new SafeDriveFailure(
      driveHttpFailure(response.status, "sign-in"),
      driveFailureScopeForStatus(response.status),
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new SafeDriveFailure("Could not reach Google Drive.", "global");
  }

  const accessToken = readAccessToken(parsed);
  if (!accessToken) {
    throw new SafeDriveFailure("Could not reach Google Drive.", "global");
  }
  return accessToken;
}

function readAccessToken(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("access_token" in value)) {
    return null;
  }
  const token = value.access_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

function quoteDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function findOrCreateDriveFolder(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<string> {
  const query = [
    `name = '${quoteDriveQuery(name)}'`,
    `mimeType = '${FOLDER_MIME}'`,
    `'${quoteDriveQuery(parentId)}' in parents`,
    "trashed = false",
  ].join(" and ");
  const searchUrl = new URL("https://www.googleapis.com/drive/v3/files");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("fields", "files(id)");
  searchUrl.searchParams.set("pageSize", "1");

  const found = await googleFetch(searchUrl.toString(), accessToken, { method: "GET" });
  if (!found.ok) {
    await discardBody(found);
    throw new SafeDriveFailure(
      driveHttpFailure(found.status, "request"),
      driveFailureScopeForStatus(found.status),
    );
  }
  const existingId = readFirstFileId(await found.json());
  if (existingId) {
    return existingId;
  }

  const created = await googleFetch(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      }),
    },
  );
  if (!created.ok) {
    await discardBody(created);
    throw new SafeDriveFailure(
      driveHttpFailure(created.status, "request"),
      driveFailureScopeForStatus(created.status),
    );
  }
  const createdId = readId(await created.json());
  if (!createdId) {
    throw new SafeDriveFailure("Could not reach Google Drive.", "global");
  }
  return createdId;
}

export async function findDriveFileByReceiptFileId(
  accessToken: string,
  receiptFileId: string,
): Promise<string | null> {
  const query = `appProperties has { key='receiptFileId' and value='${quoteDriveQuery(receiptFileId)}' } and trashed = false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id)");
  url.searchParams.set("pageSize", "1");

  const response = await googleFetch(url.toString(), accessToken, { method: "GET" });
  if (!response.ok) {
    await discardBody(response);
    throw new SafeDriveFailure(
      driveHttpFailure(response.status, "request"),
      driveFailureScopeForStatus(response.status),
    );
  }
  return readFirstFileId(await response.json());
}

export async function uploadReceiptPhoto(input: {
  accessToken: string;
  folderId: string;
  fileName: string;
  receiptFileId: string;
  bytes: Uint8Array;
  mimeType: string;
}): Promise<string> {
  const boundary = `receipt-${input.receiptFileId}`;
  const metadata = JSON.stringify({
    name: input.fileName,
    parents: [input.folderId],
    appProperties: { receiptFileId: input.receiptFileId },
  });
  const encoder = new TextEncoder();
  const preamble = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
  );
  const closing = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(preamble.length + input.bytes.length + closing.length);
  body.set(preamble, 0);
  body.set(input.bytes, preamble.length);
  body.set(closing, preamble.length + input.bytes.length);

  const response = await googleFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    input.accessToken,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!response.ok) {
    await discardBody(response);
    throw new SafeDriveFailure(
      driveHttpFailure(response.status, "upload"),
      driveFailureScopeForStatus(response.status),
    );
  }
  const id = readId(await response.json());
  if (!id) {
    throw new SafeDriveFailure("Could not reach Google Drive.", "global");
  }
  return id;
}
