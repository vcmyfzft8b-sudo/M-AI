"use client";

import { useEffect } from "react";

/**
 * How long iOS takes to put the keyboard away, and the shape of that movement.
 *
 * UIKit animates the keyboard with its own curve — `UIViewAnimationCurve(7)`,
 * the private one it reserves for this — over a quarter of a second. These are
 * that animation written as CSS, and they are only ever used for the dismissal:
 * see `settle` for why the page has to draw that one itself.
 */
const KEYBOARD_HIDE_MS = 250;
const KEYBOARD_HIDE_CURVE = [0.38, 0.7, 0.125, 1] as const;

/**
 * A step this big did not come from the keyboard moving — it came from iOS
 * telling us where the keyboard ended up, once. Anything smaller is the real
 * thing arriving in pieces and is published as it lands.
 */
const JUMP_PX = 40;

/** `cubic-bezier(a, b, c, d)` evaluated at `t`, closely enough for one frame. */
function ease(t: number) {
  const [x1, y1, x2, y2] = KEYBOARD_HIDE_CURVE;
  const bezier = (a: number, b: number, u: number) =>
    3 * a * (1 - u) * (1 - u) * u + 3 * b * (1 - u) * u * u + u * u * u;

  // Newton on x to recover the parameter, which is plenty for 250ms of motion.
  let u = t;
  for (let i = 0; i < 5; i += 1) {
    const x = bezier(x1, x2, u) - t;
    const dx =
      3 * x1 * (1 - u) * (1 - 3 * u) + 3 * x2 * u * (2 - 3 * u) + 3 * u * u;

    if (Math.abs(dx) < 1e-6) {
      break;
    }

    u -= x / dx;
  }

  return bezier(y1, y2, Math.min(1, Math.max(0, u)));
}

/**
 * Publishes the soft keyboard's height as `--memo-keyboard` on the document
 * element, which the phone layer reads through `--memo-kb`.
 *
 * The whole redesign layer is written against that variable — sheets pad their
 * feet past it, screens end at it, and every sheet's ground runs behind it.
 *
 * `visualViewport` shrinks by exactly the keyboard's height, which is the
 * design's own measurement:
 *
 *     kb = innerHeight - visualViewport.height - visualViewport.offsetTop
 *
 * `offsetTop` is in there because iOS scrolls the visual viewport within the
 * layout viewport when a field near the bottom is focused; without it the
 * inset reads short by however far it scrolled.
 *
 * Two more measurements go with it, because the inset alone cannot place a
 * sheet on every browser. Mobile Safari does not shrink the layout viewport
 * when the keys come up — it keeps it at full height and *pans* the visual
 * viewport within it — so a sheet on the bottom edge lands correctly while
 * anything measured against the layout viewport is measured against a screen
 * far taller than the one you can see.
 *
 *   --memo-viewport      what is actually visible, top to bottom
 *   --memo-viewport-top  how far the visible area has been panned down
 *   --memo-keyboard-up   whether to leave a field its clearance above the keys
 *
 * There is no CSS unit for any of them: `dvh` answers for browser chrome, `%`
 * for the containing block, and both are the layout viewport.
 *
 * All four are written to the document element rather than into React state so
 * that nothing re-renders per frame while the keyboard animates, and so that
 * portalled sheets — which mount outside the app shell — inherit them too.
 */
