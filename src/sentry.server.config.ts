import * as Sentry from "@sentry/nextjs";

/**
 * Node.js server SDK (RSC / SSR of the App Router shell).
 *
 * Env (Vercel production + preview, and optionally .env.local):
 *   NEXT_PUBLIC_SENTRY_DSN
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0,
  sendDefaultPii: false,
});
