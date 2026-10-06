export type DriveFailureScope = "global" | "page";

export class SafeDriveFailure extends Error {
  readonly scope: DriveFailureScope;

  constructor(message: string, scope: DriveFailureScope) {
    super(message);
    this.name = "SafeDriveFailure";
    this.scope = scope;
  }
}

export function driveFailureScopeForStatus(status: number): DriveFailureScope {
  if (status === 401 || status === 403 || status === 429 || status >= 500) {
    return "global";
  }
  return "page";
}
