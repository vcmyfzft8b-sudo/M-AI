"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * The desktop redesign changes its column template depending on what the note
 * screen is showing: with the chat panel open the nav rail collapses to icons
 * and a third column appears beside the note. Only the note screen knows
 * whether chat is open, and only the shell owns the grid — so the two talk
 * through this context.
 *
 * `chatSlot` is the third grid cell. The note screen portals its panel into
 * it, which keeps the panel a real grid child (so it can be sticky and full
 * height) without the shell having to know anything about chat.
 */
type AppLayoutValue = {
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  chatSlot: HTMLElement | null;
};

const AppLayoutContext = createContext<AppLayoutValue>({
  chatOpen: false,
  setChatOpen: () => {},
  chatSlot: null,
});

export function AppLayoutProvider({
  children,
}: {
  children: (value: {
    chatOpen: boolean;
    registerChatSlot: (node: HTMLElement | null) => void;
  }) => ReactNode;
}) {
  const [chatOpen, setChatOpenState] = useState(false);
  const [chatSlot, setChatSlot] = useState<HTMLElement | null>(null);

  const setChatOpen = useCallback((open: boolean) => setChatOpenState(open), []);
  const registerChatSlot = useCallback((node: HTMLElement | null) => setChatSlot(node), []);

  /*
   * The chat panel is `position: fixed`, so it cannot inherit its column's box
   * from the grid. Restating that geometry in CSS meant duplicating the track
   * sizes, the gutter and the gap — and any disagreement showed up as the panel
   * sitting over the note card. Measuring the slot instead makes the panel
   * exactly its column, at any width, whatever the grid does later.
   */
  useEffect(() => {
    if (!chatSlot) {
      return;
    }

    const sync = () => {
      const box = chatSlot.getBoundingClientRect();
      chatSlot.style.setProperty("--memo-chat-left", `${box.left}px`);
      chatSlot.style.setProperty("--memo-chat-width", `${box.width}px`);
      // The slot's offset from the top of the document is where the note column
      // starts, just below the header's rule. Adding the scroll position back
      // makes it scroll-invariant, so a panel pinned there never rides up over
      // that line — which a plain viewport inset did.
      chatSlot.style.setProperty(
        "--memo-chat-top",
        `${Math.round(box.top + window.scrollY)}px`,
      );
    };

    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(chatSlot);
    // The slot's own size is unchanged when only the gutter moves, so the
    // window needs watching too.
    window.addEventListener("resize", sync);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [chatSlot]);

  const value = useMemo(
    () => ({ chatOpen, setChatOpen, chatSlot }),
    [chatOpen, chatSlot, setChatOpen],
  );

  return (
    <AppLayoutContext.Provider value={value}>
      {children({ chatOpen, registerChatSlot })}
    </AppLayoutContext.Provider>
  );
}

export function useAppLayout() {
  return useContext(AppLayoutContext);
}
