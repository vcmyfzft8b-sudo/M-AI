/* Window events that let the hero chrome talk to the phone mockup without
   importing it (the preview is a heavy client bundle). */

/** Asks the mockup to hand control over: stop the guided tour, keep the screen. */
export const PREVIEW_STOP_TOUR_EVENT = "memo-preview:stop-tour";

/** Fired by the mockup once the tour is over, however it was stopped. */
export const PREVIEW_TOUR_STOPPED_EVENT = "memo-preview:tour-stopped";
