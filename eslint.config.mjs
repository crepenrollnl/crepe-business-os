import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Forbid feature modules from importing another module's UI layers.
 * Cross-module communication must go through services / shared types.
 * See docs/MODULE_FOUNDATION.md.
 *
 * `app/` may mount feature pages and auth guards (not covered by this rule).
 * Auth / dashboard keep absolute self-imports, so they are exempt.
 */
const moduleBoundaryRule = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          regex:
            "^@/features/[^/]+/(components|hooks|page)(/|$)",
          message:
            "Do not import another module's components, hooks, or pages. Communicate through services. See docs/MODULE_FOUNDATION.md.",
        },
      ],
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: moduleBoundaryRule,
  },
  {
    files: [
      "src/features/auth/**/*.{ts,tsx}",
      "src/features/dashboard/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
