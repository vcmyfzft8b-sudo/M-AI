import assert from "node:assert/strict";
import test from "node:test";

import { parseYoutubeVideoId } from "../src/lib/youtube-url.ts";
import {
  isUnsupportedVideoUrl,
} from "../src/lib/link-source-validation.ts";

test("every YouTube video URL shape yields the same id", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=share-junk",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ]) {
    assert.equal(parseYoutubeVideoId(url), "dQw4w9WgXcQ", url);
  }
});

test("non-video YouTube shapes and other sites yield no id", () => {
  for (const url of [
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/@channel",
    "https://www.youtube.com/",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "not a url",
    "ftp://youtu.be/dQw4w9WgXcQ",
  ]) {
    assert.equal(parseYoutubeVideoId(url), null, url);
  }
});

test("YouTube videos pass link validation while other video platforms stay blocked", () => {
  // Videos are ingested via captions now, so the pre-flight check must let them through.
  assert.equal(isUnsupportedVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), false);
  assert.equal(isUnsupportedVideoUrl("https://youtu.be/dQw4w9WgXcQ"), false);
  // No single transcript exists for a playlist; it keeps the explanatory rejection.
  assert.equal(isUnsupportedVideoUrl("https://www.youtube.com/playlist?list=PL123"), true);
  assert.equal(isUnsupportedVideoUrl("https://vimeo.com/12345"), true);
  assert.equal(isUnsupportedVideoUrl("https://www.tiktok.com/@u/video/1"), true);
  assert.equal(isUnsupportedVideoUrl("https://example.com/lecture.mp4"), true);
});
