import { DESKTOP_LAYOUT_MEDIA_QUERY } from "./use-is-desktop-layout";

type MediaListener = (event: MediaQueryListEvent) => void;

/** Test helper: control the `lg` desktop layout query. */
export function stubMatchMedia(matches: boolean): { setMatches: (next: boolean) => void } {
  let current = matches;
  const listeners = new Set<MediaListener>();

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        return current;
      },
      media: query,
      addEventListener: (_event: string, listener: MediaListener) => {
        listeners.add(listener);
      },
      removeEventListener: (_event: string, listener: MediaListener) => {
        listeners.delete(listener);
      },
      addListener: (listener: MediaListener) => {
        listeners.add(listener);
      },
      removeListener: (listener: MediaListener) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => false,
      onchange: null,
    }),
  });

  return {
    setMatches: (next: boolean) => {
      current = next;
      const event = {
        matches: next,
        media: DESKTOP_LAYOUT_MEDIA_QUERY,
      } as MediaQueryListEvent;
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

export function clearMatchMediaStub(): void {
  if (typeof window === "undefined") {
    return;
  }

  Reflect.deleteProperty(window, "matchMedia");
}
