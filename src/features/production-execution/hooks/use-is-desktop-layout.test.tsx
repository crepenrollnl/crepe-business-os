import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearMatchMediaStub, stubMatchMedia } from "./stub-match-media";
import { useIsDesktopLayout } from "./use-is-desktop-layout";

describe("useIsDesktopLayout", () => {
  afterEach(() => {
    clearMatchMediaStub();
  });

  it("defaults to desktop when matchMedia is missing", () => {
    clearMatchMediaStub();
    const { result } = renderHook(() => useIsDesktopLayout());
    expect(result.current).toBe(true);
  });

  it("follows the lg breakpoint after mount", async () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useIsDesktopLayout());
    await waitFor(() => expect(result.current).toBe(false));

    act(() => {
      media.setMatches(true);
    });
    expect(result.current).toBe(true);
  });
});