export function KeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport) {
      return;
    }

    const root = document.documentElement;
    let previous = "";
    let published = 0;
    /** +1 while the keys are coming up, -1 while they are going away, 0 at rest. */
    let direction = 0;
    let frame = 0;
    let settled = 0;
    /** Set while the page is drawing the dismissal itself. */
    let glideFrom = 0;
    let glideTo = 0;
    let glideStart = 0;

    const measure = () =>
      Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));

    const isTyping = () => {
      const active = document.activeElement;

      return (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement)
      );
    };

    const write = (inset: number) => {
      const height = Math.round(viewport.height);
      const top = Math.max(0, Math.round(viewport.offsetTop));
      const next = `${inset}/${height}/${top}`;

      if (next === previous) {
        return false;
      }

      previous = next;
      published = inset;
      root.style.setProperty("--memo-keyboard", `${inset}px`);
      root.style.setProperty("--memo-viewport", `${height}px`);
      root.style.setProperty("--memo-viewport-top", `${top}px`);
      return true;
    };

    /*
     * Whether to leave a field its clearance above the keys.
     *
     * Focus alone said yes the instant you tapped the field and no the instant
     * you left it — so the clearance vanished in one step while the keys were
     * still halfway down. It stays on until the movement has finished too.
     *
     * Focus has to be part of it because the inset cannot carry this alone:
     * mobile Safari shrinks the layout viewport to sit above the keys, so there
     * the inset is legitimately 0 the whole time the keyboard is up.
     */
    const publishUp = () => {
      const up = isTyping() || direction !== 0 || published > 0 ? 1 : 0;
      root.style.setProperty("--memo-keyboard-up", `${up}`);
    };

    /**
     * The dismissal, drawn here because iOS will not describe it.
     *
     * Raising the keyboard arrives as a stream of viewport updates, so the
     * sheet is driven by the keyboard's own movement and tracks it exactly.
     * Putting it away arrives as a single update, delivered when the animation
     * has already finished — so a sheet that only follows the data sits still
     * for a quarter of a second and then drops in one frame, which is the jump.
     *
     * There is nothing to sample, so the page reproduces the motion instead:
     * UIKit's own duration and curve, stepped every frame. It is the one place
     * in here that animates rather than measures, and only because the
     * alternative is not animating at all.
     */
    const settle = (now: number) => {
      const t = Math.min(1, (now - glideStart) / KEYBOARD_HIDE_MS);
      const moved = write(Math.round(glideFrom + (glideTo - glideFrom) * ease(t)));

      if (t < 1) {
        publishUp();
        return true;
      }

      glideStart = 0;
      direction = 0;
      publishUp();
      return moved;
    };

    const follow = (now: number) => {
      const stillGliding = glideStart > 0;
      const moved = stillGliding ? settle(now) : write(clamp(measure()));

      if (stillGliding) {
        frame = glideStart > 0 ? requestAnimationFrame(follow) : 0;
        return;
      }

      settled = moved ? 0 : settled + 1;

      if (settled < 5) {
        // ~5 frames of stillness is the keyboard having arrived, not a pause.
        frame = requestAnimationFrame(follow);
        publishUp();
        return;
      }

      frame = 0;
      direction = 0;
      publishUp();
    };

    /*
     * The two halves of the measurement do not land on the same frame. While
     * the keyboard retracts, `height` can have grown back before `offsetTop`
     * has returned to zero, and the subtraction between them dips and recovers
     * — which the sheet followed faithfully, jumping down and up again. A
     * keyboard only travels one way at a time, so once a direction is set the
     * reading is held to it and the wobble never reaches the page.
     */
    function clamp(raw: number) {
      return direction > 0
        ? Math.max(published, raw)
        : direction < 0
          ? Math.min(published, raw)
          : raw;
    }

    const glide = (to: number) => {
      glideFrom = published;
      glideTo = to;
      glideStart = performance.now();
      direction = Math.sign(to - published);
      publishUp();

      if (!frame) {
        frame = requestAnimationFrame(follow);
      }
    };

    const track = () => {
      const raw = measure();
      const step = raw - published;

      if (glideStart) {
        // Already drawing one; let it finish rather than restart from here.
        return;
      }

      if (Math.abs(step) >= JUMP_PX && !isTyping()) {
        // Reported in one piece: draw it rather than snap to it.
        glide(raw);
        return;
      }

      if (!frame) {
        direction = Math.sign(step);
        settled = 0;
      }

      write(clamp(raw));
      publishUp();

      if (!frame) {
        frame = requestAnimationFrame(follow);
      }
    };

    /*
     * The dismissal has to start here, not at the viewport event.
     *
     * iOS reports the keyboard's new size once the animation has already run,
     * so an animation started from that event begins a quarter of a second
     * after the keys did and finishes long after they have gone — which reads
     * as the sheet moving at the wrong moment rather than with them. Blur is
     * the moment the keyboard starts leaving, so the two set off together.
     *
     * `focusout` fires before focus lands anywhere new, so the check is
     * deferred a tick: tabbing between two fields keeps the keyboard up and
     * must not start a dismissal.
     */
    const onFocusOut = () => {
      window.setTimeout(() => {
        if (!isTyping() && published > 0 && !glideStart) {
          glide(0);
        }
      }, 0);
    };

    write(measure());
    publishUp();
    viewport.addEventListener("resize", track);
    viewport.addEventListener("scroll", track);
    document.addEventListener("focusin", track);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }

      viewport.removeEventListener("resize", track);
      viewport.removeEventListener("scroll", track);
      document.removeEventListener("focusin", track);
      document.removeEventListener("focusout", onFocusOut);
      root.style.removeProperty("--memo-keyboard-up");
      root.style.removeProperty("--memo-keyboard");
      root.style.removeProperty("--memo-viewport");
      root.style.removeProperty("--memo-viewport-top");
    };
  }, []);

  return null;
}
