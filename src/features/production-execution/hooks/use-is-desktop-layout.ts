"use client";

import { useEffect, useState } from "react";

/** Tailwind `lg`. Desktop-first so SSR and Playwright Desktop Chrome mount the table. */
export const DESKTOP_LAYOUT_MEDIA_QUERY = "(min-width: 1024px)";

export function useIsDesktopLayout(): boolean {
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia(DESKTOP_LAYOUT_MEDIA_QUERY);
    const update = () => {
      setIsDesktop(media.matches);
    };

    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isDesktop;
}
