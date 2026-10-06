import "server-only";

export interface GoogleDriveSecrets {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function readGoogleDriveSecrets(): GoogleDriveSecrets | null {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }
  return { clientId, clientSecret, refreshToken };
}

export function googleDriveSecretValues(secrets: GoogleDriveSecrets): string[] {
  return [secrets.clientId, secrets.clientSecret, secrets.refreshToken];
}
