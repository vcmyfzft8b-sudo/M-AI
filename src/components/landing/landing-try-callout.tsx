"use client";

import { useEffect, useRef, useState } from "react";

import { PREVIEW_STOP_TOUR_EVENT, PREVIEW_TOUR_STOPPED_EVENT } from "./memo-app-preview-events";

/* Stacked hero only: on the side-by-side layout the phone is already in view,
   and scrolling there would yank the page for no reason. Matches the 800px
   breakpoint the hero and the mockup's own measure() use. */
const STACKED_HERO = "(max-width: 799px)";

function revealPhone(from: HTMLElement) {
  const phone = from.parentElement?.querySelector<HTMLElement>(".landing-v2-phone-host");
  if (!phone || !window.matchMedia(STACKED_HERO).matches) return;

  const nav = document.querySelector<HTMLElement>(".landing-v2-nav");
  const headroom = (nav?.getBoundingClientRect().height ?? 0) + 12;
  const rect = phone.getBoundingClientRect();
  const spare = window.innerHeight - headroom - rect.height;
  // Centre it when it fits; otherwise park its top just below the sticky nav
  // so the visitor lands on the screen rather than the phone's bezel.
  const offset = spare > 0 ? headroom + spare / 2 : headroom;

  window.scrollTo({
    top: Math.max(0, window.scrollY + rect.top - offset),
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}

/* Invitation above the phone mockup. Pressing it stops the guided tour and
   hands the mockup over, then retires itself — tapping the phone directly
   does the same thing, so it listens for the handover rather than only
   tracking its own click. */
export function LandingTryCallout() {
  const [handedOver, setHandedOver] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onStopped = () => setHandedOver(true);
    window.addEventListener(PREVIEW_TOUR_STOPPED_EVENT, onStopped);
    return () => window.removeEventListener(PREVIEW_TOUR_STOPPED_EVENT, onStopped);
  }, []);

  return (
    <button
      ref={buttonRef}
      type="button"
      className="landing-v2-try-callout"
      data-handed-over={handedOver ? "" : undefined}
      aria-hidden={handedOver || undefined}
      tabIndex={handedOver ? -1 : undefined}
      onClick={() => {
        window.dispatchEvent(new Event(PREVIEW_STOP_TOUR_EVENT));
        if (buttonRef.current) revealPhone(buttonRef.current);
      }}
    >
      Preizkusi kar tukaj{" "}
      <span className="landing-v2-try-finger" aria-hidden="true">
        👇
      </span>
    </button>
  );
}
