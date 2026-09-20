import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

/**
 * Official @sentry/nextjs 10.x wrapper (Next 15+/16 App Router + Turbopack).
 *
 * Build-time env (optional — source maps upload only when all three are set):
 *   SENTRY_ORG
 *   SENTRY_PROJECT
 *   SENTRY_AUTH_TOKEN   (secret; CI / Vercel only, never NEXT_PUBLIC_)
 *
 * Runtime DSN is read in the SDK init files from NEXT_PUBLIC_SENTRY_DSN.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
});
