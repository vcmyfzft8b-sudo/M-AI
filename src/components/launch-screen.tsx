import { LaunchScreenDismiss } from "./launch-screen-dismiss";

/**
 * The launch screen the installed app draws for itself: the mark on the app's
 * own canvas, in the document, from the first frame the document paints.
 *
 * There is already a launch screen before this one — the
 * `apple-touch-startup-image` matrix in src/lib/splash-screens.ts — and it
 * covers the part no page can: the window between tapping the icon and the
 * document painting anything. It also comes with four conditions, and a phone
 * that fails any of them shows nothing at all:
 *
 *  - the image's pixels must match the screen exactly, so a screen missing
 *    from the matrix has no launch screen;
 *  - Display Zoom changes what the screen reports (an iPhone 16 in Larger Text
 *    is not 393x852 at 3x any more), and no image matches the sizes it moves
 *    to;
 *  - iOS resolves the image when the web app is added to the home screen, so
 *    an icon carried across from an old phone by a device transfer keeps that
 *    phone's launch screen and drops it on this one;
 *  - Android has no equivalent at all — it builds a splash from the manifest.
 *
 * None of those apply to a picture the page itself draws, which is why this
 * exists as well rather than instead. On a phone where iOS does use the baked
 * image the two are the same mark on the same colour, so the handover is
 * invisible — this holds the mark still while the app finishes arriving
 * underneath it, instead of the image being swapped for a half-drawn screen.
 * It cannot help with the white frame before the document paints at all;
 * that one is the WebView's, and the service worker is what shortens it.
 *
 * Rendered on the server as part of the document, so it needs no JavaScript to
 * appear — only to leave. It is shown solely in an installed app
 * (`display-mode: standalone`, plus iOS's own `navigator.standalone` for
 * belt and braces); in a browser tab the page just loads. See the launch-screen
 * block in redesign.css for both, and for the timeout that hides it even if the
 * app's JavaScript never arrives.
 */
export function LaunchScreen() {
  return (
    <>
      <div className="memo-launch" aria-hidden="true">
        {/*
          * The mark is a CSS background, not an <img>, and that is the whole
          * point of the empty element: a `display: none` box loads no
          * background image, so the website — where this never shows — pays
          * nothing for it, not a request and not a share of the priority its
          * own hero image wants. In the installed app the stylesheet is
          * render-blocking anyway, so the picture is asked for before the
          * first paint it belongs to. See redesign.css.
          */}
        <div className="memo-launch-mark" />
      </div>
      <LaunchScreenDismiss />
    </>
  );
}
