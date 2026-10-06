import * as Sentry from "@sentry/nextjs";

/**
 * Node.js server SDK (RSC / SSR of the App Router shell).
 *
 * Env (Vercel production + preview, and optionally .env.local):
 *   NEXT_PUBLIC_SENTRY_DSN
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

function driveSecretValues(): string[] {
  return [
    process.env.GOOGLE_DRIVE_CLIENT_ID,
    process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function redact(value: string, secrets: readonly string[]): string {
  let next = value;
  for (const secret of secrets) {
    next = next.split(secret).join("[redacted]");
  }
  return next.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const secrets = driveSecretValues();
  const headers = event.request?.headers;
  if (headers) {
    delete headers.Authorization;
    delete headers.authorization;
    delete headers.Cookie;
    delete headers.cookie;
  }
  if (typeof event.message === "string") {
    event.message = redact(event.message, secrets);
  }
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === "string") {
      exception.value = redact(exception.value, secrets);
    }
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (typeof breadcrumb.message === "string") {
      breadcrumb.message = redact(breadcrumb.message, secrets);
    }
    if (breadcrumb.data) {
      delete breadcrumb.data.headers;
      delete breadcrumb.data.request_headers;
      if (typeof breadcrumb.data.url === "string") {
        breadcrumb.data.url = redact(breadcrumb.data.url, secrets);
      }
    }
  }
  return event;
}

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend(event) {
    return scrubEvent(event);
  },
});
