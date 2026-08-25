"use client";

// Dropping a file anywhere a page does not handle it makes the browser navigate to that file, and
// on macOS a .wav handed to the system opens Music — the app the learner was using disappears
// behind a music player, with no error and nothing uploaded. Dragging a recording onto the page
// is the obvious thing to try, so the default has to be neutralised even where dropping is not
// supported.
//
// The guard only claims events no drop target has already handled: a real drop zone calls
// preventDefault first, and by the time the event bubbles to the window `defaultPrevented` is
// set, so this stays out of its way.

import { useEffect } from "react";

function isFileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function WindowFileDropGuard() {
  useEffect(() => {
    const handleDragOver = (event: DragEvent) => {
      if (event.defaultPrevented || !isFileDrag(event)) {
        return;
      }

      event.preventDefault();

      if (event.dataTransfer) {
        // Shows the "no drop" cursor, so the drag reads as unsupported rather than as ignored.
        event.dataTransfer.dropEffect = "none";
      }
    };

    const handleDrop = (event: DragEvent) => {
      if (event.defaultPrevented || !isFileDrag(event)) {
        return;
      }

      event.preventDefault();
    };

    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  return null;
}
