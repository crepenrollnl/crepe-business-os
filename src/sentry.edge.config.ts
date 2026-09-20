import * as Sentry from "@sentry/nextjs";

/**
 * Edge runtime SDK. This app has no middleware/edge routes today; the
 * official Next.js SDK still initializes this surface so a future
 * proxy.ts / edge handler is covered.
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
