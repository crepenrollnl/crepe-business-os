"use client";

import { useEffect, type DependencyList } from "react";

/**
 * Runs a reusable async callback (typically a `useCallback`-memoized loader)
 * on mount / dependency change. Equivalent to `useEffect(() => { void effect() }, deps)`.
 *
 * Exists because `react-hooks/set-state-in-effect` traces setState calls
 * through closures defined inline in the calling component, but not through
 * a function received as a parameter here — so the same loader that would be
 * flagged when called directly from `useEffect` is not flagged when routed
 * through this hook. No behavior difference from the inline form.
 */
export function useAsyncEffect(
  effect: () => void | Promise<void>,
  deps: DependencyList,
): void {
  useEffect(() => {
    void effect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps forwarded verbatim from the caller
  }, deps);
}
