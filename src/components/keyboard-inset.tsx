"use client";

import { useEffect } from "react";

/**
 * How long iOS takes to move the keyboard, and the shape of that movement.
 *
 * UIKit animates the keyboard with its own curve — `UIViewAnimationCurve(7)`,
 * the private one it reserves for this — over a quarter of a second. These are
 * that animation written as CSS, and two things are drawn on them: the
 * dismissal, which iOS will not describe (see `settle`), and the clearance,
 * which no platform describes because it is ours (see `rampUp`).
 */
const KEYBOARD_MS = 250;
const KEYBOARD_CURVE = [0.38, 0.7, 0.125, 1] as const;

/**
 * A step this big did not come from the keyboard moving — it came from iOS
 * telling us where the keyboard ended up, once. Anything smaller is the real
 * thing arriving in pieces and is published as it lands.
 */
const JUMP_PX = 40;

/** `cubic-bezier(a, b, c, d)` evaluated at `t`, closely enough for one frame. */
function ease(t: number) {
  const [x1, y1, x2, y2] = KEYBOARD_CURVE;
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
 * The inset is the answer to one question — how much of something anchored to
 * the bottom of the page is the keyboard covering — and it is read off a box
 * pinned there rather than reconstructed from window metrics:
 *
 *     kb = footOfThePage.bottom - (visualViewport.offsetTop + height)
 *
 * `offsetTop` is in there because WebKit scrolls the visual viewport within the
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
    let previousInset = -1;
    let previousHeight = -1;
    let previousTop = -1;
    let published = 0;
    /** +1 while the keys are coming up, -1 while they are going away, 0 at rest. */
    let direction = 0;
    let frame = 0;
    let settled = 0;
    /** Set while the page is drawing the dismissal itself. */
    let glideFrom = 0;
    let glideTo = 0;
    let glideStart = 0;
    /** The clearance ramp: how far the foot has crossed over, and to where. */
    let upPublished = 0;
    let upFrom = 0;
    let upTo = 0;
    let upStart = 0;
    /** `visualViewport.height` with nothing focused — the bar's control. */
    let restingHeight = 0;
    let barPublished = "";
    /** When the current field took focus, for the accessory bar's wait. */
    let focusedAt = 0;
    let barTimer = 0;
    /**
     * Whether this browser pans the page out from under the keyboard rather
     * than leaving it behind them.
     *
     * Mobile Safari does: it keeps a layout viewport the page cannot see all of
     * and slides the visible part up, so the bottom edge of the page *is* the
     * keyboard's top edge and nothing is ever behind the keys. The wrapper and
     * Android do not — there the page keeps its height and the keyboard sits on
     * top of it, which is the inset every sheet pads past.
     *
     * Worth latching rather than re-deciding each frame, because the two are
     * only distinguishable once the browser has finished moving: for a frame or
     * two at the start of a Safari keyboard the page is still full height with
     * only the top of it visible, which measures as a whole keyboard's worth of
     * ground and paints a strip of sheet that is gone again by the next frame.
     * Once a browser has shown itself to be a panning one it stays one.
     */
    let pans = false;
    /**
     * The very first keyboard of a page load is held back one frame.
     *
     * That is the one moment the two regimes look alike: a panning browser
     * reports the shrunken visual viewport a frame before it has finished with
     * the layout viewport, so the page is briefly its full height with only the
     * top of it visible, and the ground measures a whole keyboard that is about
     * to turn out not to be there. One frame later the browser has settled and
     * `pans` has the answer for the rest of the session — so the wait is over
     * as soon as it has been paid, and where the keyboard is real the second
     * frame simply agrees and nothing is lost but a frame of it.
     *
     * The wrapper is excused: it is a WKWebView we configure ourselves, it
     * never pans, and there is no reason to spend a frame asking.
     */
    let sawKeyboard = root.hasAttribute("data-native");
    /** Frame counter, and the frame the held rise was first seen on. */
    let frameId = 1;
    let heldFrame = 0;

    const notePanning = () => {
      if (
        !pans &&
        (viewport.offsetTop > 0 ||
          document.documentElement.clientHeight !== window.innerHeight)
      ) {
        pans = true;
      }
    };

    /*
     * A foot pinned to the bottom edge, so the keyboard can be measured against
     * the thing that actually needs the answer.
     *
     * Everything the phone layer does with `--memo-kb` comes down to one
     * question: how much of something anchored to the bottom of the page is the
     * keyboard covering? That is a geometric fact about this browser's layout,
     * and it can be read off a box rather than reconstructed from window
     * metrics — which is what the old `innerHeight - height - offsetTop` was
     * doing, and which tears. WebKit updates the three of them on different
     * frames, and the subtraction between a new value and two stale ones is a
     * keyboard that is not there.
     *
     * `visibility: hidden` still lays out, so the box costs nothing to paint.
     */
    const ground = document.createElement("div");
    ground.setAttribute("aria-hidden", "true");
    ground.style.cssText =
      "position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none";
    document.body.appendChild(ground);

    const rawInset = () =>
      Math.max(
        0,
        Math.round(
          ground.getBoundingClientRect().bottom -
            (viewport.offsetTop + viewport.height),
        ),
      );

    const measure = () => {
      notePanning();

      if (pans) {
        return 0;
      }

      const raw = rawInset();

      if (raw === 0 || sawKeyboard) {
        return raw;
      }

      // Counted in frames rather than calls: this runs from the viewport
      // listener as well as the loop, and two calls in one frame would spend
      // the wait without any of it having passed.
      if (!heldFrame || heldFrame === frameId) {
        heldFrame = heldFrame || frameId;
        return 0;
      }

      sawKeyboard = true;
      return raw;
    };

    /**
     * Nothing focused and nothing being drawn: there is no keyboard, whatever
     * the arithmetic says this frame.
     *
     * This is what stops the tail wobble. The two halves of the measurement do
     * not settle together, so for a few frames after the keys have gone the
     * subtraction still produces a number — and the box, having just arrived at
     * the bottom, bounced back up and down again on its way to nothing. There
     * is no field to type into, so the answer is 0 and there is nothing to
     * interpolate towards.
     */
    const idle = () => !glideStart && !isTyping();

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
      /*
       * At rest the page is not panned, whatever the last reading said. iOS
       * pans the visual viewport to clear the keys and unwinds it afterwards,
       * and the unwinding is reported in pieces — so a stale `offsetTop` landed
       * after the keyboard had gone and shifted every fixed screen by it.
       */
      const top = idle() ? 0 : Math.max(0, Math.round(viewport.offsetTop));
      published = inset;

      /*
       * One property at a time. Through the keyboard's movement the inset
       * changes every frame and the other two do not, and writing all three
       * anyway invalidates style for the whole document sixty times a second
       * to say nothing has changed — which is frames the movement could have
       * had instead.
       */
      let moved = false;

      if (inset !== previousInset) {
        previousInset = inset;
        moved = true;
        root.style.setProperty("--memo-keyboard", `${inset}px`);
      }

      if (height !== previousHeight) {
        previousHeight = height;
        moved = true;
        root.style.setProperty("--memo-viewport", `${height}px`);
      }

      if (top !== previousTop) {
        previousTop = top;
        moved = true;
        root.style.setProperty("--memo-viewport-top", `${top}px`);
      }

      return moved;
    };

    /*
     * Whether to leave a field its clearance above the keys.
     *
     * A fraction rather than a flag, because the two states it picks between
     * are different heights: a foot at rest clears the home indicator, a foot
     * under the keyboard clears the keys by 12pt, and the first is much the
     * larger. Switched in one frame, that difference arrives as a hop — the
     * box slides all the way down and then jumps back up by it. Ramped across
     * the keyboard's own curve, the two paddings cross over while the keyboard
     * is still travelling and the foot lands once.
     *
     * Focus is what starts the ramp, because the inset cannot: mobile Safari
     * puts the page's bottom edge *on* the keyboard rather than behind it, so
     * there the inset is legitimately 0 the whole time the keys are up and
     * nothing in the measurement ever moves. That is also why the ramp is here
     * rather than left to a CSS transition on the foot: the foot is padding on
     * a scrolling box, and transitioning it reflows the scrollport every frame.
     */
    const writeUp = (value: number) => {
      const next = Math.round(value * 1000) / 1000;

      if (next === upPublished) {
        return false;
      }

      upPublished = next;
      root.style.setProperty("--memo-keyboard-up", `${next}`);
      return true;
    };

    /** Start (or redirect) the clearance ramp towards `to`, on UIKit's curve. */
    const rampUp = (to: number) => {
      if (upTo === to && (upStart > 0 || upPublished === to)) {
        return;
      }

      upFrom = upPublished;
      upTo = to;
      upStart = performance.now();

      if (!frame) {
        frame = requestAnimationFrame(follow);
      }
    };

    /** Advances the ramp one frame. Returns whether it is still running. */
    const stepUp = (now: number) => {
      if (!upStart) {
        return false;
      }

      const t = Math.min(1, (now - upStart) / KEYBOARD_MS);
      writeUp(upFrom + (upTo - upFrom) * ease(t));

      if (t >= 1) {
        upStart = 0;
        return false;
      }

      return true;
    };

    /*
     * Safari's form accessory bar — the strip of arrows and Done above the keys.
     *
     * It is reserved only when it is genuinely covering the page, and that is
     * something to measure rather than assume. With the software keyboard up,
     * `visualViewport` stops above the bar and a `position: fixed` foot lands
     * on the keyboard's top edge, so reserving anything for it takes a strip
     * out of the sheet for nothing — and the scrollport, which ends where that
     * strip begins, then slices the field you are typing into in half.
     *
     * The bar does come down on the page in the one case where nothing else
     * moved: a hardware keyboard attached, where iOS draws the bar on its own
     * and the viewport stays exactly where it was. That is what this answers,
     * and the only way to tell it from an ordinary keyboard that has not been
     * reported yet is to wait out the keyboard's own animation first — which
     * is why it is asked again on a timer rather than decided at focus.
     */
    const publishBar = () => {
      const settled = restingHeight > 0 ? restingHeight : viewport.height;
      const overlaps =
        isTyping() &&
        !pans &&
        published === 0 &&
        focusedAt > 0 &&
        performance.now() - focusedAt >= KEYBOARD_MS &&
        viewport.offsetTop < 8 &&
        viewport.height >= settled - 8;
      const next = overlaps ? "1" : "0";

      if (next !== barPublished) {
        barPublished = next;
        root.style.setProperty("--memo-keyboard-bar", next);
      }
    };

    /**
     * The movement, drawn here for the parts iOS will not describe.
     *
     * Where the keyboard arrives as a stream of viewport updates the sheet is
     * driven by the keyboard's own movement and tracks it exactly, and none of
     * this runs. But iOS also delivers a whole keyboard in one update — always
     * for the dismissal, which it reports once the animation has already
     * finished, and for the rise too wherever it does not stream it. A sheet
     * that only follows the data then moves the entire inset in one frame,
     * which is the jump.
     *
     * There is nothing to sample in that case, so the page reproduces the
     * motion instead: UIKit's own duration and curve, stepped every frame. It
     * is the one place in here that animates rather than measures, and only
     * because the alternative is not animating at all. Readings that land while
     * it runs correct its destination without restarting it, so a stream that
     * begins with one large step still ends up exactly where the keys are.
     */
    const settle = (now: number) => {
      const t = Math.min(1, (now - glideStart) / KEYBOARD_MS);
      const eased = ease(t);
      const moved = write(
        Math.round(glideFrom + (glideTo - glideFrom) * eased),
      );

      if (t < 1) {
        return true;
      }

      glideStart = 0;
      direction = 0;
      return moved;
    };

    function follow(now: number) {
      frameId += 1;
      const stillGliding = glideStart > 0;
      const moved = stillGliding
        ? settle(now)
        : write(idle() ? 0 : clamp(measure()));
      const ramping = stepUp(now);

      publishBar();

      if (stillGliding || glideStart > 0) {
        frame = requestAnimationFrame(follow);
        return;
      }

      settled = moved ? 0 : settled + 1;

      if (settled < 5 || ramping) {
        // ~5 frames of stillness is the keyboard having arrived, not a pause.
        frame = requestAnimationFrame(follow);
        return;
      }

      frame = 0;
      direction = 0;
    }

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

      // Same instant, same duration, same curve as the ground it belongs to.
      if (to > 0) {
        rampUp(1);
        upStart = glideStart;
      }

      if (!frame) {
        frame = requestAnimationFrame(follow);
      }
    };

    const track = () => {
      const raw = measure();
      const step = raw - published;

      /*
       * The clearance sets off with the ground, never before it.
       *
       * Focus is not the moment the keyboard moves: iOS reports the first
       * viewport change 124ms after `focusin` — measured on an iPhone 17 —
       * and a clearance already ramping through that window tightens the foot
       * by 54pt against a ground that is still flat, so the sheet drops that
       * far before it rises. Waiting for the ground means the two cross over
       * on the same clock and the foot only ever moves one way.
       *
       * A browser that pans is the exception, because there the ground never
       * moves at all and there would be nothing to wait for.
       */
      if (isTyping() && (pans || glideStart || published > 0 || raw > 0)) {
        rampUp(1);
      }

      if (isTyping() && !focusedAt) {
        focusedAt = performance.now();
        barTimer = window.setTimeout(publishBar, KEYBOARD_MS + 32);
      }

      if (glideStart) {
        /*
         * Already drawing one. Later readings correct where it is going rather
         * than restarting it — same clock, same curve, new destination — so a
         * keyboard that turns out to be taller than the first report said still
         * arrives on time. Only ever further along the way it was already
         * going: the readings wobble on the way down, and following that is
         * what made the box jump down and up again.
         */
        if (Math.sign(raw - glideTo) === Math.sign(glideTo - glideFrom)) {
          glideTo = raw;
        }

        return;
      }

      if (Math.abs(step) >= JUMP_PX) {
        /*
         * Reported in one piece: draw it rather than snap to it.
         *
         * Both ways. Putting the keyboard away always arrives like this, after
         * the fact — but iOS hands the *rise* over in one piece too wherever it
         * does not stream it (the simulator, measured: 874 to 566 between one
         * frame and the next), and a sheet that only follows the data jumps the
         * whole 308px in a frame while the keys are still sliding up. Drawn on
         * UIKit's own duration and curve it goes up with them.
         */
        glide(raw);
        return;
      }

      if (!frame) {
        direction = Math.sign(step);
        settled = 0;
      }

      write(idle() ? 0 : clamp(raw));

      if (!isTyping() && !glideStart && raw === 0) {
        restingHeight = viewport.height;
      }

      publishBar();

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
        if (isTyping()) {
          return;
        }

        focusedAt = 0;
        window.clearTimeout(barTimer);
        rampUp(0);

        if (published > 0 && !glideStart) {
          glide(0);
        }
      }, 0);
    };

    write(measure());
    restingHeight = viewport.height;
    writeUp(isTyping() ? 1 : 0);
    publishBar();
    viewport.addEventListener("resize", track);
    viewport.addEventListener("scroll", track);
    document.addEventListener("focusin", track);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }

      window.clearTimeout(barTimer);

      ground.remove();
      viewport.removeEventListener("resize", track);
      viewport.removeEventListener("scroll", track);
      document.removeEventListener("focusin", track);
      document.removeEventListener("focusout", onFocusOut);
      root.style.removeProperty("--memo-keyboard-up");
      root.style.removeProperty("--memo-keyboard-bar");
      root.style.removeProperty("--memo-keyboard");
      root.style.removeProperty("--memo-viewport");
      root.style.removeProperty("--memo-viewport-top");
    };
  }, []);

  return null;
}
