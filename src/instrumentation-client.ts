import * as Sentry from "@sentry/nextjs";

/**
 * Browser SDK. DSN is public by design (Sentry ingest keys are not secrets).
 * Uncaught exceptions and unhandled promise rejections are captured automatically.
 * Do not add captureConsoleIntegration — service-errors.ts's intentional
 * console.error("ServiceErrorSuppressed", ...) must not become Sentry noise.
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
