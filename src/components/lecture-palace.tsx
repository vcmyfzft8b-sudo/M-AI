"use client";

import { Loader2 } from "lucide-react";
/* Aliased: `Image` on its own is the DOM constructor the minimap loads with. */
import NextImage from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { useT } from "@/components/i18n-provider";
import { StudyGenerationNotice } from "@/components/generation-notice";
import { MemoPortal } from "@/components/memo-portal";
import { Emoji, Msym } from "@/components/msym";
import { StudyCompletionCard } from "@/components/study-completion-card";
import { StudyFlashcard, type StudyFlashcardExit } from "@/components/study-flashcard";
import { sheetClass, useSheet } from "@/components/use-sheet";
import {
  FLASHCARD_EXIT_ANIMATION_MS,
  type FlashcardBucket,
} from "@/lib/study/flashcard-drag";
import { quizOptionLetter, shuffleIndices } from "@/lib/study/quiz";
import type { PalaceGame, PalaceSnapshot } from "@/lib/palace/game";
import {
  buildPalaceLayout,
  mapArrowAngle,
  mapExtent,
  selectPalaceItems,
  STATION_HUE,
  type StudyKind,
} from "@/lib/palace/layout";
import type {
  FlashcardWithCitations,
  PracticeTestQuestion,
  QuizQuestionWithOptions,
  StudySectionWithProgress,
} from "@/lib/types";

/**
 * The memory palace.
 *
 * The oldest study technique there is, which is why it is worth building: a walk
 * through a place is held far better than a list. So the note's own study
 * material is scattered through a town — one neighbourhood per section of the
 * note, one house per item, every house built differently — and you walk it.
 *
 * What waits outside a house is the app's own study screen, not a copy of it:
 * the flashcard that flips, the quiz that marks you, the practice question with
 * its model answer. The town is the index; the screens are the ones the rest of
 * the app already uses.
 *
 * A recall here is a recall everywhere: grading a flashcard posts to the same
 * progress the deck screen writes.
 *
 * The engine is loaded only when the door is opened — three.js is far too much
 * to hand every reader of a note.
 */

const COLLECTED_STORAGE_PREFIX = "memo.palace.collected.";
/** Memo's mascot, the same file the town hangs outside its houses. */
const MASCOT_SRC = "/memo-mascot.png";
/** How far the minimap sees, in metres — about two blocks in every direction. */
const MAP_RANGE = 95;
/**
 * The most faces the map will draw at once. Past this it stops being a map and
 * starts being a pile of stickers, and the nearest few are the ones being
 * walked to anyway.
 */
const MAX_MAP_MARKERS = 5;
/**
 * Out of five, the mark at which a practice answer counts as known and its
 * house is collected. The same three-out-of-five a teacher would call a pass.
 */
const PRACTICE_PASS_SCORE = 3;

/** What the marker sends back for one answer. */
type PracticeMark = {
  marked: boolean;
  score?: number;
  maxScore: number;
  expectedAnswer: string;
  strengths?: string;
  missingPoints?: string;
};
/** The stick is dead in the middle, so a resting thumb is not a slow walk. */
/*
 * How long an answered quiz stays up before the walk resumes. A tick needs long
 * enough to register; a wrong answer, or one the note explains, needs reading.
 */
const QUIZ_RESULT_PAUSE = 1600;
const QUIZ_RESULT_READ_PAUSE = 6000;
const STICK_DEADZONE = 6;
const STICK_RADIUS = 46;

function readCollected(lectureId: string) {
  try {
    const raw = window.localStorage.getItem(`${COLLECTED_STORAGE_PREFIX}${lectureId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    /* A private window with storage switched off still gets to play. */
    return new Set<string>();
  }
}

function writeCollected(lectureId: string, collected: Set<string>) {
  try {
    window.localStorage.setItem(
      `${COLLECTED_STORAGE_PREFIX}${lectureId}`,
      JSON.stringify([...collected]),
    );
  } catch {
    /* Nothing to do about it, and nothing worth interrupting the game for. */
  }
}

export function LecturePalace({
  lectureId,
  cards,
  quizQuestions,
  practiceQuestions,
  sections,
  isReady,
  onLeave,
}: {
  lectureId: string;
  cards: FlashcardWithCitations[];
  quizQuestions: QuizQuestionWithOptions[];
  practiceQuestions: PracticeTestQuestion[];
  sections: StudySectionWithProgress[];
  isReady: boolean;
  /** Where "back to the note" goes: the note itself, not this tab. */
  onLeave?: () => void;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  /* The same map again, whole and still, for when the corner one is not enough. */
  const townMapRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<PalaceGame | null>(null);
  const snapshotRef = useRef<PalaceSnapshot | null>(null);
  const stickRef = useRef<{ pointerId: number; originX: number; originY: number } | null>(null);
  const lookRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const exitTokenRef = useRef(0);

  const [isOpen, setIsOpen] = useState(false);
  /*
   * True from the moment the door opens until the town is on screen. Driving it
   * off "is the loader running" left one frame where the overlay was up, the
   * engine had not started, and the reader saw an empty stage.
   */
  const [isBuilt, setIsBuilt] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collected, setCollected] = useState<Set<string>>(() => new Set());
  const [nearStationId, setNearStationId] = useState<string | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [quizChoice, setQuizChoice] = useState<number | null>(null);
  /* Shuffled once when the station opens, exactly as the quiz screen does it. */
  const [quizOrder, setQuizOrder] = useState<number[]>([]);
  const [testAnswer, setTestAnswer] = useState("");
  const [isTestUnknown, setIsTestUnknown] = useState(false);
  const [isMarking, setIsMarking] = useState(false);
  const [mark, setMark] = useState<PracticeMark | null>(null);
  const [cardExit, setCardExit] = useState<StudyFlashcardExit | null>(null);
  /* How each stop went this session, for the label the deck screen shows too. */
  const [results, setResults] = useState<Record<string, "again" | "easy">>({});
  const [districtIndex, setDistrictIndex] = useState(0);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [stickKnob, setStickKnob] = useState<{ x: number; y: number } | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  /*
   * Bumped when the GPU drops the drawing context: the canvas element itself
   * has to be replaced, because a lost context cannot be reopened on it.
   */
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  /* The mascot, loaded once so the map can draw the real thing on every stop. */
  const mascotRef = useRef<HTMLImageElement | null>(null);
  /*
   * The mascot again, pre-scaled to exactly the size the map draws it at. A
   * 320px sticker rescaled thirty times a frame is both wasted work and the
   * reason the icons crawl as the map moves.
   */
  const mascotTileRef = useRef<HTMLCanvasElement | null>(null);
  /*
   * The map's backing store is sized to the device's pixels, not left at some
   * round number and squeezed into whatever CSS gives it: a canvas drawn at 220
   * and displayed at 122 shimmers on every line the moment anything moves.
   */
  const minimapSizeRef = useRef({ css: 0, dpr: 1 });
  /* The pending auto-dismiss of an answered quiz, so nothing closes a station
     the player has already walked on from. */
  const dismissRef = useRef<number | null>(null);
  const clearDismiss = useCallback(() => {
    if (dismissRef.current === null) return;

    window.clearTimeout(dismissRef.current);
    dismissRef.current = null;
  }, []);

  useEffect(() => clearDismiss, [clearDismiss]);

  useEffect(() => {
    const image = new Image();

    image.src = MASCOT_SRC;
    image.decoding = "async";
    image.onload = () => {
      mascotTileRef.current = null;
    };
    mascotRef.current = image;
  }, []);

  /* Defined below; the callback ref runs before it exists. */
  const sizeMinimapRef = useRef<() => void>(() => {});

  /*
   * The map is measured from a callback ref rather than an effect: the overlay
   * is portalled, and the portal renders nothing on the pass that opens it, so
   * an effect that reached for the canvas then would find null.
   */
  const attachMinimap = useCallback((node: HTMLCanvasElement | null) => {
    minimapRef.current = node;

    if (node) {
      sizeMinimapRef.current();
    }
  }, []);

  const sizeMinimap = useCallback(() => {
    const canvas = minimapRef.current;

    if (!canvas) return;

    /* The content box, not the border box: the border is not drawn into. */
    const css = canvas.clientWidth;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (css === 0) return;
    if (minimapSizeRef.current.css === css && minimapSizeRef.current.dpr === dpr) return;

    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    minimapSizeRef.current = { css, dpr };
    /* The tile is cut for one resolution; a new one needs a new tile. */
    mascotTileRef.current = null;
  }, []);

  sizeMinimapRef.current = sizeMinimap;

  const items = useMemo(
    () =>
      selectPalaceItems({
        cards: cards.map((card) => ({
          id: card.id,
          sectionId: card.section_id,
          /* Higher is more important; the walk takes the important ones first. */
          weight: card.coverage_rank,
          /* And covers every concept once before asking about any of them twice. */
          conceptKey: card.concept_key,
        })),
        quiz: quizQuestions,
        test: practiceQuestions.map((question) => ({
          id: question.id,
          weight: question.importance ?? 0,
        })),
      }),
    [cards, practiceQuestions, quizQuestions],
  );

  const layout = useMemo(
    () =>
      items.length === 0
        ? null
        : buildPalaceLayout({
            seedSource: lectureId,
            items,
            sections: sections.map((section) => ({ id: section.id, title: section.title })),
            fallbackTitle: t("palace.district.default"),
          }),
    [items, lectureId, sections, t],
  );

  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const quizById = useMemo(
    () => new Map(quizQuestions.map((question) => [question.id, question])),
    [quizQuestions],
  );
  const testById = useMemo(
    () => new Map(practiceQuestions.map((question) => [question.id, question])),
    [practiceQuestions],
  );

  /* Where the walk got to last time, restored on the client only. */
  useEffect(() => {
    setCollected(readCollected(lectureId));
  }, [lectureId]);

  useEffect(() => {
    setIsTouch(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  const station = useMemo(
    () => layout?.stations.find((entry) => entry.id === nearStationId) ?? null,
    [layout, nearStationId],
  );
  /*
   * The material behind the open station. A note whose deck is regenerated
   * mid-walk can leave a stop pointing at a card that no longer exists, and
   * since arriving freezes the walker, an empty panel would be a dead end —
   * so a stop with nothing behind it is simply not a stop.
   */
  const stationItem = useMemo(() => {
    if (!station) return null;

    if (station.kind === "card") return cardsById.get(station.id) ?? null;
    if (station.kind === "quiz") return quizById.get(station.id) ?? null;

    return testById.get(station.id) ?? null;
  }, [cardsById, quizById, station, testById]);

  /*
   * The options are shuffled when the station opens, the way the quiz screen
   * shuffles them when a round starts: the same question should not always have
   * its answer at B.
   */
  useEffect(() => {
    if (!station || station.kind !== "quiz") return;

    const question = quizById.get(station.id);

    setQuizOrder(question ? shuffleIndices(question.options.length) : []);
  }, [quizById, station]);

  /**
   * The map, which is how you find the next one.
   *
   * Centred on the player and zoomed to the few streets around them, because a
   * whole town squeezed into a circle this size is a smudge. Memo's own face
   * marks every house that still has something waiting — the same mascot that
   * is standing on the path outside it — so "where next" is answered by
   * looking. Stops beyond the edge of the map are pinned to the rim in the
   * direction they lie, so the map always has a next move in it, and the ones
   * already done fade to a tick.
   */
  const drawMinimap = useCallback(
    (snapshot: PalaceSnapshot, collectedIds: Set<string>) => {
      const canvas = minimapRef.current;

      if (!canvas || !layout) return;

      const context = canvas.getContext("2d");

      if (!context) return;

      /*
       * The map's box changes for reasons no event reliably reports in time — a
       * breakpoint crossing, a rotation, the panel around it reflowing — and a
       * backing store cut for the old size is drawn at the wrong resolution
       * until something else moves. One integer compare a frame settles it.
       */
      if (canvas.clientWidth !== minimapSizeRef.current.css) {
        sizeMinimap();
      }

      const { css: size, dpr } = minimapSizeRef.current;

      if (size === 0) return;

      /* Everything below is in CSS pixels; the transform does the rest. */
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const radius = size / 2;
      const scale = radius / MAP_RANGE;
      const toCanvas = (x: number, z: number) => ({
        x: radius + (x - snapshot.x) * scale,
        y: radius + (z - snapshot.z) * scale,
      });

      context.clearRect(0, 0, size, size);
      context.save();
      context.beginPath();
      context.arc(radius, radius, radius, 0, Math.PI * 2);
      context.clip();
      context.fillStyle = "rgba(14, 12, 20, 0.82)";
      context.fillRect(0, 0, size, size);

      /*
       * Every size below is derived from the map's own width. The map is 7.6rem
       * on a desktop and 6.4rem on a phone, and a marker measured in pixels for
       * one of those is either lost or enormous on the other.
       */
      const unit = size / 122;

      /* The streets, at their real width: the grid is what you navigate by. */
      context.strokeStyle = "rgba(255, 255, 255, 0.2)";
      context.lineWidth = Math.max(2 * unit, 11 * scale);
      layout.roads.forEach((road) => {
        const horizontal = road.width > road.depth;
        const line = toCanvas(road.x, road.z);

        if (horizontal ? line.y < -20 || line.y > size + 20 : line.x < -20 || line.x > size + 20) {
          return;
        }

        context.beginPath();

        if (horizontal) {
          context.moveTo(0, line.y);
          context.lineTo(size, line.y);
        } else {
          context.moveTo(line.x, 0);
          context.lineTo(line.x, size);
        }

        context.stroke();
      });

      const icon = Math.round(Math.min(20, Math.max(13, size * 0.15)));
      const mascot = mascotRef.current;

      if (
        mascotTileRef.current?.width !== Math.round(icon * dpr) &&
        mascot?.complete &&
        mascot.naturalWidth > 0
      ) {
        const tile = document.createElement("canvas");

        tile.width = Math.round(icon * dpr);
        tile.height = Math.round(icon * dpr);
        tile.getContext("2d")?.drawImage(mascot, 0, 0, tile.width, tile.height);
        mascotTileRef.current = tile;
      }

      const mascotTile = mascotTileRef.current;
      /* Nearest first, so what is drawn when the map runs out of room is what
         the walker is closest to. */
      const inRange = layout.stations
        .map((entry) => ({
          entry,
          distance: Math.hypot(entry.x - snapshot.x, entry.z - snapshot.z),
        }))
        .filter((candidate) => candidate.distance <= MAP_RANGE)
        .sort((left, right) => left.distance - right.distance);

      /* The ticks go down first, behind everything: they are history, not the route. */
      inRange
        .filter(({ entry }) => collectedIds.has(entry.id))
        .forEach(({ entry }) => {
          const point = toCanvas(entry.x, entry.z);

          context.strokeStyle = `hsl(${STATION_HUE[entry.kind]} 55% 72% / 0.7)`;
          context.lineWidth = 2 * unit;
          context.beginPath();
          context.moveTo(point.x - 3.4 * unit, point.y);
          context.lineTo(point.x - 0.6 * unit, point.y + 3 * unit);
          context.lineTo(point.x + 3.6 * unit, point.y - 3.2 * unit);
          context.stroke();
        });

      /*
       * And the faces on top — but only as many as the map can hold apart. A
       * neighbourhood's worth of Memos at this size is a pile, and a pile says
       * less than the four nearest do.
       */
      const drawn: { x: number; y: number }[] = [];
      let nearest: { x: number; y: number } | null = null;

      inRange
        .filter(({ entry }) => !collectedIds.has(entry.id))
        .forEach(({ entry }) => {
          const point = toCanvas(entry.x, entry.z);

          if (!nearest) {
            nearest = point;
          }

          if (drawn.length >= MAX_MAP_MARKERS) return;

          const crowded = drawn.some(
            (other) => Math.hypot(other.x - point.x, other.y - point.y) < icon * 0.85,
          );

          if (crowded) return;

          drawn.push(point);

          /* A disc behind the face in the colour of what is waiting there — the
             note's own three — so a map full of Memos still says which is which. */
          context.fillStyle = `hsl(${STATION_HUE[entry.kind]} 80% 62%)`;
          context.beginPath();
          context.arc(point.x, point.y, icon / 2, 0, Math.PI * 2);
          context.fill();

          if (mascotTile) {
            context.drawImage(mascotTile, point.x - icon / 2, point.y - icon / 2, icon, icon);
          }
        });

      if (nearest) {
        const target = nearest as { x: number; y: number };

        context.strokeStyle = "rgba(255, 255, 255, 0.85)";
        context.lineWidth = 1.8 * unit;
        context.beginPath();
        context.arc(target.x, target.y, icon / 2 + 4 * unit, 0, Math.PI * 2);
        context.stroke();
      }

      /* The player sits at the middle of their own map, facing up the screen. */
      context.save();
      context.translate(radius, radius);
      context.rotate(mapArrowAngle(snapshot.facing));
      context.fillStyle = "#ffffff";
      context.strokeStyle = "rgba(14, 12, 20, 0.9)";
      context.lineWidth = 1.6 * unit;
      context.beginPath();
      context.moveTo(0, -8 * unit);
      context.lineTo(6 * unit, 6.4 * unit);
      context.lineTo(0, 3 * unit);
      context.lineTo(-6 * unit, 6.4 * unit);
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();
      context.restore();
    },
    [layout, sizeMinimap],
  );

  /* The frame callback must not re-render: it fires sixty times a second. */
  const collectedRef = useRef(collected);

  useEffect(() => {
    collectedRef.current = collected;
  }, [collected]);

  const openStation = useCallback((stationId: string | null) => {
    clearDismiss();
    setNearStationId(stationId);
    setIsFlipped(false);
    setQuizChoice(null);
    setQuizOrder([]);
    setTestAnswer("");
    setIsTestUnknown(false);
    setIsMarking(false);
    setMark(null);
  }, [clearDismiss]);

  useEffect(() => {
    if (!station || stationItem) return;

    gameRef.current?.releaseStation();
    openStation(null);
  }, [openStation, station, stationItem]);

  const startGame = useCallback(async () => {
    if (!layout || gameRef.current) return;

    setLoadError(null);

    try {
      const { createPalaceGame } = await import("@/lib/palace/game");
      const canvas = canvasRef.current;

      if (!canvas) return;

      sizeMinimap();

      gameRef.current = createPalaceGame({
        canvas,
        layout,
        collectedIds: [...collectedRef.current],
        onNearStation: openStation,
        onContextLost: () => {
          gameRef.current = null;
          setCanvasEpoch((current) => current + 1);
        },
        onFrame: (snapshot) => {
          snapshotRef.current = snapshot;
          /*
           * Every frame. The map is centred on the player, so everything on it
           * slides whenever they move, and anything less than the frame rate
           * reads as the map stuttering rather than as a saving.
           */
          drawMinimap(snapshot, collectedRef.current);

          setDistrictIndex((current) =>
            current === snapshot.districtIndex ? current : snapshot.districtIndex,
          );
        },
      });
      setIsBuilt(true);
    } catch (error) {
      /* A device without WebGL, or a chunk that never arrived. */
      setLoadError(error instanceof Error ? error.message : t("palace.unsupported"));
    }
  }, [drawMinimap, layout, openStation, sizeMinimap, t]);

  useEffect(() => {
    if (!isOpen) return;

    /* A restarted engine puts you back at the spawn, with nothing under your nose. */
    openStation(null);
    void startGame();

    return () => {
      gameRef.current?.dispose();
      gameRef.current = null;
    };
  }, [canvasEpoch, isOpen, openStation, startGame]);

  useEffect(
    () => () => {
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
    },
    [],
  );

  /*
   * One way out, however it is asked for: the button, Escape, or the phone's
   * own back gesture. It closes the town and puts the reader back on the note
   * rather than on the tab they left from — the button says "back to the note",
   * and it should be telling the truth.
   */
  /*
   * Held in a ref so the history effect below can depend on nothing but whether
   * the town is open: a caller that rebuilds this callback every render would
   * otherwise make that effect tear down and re-arm, and its teardown walks the
   * history back.
   */
  const onLeaveRef = useRef(onLeave);

  useEffect(() => {
    onLeaveRef.current = onLeave;
  }, [onLeave]);

  const leaveGame = useCallback(() => {
    setIsOpen(false);
    onLeaveRef.current?.();
  }, []);

  /*
   * Opening clears the built flag in the same update that opens the overlay,
   * not in the effect that follows it: an effect runs after the frame is drawn,
   * so on a second visit the reader saw one frame of the last town's stage
   * before the wait appeared.
   */
  const enterGame = useCallback(() => {
    setIsBuilt(false);
    setLoadError(null);
    setIsOpen(true);
  }, []);

  /*
   * Opening the town adds a history entry, so the browser's back button and the
   * phone's back gesture close it instead of leaving the note altogether. A
   * full-screen overlay that swallows Back is the fastest way to trap someone.
   */
  useEffect(() => {
    if (!isOpen) return;

    window.history.pushState({ memoPalace: true }, "");

    const onPopState = () => {
      /* The entry is already gone, so this must not walk history again. */
      setIsOpen(false);
      onLeaveRef.current?.();
    };

    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);

      /* Closed some other way: take our entry back off the stack. */
      if (window.history.state?.memoPalace) {
        window.history.back();
      }
    };
  }, [isOpen]);

  /* The page behind must not scroll under the town while it is open. */
  useEffect(() => {
    if (!isOpen) return;

    const previous = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onResize = () => {
      gameRef.current?.resize();
      sizeMinimap();
    };
    /* A backgrounded tab should not keep a render loop alive on a phone battery. */
    const onVisibility = () => gameRef.current?.setPaused(document.hidden);
    /*
     * Escape takes one layer at a time, the way it does everywhere else in the
     * app: the map if it is up, then the station, and only an Escape with
     * neither of them open leaves the town. It used to close the whole thing
     * from under an open card.
     */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (escapeRef.current()) return;

      leaveGame();
    };

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, leaveGame, sizeMinimap]);

  /*
   * The whole town, painted once when the sheet opens: every street, every stop
   * still waiting, and where the walker is standing. Nothing here moves, so it
   * is drawn on demand rather than every frame.
   */
  useEffect(() => {
    if (!isMapOpen || !layout) return;

    const canvas = townMapRef.current;

    if (!canvas) return;

    const width = Math.round(canvas.getBoundingClientRect().width);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (width === 0) return;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(width * dpr);

    const context = canvas.getContext("2d");

    if (!context) return;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const extent = mapExtent(layout);
    const scale = width / (extent * 2);
    const toCanvas = (x: number, z: number) => ({
      x: width / 2 + x * scale,
      y: width / 2 + z * scale,
    });

    context.clearRect(0, 0, width, width);
    context.fillStyle = "rgba(14, 12, 20, 0.9)";
    context.beginPath();
    context.roundRect(0, 0, width, width, 18);
    context.fill();

    context.strokeStyle = "rgba(255, 255, 255, 0.16)";
    context.lineWidth = Math.max(1.5, 11 * scale);
    layout.roads.forEach((road) => {
      const horizontal = road.width > road.depth;
      const line = toCanvas(road.x, road.z);

      context.beginPath();

      if (horizontal) {
        context.moveTo(0, line.y);
        context.lineTo(width, line.y);
      } else {
        context.moveTo(line.x, 0);
        context.lineTo(line.x, width);
      }

      context.stroke();
    });

    layout.stations.forEach((entry) => {
      const point = toCanvas(entry.x, entry.z);
      const done = collected.has(entry.id);

      context.fillStyle = done
        ? "rgba(255, 255, 255, 0.22)"
        : `hsl(${STATION_HUE[entry.kind]} 80% 62%)`;
      context.beginPath();
      context.arc(point.x, point.y, done ? 2.6 : 4.2, 0, Math.PI * 2);
      context.fill();
    });

    const player = toCanvas(snapshotRef.current?.x ?? 0, snapshotRef.current?.z ?? 0);

    context.save();
    context.translate(player.x, player.y);
    context.rotate(mapArrowAngle(snapshotRef.current?.facing ?? 0));
    context.fillStyle = "#ffffff";
    context.strokeStyle = "rgba(14, 12, 20, 0.9)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(0, -7);
    context.lineTo(5.4, 5.8);
    context.lineTo(0, 2.6);
    context.lineTo(-5.4, 5.8);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }, [collected, isMapOpen, layout]);

  const closeMap = useCallback(() => setIsMapOpen(false), []);
  const mapSheet = useSheet(closeMap, { scrollable: true });

  /*
   * Held in a ref so the key handler below can be armed once for the whole
   * visit rather than re-armed on every frame the town reports.
   */
  const escapeRef = useRef<() => boolean>(() => false);

  escapeRef.current = () => {
    if (isMapOpen) {
      mapSheet.dismiss();

      return true;
    }

    if (nearStationId) {
      leaveStation();

      return true;
    }

    return false;
  };

  /* The map sheet stops the world; the loop keeps rendering. */
  useEffect(() => {
    gameRef.current?.setPaused(isMapOpen);

    if (isMapOpen) {
      gameRef.current?.setMove(0, 0);
    }
  }, [isMapOpen]);

  /* What actually tears the station down, once the sheet has finished leaving. */
  const closeStation = useCallback(() => {
    clearDismiss();
    gameRef.current?.releaseStation();
    openStation(null);
  }, [clearDismiss, openStation]);

  /*
   * The station panel is a bottom sheet on the phone, so it is one of the app's
   * bottom sheets: it comes up from the edge, tracks a thumb dragged down it,
   * and drops out of frame on the way out rather than vanishing. It owns a
   * scrolling answer, so only the grabber and the head start a drag.
   */
  const stationSheet = useSheet(closeStation, { scrollable: true });
  const dismissStation = stationSheet.dismiss;

  const leaveStation = useCallback(() => {
    clearDismiss();
    dismissStation();
  }, [clearDismiss, dismissStation]);

  /** Been to. The Memo goes out and the ring dims, whatever the answer was. */
  const collect = useCallback(
    (stationId: string) => {
      setCollected((current) => {
        const next = new Set(current);

        next.add(stationId);
        writeCollected(lectureId, next);

        return next;
      });
      gameRef.current?.markCollected(stationId);
    },
    [lectureId],
  );

  /**
   * A flashcard graded in the town is a flashcard graded in the app: the same
   * record the deck screen writes. Fire and forget on purpose — a dropped
   * request must not stop the walk, and the next grade carries the card again.
   */
  const gradeCard = useCallback(
    async (
      cardId: string,
      confidenceBucket: FlashcardBucket,
      exitStart?: { xPercent: number; yPercent: number; rotationDeg: number },
    ) => {
      setResults((current) => ({ ...current, [cardId]: confidenceBucket }));
      collect(cardId);

      /*
       * The card flies off the way it does on the deck screen — same animation,
       * same length — and the walk resumes as it goes rather than after it.
       */
      exitTokenRef.current += 1;

      const token = exitTokenRef.current;

      setCardExit({
        bucket: confidenceBucket,
        flipped: isFlipped,
        token,
        startXPercent: exitStart?.xPercent ?? 0,
        startYPercent: exitStart?.yPercent ?? 0,
        startRotationDeg: exitStart?.rotationDeg ?? 0,
      });

      if (exitTimerRef.current) {
        window.clearTimeout(exitTimerRef.current);
      }

      exitTimerRef.current = window.setTimeout(() => {
        setCardExit((current) => (current?.token === token ? null : current));
        exitTimerRef.current = null;
      }, FLASHCARD_EXIT_ANIMATION_MS);

      leaveStation();

      /*
       * The same record the deck screen writes, with the same buckets. Fire and
       * forget on purpose: a dropped request must not stop the walk, and the
       * next grade carries the card again.
       */
      try {
        await fetch(`/api/flashcards/${cardId}/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confidenceBucket }),
        });
      } catch {
        /* Offline in a lecture hall is the normal case, not an error to raise. */
      }
    },
    [collect, isFlipped, leaveStation],
  );

  const answerQuiz = useCallback(
    (questionId: string, optionIndex: number, correctIndex: number) => {
      const right = optionIndex === correctIndex;

      setQuizChoice(optionIndex);
      setResults((current) => ({ ...current, [questionId]: right ? "easy" : "again" }));
      collect(questionId);

      /*
       * Both answers stop and say what happened: right or wrong, which option
       * was the right one, and the note's own explanation of why — and then the
       * walk resumes on its own. Answering used to leave you holding a card you
       * had already finished with until you pressed a second button, which on a
       * sixty-stop walk is sixty presses that say nothing.
       *
       * How long it stays depends on whether there is anything to read: a right
       * answer with no explanation behind it is a tick, and a tick does not need
       * six seconds. The button stays for anyone who would rather not wait.
       */
      const explained = Boolean(quizById.get(questionId)?.explanation);

      clearDismiss();
      dismissRef.current = window.setTimeout(
        leaveStation,
        right && !explained ? QUIZ_RESULT_PAUSE : QUIZ_RESULT_READ_PAUSE,
      );
    },
    [clearDismiss, collect, leaveStation, quizById],
  );

  /**
   * Marked by the same grader the practice test uses, against the same marking
   * points, for the same five points — one answer at a time and without opening
   * an attempt, so a walk never shows up in the test's own history.
   */
  const checkAnswer = useCallback(
    async (questionId: string) => {
      setIsMarking(true);

      try {
        const response = await fetch(`/api/lectures/${lectureId}/practice-test/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId,
            typedAnswer: isTestUnknown ? "" : testAnswer,
            declaredUnknown: isTestUnknown,
          }),
        });

        if (!response.ok) throw new Error("unmarked");

        setMark((await response.json()) as PracticeMark);
      } catch {
        /*
         * Offline, rate-limited, or the grader would not answer: the learner
         * still gets the answer to mark themselves against, which is what the
         * screen did before there was a grader at all.
         */
        setMark({
          marked: false,
          maxScore: 5,
          expectedAnswer: testById.get(questionId)?.answer_guide ?? "",
        });
      } finally {
        setIsMarking(false);
      }
    },
    [isTestUnknown, lectureId, testAnswer, testById],
  );

  const restart = useCallback(() => {
    setResults({});
    setCollected(new Set());
    writeCollected(lectureId, new Set());
    setIsOpen(false);
  }, [lectureId]);

  const onStickPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (stickRef.current) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    stickRef.current = { pointerId: event.pointerId, originX: event.clientX, originY: event.clientY };
    setStickKnob({ x: event.clientX, y: event.clientY });
  };

  const onStickPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const stick = stickRef.current;

    if (!stick || stick.pointerId !== event.pointerId) return;

    const dx = event.clientX - stick.originX;
    const dy = event.clientY - stick.originY;
    const distance = Math.hypot(dx, dy);

    if (distance < STICK_DEADZONE) {
      gameRef.current?.setMove(0, 0);

      return;
    }

    const clamped = Math.min(1, distance / STICK_RADIUS);
    const nx = (dx / distance) * clamped;
    const ny = (dy / distance) * clamped;

    /* Up on the stick is forward, so the vertical axis is inverted. */
    gameRef.current?.setMove(-ny, nx);
    setStickKnob({ x: stick.originX + nx * STICK_RADIUS, y: stick.originY + ny * STICK_RADIUS });
  };

  const endStick = (event: React.PointerEvent<HTMLDivElement>) => {
    if (stickRef.current?.pointerId !== event.pointerId) return;

    stickRef.current = null;
    gameRef.current?.setMove(0, 0);
    setStickKnob(null);
  };

  const onLookPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (lookRef.current) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    lookRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const onLookPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const look = lookRef.current;

    if (!look || look.pointerId !== event.pointerId) return;

    gameRef.current?.look(event.clientX - look.x, event.clientY - look.y);
    look.x = event.clientX;
    look.y = event.clientY;
  };

  const endLook = (event: React.PointerEvent<HTMLDivElement>) => {
    if (lookRef.current?.pointerId !== event.pointerId) return;

    lookRef.current = null;
  };

  if (!isReady || !layout) {
    return (
      <div className="memo-study-empty">
        <div className="memo-study-empty-orb">
          <Emoji symbol="🏙️" size="4.4rem" />
        </div>
        <p className="memo-study-empty-title">{t("palace.title")}</p>
        <p className="memo-study-empty-copy">
          {isReady ? t("palace.empty") : t("palace.notReady")}
        </p>
      </div>
    );
  }

  const total = layout.stations.length;
  /*
   * Answered, not answered correctly. A stop you got wrong is a stop you have
   * been to: leaving its Memo floating over the pavement told you nothing you
   * could act on — the answer was already on the screen — and it meant the
   * counter never moved and the walk could not end unless you were right sixty
   * times running.
   */
  const done = layout.stations.filter((entry) => collected.has(entry.id)).length;
  /* What was recalled first time, which is the number the score is made of: a
     stop you got wrong is walked, but it is not a stop you knew. */
  const firstTimeKnown = layout.stations.filter(
    (entry) => collected.has(entry.id) && results[entry.id] !== "again",
  ).length;
  const district = layout.districts[districtIndex] ?? layout.districts[0];
  /*
   * The chip on the panel is the note's own tab pill — same shape, same icon,
   * same tint — because it is answering the same question: which of the three
   * you are looking at.
   */
  const kindPill: Record<StudyKind, { label: string; icon: string; tint: string }> = {
    card: {
      label: t("note.tab.flashcards"),
      icon: "style",
      tint: "oklch(0.66 0.15 295)",
    },
    quiz: { label: t("note.tab.quiz"), icon: "quiz", tint: "oklch(0.66 0.15 340)" },
    test: {
      label: t("note.subScreen.test"),
      icon: "assignment",
      tint: "oklch(0.66 0.15 150)",
    },
  };
  /*
   * "Click to flip" on a mouse, "Tap to flip" on a phone — both rendered, the
   * stylesheet picks, exactly as the deck screen does it.
   */
  const flipHint = (
    <>
      <span className="memo-only-desktop">{t("study.cards.flipDesktop")}</span>
      <span className="memo-only-mobile">{t("study.cards.flipMobile")}</span>
    </>
  );

  function renderStation() {
    if (!station) return null;

    if (station.kind === "card") {
      const card = cardsById.get(station.id);

      if (!card) return null;

      const missed = Object.values(results).filter((value) => value === "again").length;
      const known = Object.values(results).filter((value) => value === "easy").length;

      return (
        <StudyFlashcard
          key={card.id}
          front={card.front}
          back={card.back}
          flipped={isFlipped}
          onFlip={() => setIsFlipped((current) => !current)}
          onGrade={(bucket, exitStart) => void gradeCard(card.id, bucket, exitStart)}
          flipHint={flipHint}
          answerLabel={
            results[card.id]
              ? t(results[card.id] === "again" ? "study.cards.didntKnow" : "study.cards.knew")
              : null
          }
          answerClass={results[card.id] === "again" ? "again" : "easy"}
          answer={results[card.id] ?? null}
          missedCount={missed}
          knownCount={known}
          exit={cardExit}
        />
      );
    }

    if (station.kind === "quiz") {
      const question = quizById.get(station.id);

      if (!question) return null;

      const wrong = quizChoice !== null && quizChoice !== question.correct_option_idx;
      const order =
        quizOrder.length === question.options.length
          ? quizOrder
          : question.options.map((_, index) => index);

      return (
        <div className="lecture-quiz-card">
          <span className="memo-quiz-eyebrow">{t("quiz.chooseOne")}</span>
          <p className="lecture-quiz-prompt">{question.prompt}</p>

          <div className="lecture-quiz-options">
            {order.map((optionIndex, displayIndex) => {
              const option = question.options[optionIndex] ?? "";
              const isSelected = quizChoice === optionIndex;
              const isCorrect = quizChoice !== null && optionIndex === question.correct_option_idx;
              const isIncorrect = quizChoice !== null && isSelected && !isCorrect;

              return (
                <button
                  key={`${question.id}-${optionIndex}`}
                  type="button"
                  disabled={quizChoice !== null}
                  onClick={() => answerQuiz(question.id, optionIndex, question.correct_option_idx)}
                  className={`lecture-quiz-option ${isSelected ? "selected" : ""} ${
                    isCorrect ? "correct" : ""
                  } ${isIncorrect ? "incorrect" : ""}`}
                >
                  <span className="lecture-quiz-option-label">
                    {String.fromCharCode(65 + displayIndex)}
                  </span>
                  <span className="lecture-quiz-option-copy">{option}</span>
                  {isCorrect || isIncorrect ? (
                    <span className="lecture-quiz-option-mark">
                      <Msym name={isCorrect ? "check" : "close"} size="1.2rem" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {quizChoice !== null ? (
            <div className={`memo-quiz-result ${wrong ? "" : "correct"}`}>
              <span className="memo-quiz-result-badge">
                <Msym name={wrong ? "cancel" : "check_circle"} size="1.25rem" />
              </span>
              <span className="memo-quiz-result-copy">
                <span className="memo-quiz-result-title">
                  {wrong ? t("quiz.wrongTitle") : t("palace.correctTitle")}
                </span>
                {wrong ? (
                  <span>
                    {t("quiz.correctAnswerIs", {
                      letter: quizOptionLetter(order, question.correct_option_idx),
                    })}
                  </span>
                ) : null}
                {question.explanation ? (
                  <span className="memo-palace-why">
                    <span className="memo-palace-model-label">{t("palace.explanation")}</span>
                    {question.explanation}
                  </span>
                ) : null}
              </span>
              <div className="memo-quiz-result-actions">
                <button type="button" className="memo-quiz-result-primary" onClick={leaveStation}>
                  {t("quiz.understood")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    const question = testById.get(station.id);

    if (!question) return null;

    const passed = mark?.marked === true && (mark.score ?? 0) >= PRACTICE_PASS_SCORE;

    return (
      <div className="lecture-practice-stage">
        <p className="lecture-practice-prompt">{question.prompt}</p>

        <textarea
          value={testAnswer}
          onChange={(event) => setTestAnswer(event.target.value)}
          disabled={isTestUnknown || isMarking || mark !== null}
          className="ios-textarea lecture-practice-textarea"
          placeholder={t("test.answerPlaceholder")}
        />

        {mark ? null : (
          <div className="lecture-practice-controls">
            <label className="lecture-practice-unknown">
              <input
                type="checkbox"
                checked={isTestUnknown}
                disabled={isMarking}
                onChange={(event) => setIsTestUnknown(event.target.checked)}
              />
              {t("test.dontKnow")}
            </label>
          </div>
        )}

        {mark ? (
          <div className={`memo-palace-mark ${passed ? "pass" : "fail"}`}>
            {mark.marked ? (
              <p className="memo-palace-mark-score">
                <Msym name={passed ? "check_circle" : "cancel"} size="1.3rem" />
                {t("palace.scoreOf", { score: mark.score ?? 0, total: mark.maxScore })}
              </p>
            ) : (
              <p className="memo-palace-mark-score unmarked">{t("test.notMarked")}</p>
            )}

            {mark.strengths ? (
              <p className="memo-palace-mark-line">
                <span className="memo-palace-model-label">{t("test.strengths")}</span>
                {mark.strengths}
              </p>
            ) : null}

            {mark.missingPoints ? (
              <p className="memo-palace-mark-line">
                <span className="memo-palace-model-label">{t("test.missing")}</span>
                {mark.missingPoints}
              </p>
            ) : null}

            <p className="memo-palace-mark-line">
              <span className="memo-palace-model-label">{t("test.expectedAnswer")}</span>
              {mark.expectedAnswer}
            </p>
          </div>
        ) : null}

        <div className="memo-test-actions">
          {mark ? (
            <button
              type="button"
              className="memo-test-next"
              onClick={() => {
                setResults((current) => ({
                  ...current,
                  [question.id]: passed ? "easy" : "again",
                }));
                collect(question.id);

                leaveStation();
              }}
            >
              {t("quiz.understood")}
            </button>
          ) : (
            <button
              type="button"
              className="memo-test-next"
              disabled={isMarking || (!isTestUnknown && testAnswer.trim().length === 0)}
              onClick={() => void checkAnswer(question.id)}
            >
              {isMarking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isMarking ? t("palace.checking") : t("palace.checkAnswer")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="memo-study-empty memo-palace-intro">
        <div className="memo-study-empty-orb">
          {/*
           * Memo's own face, the thing you will be collecting. Eager and at the
           * front of the queue: it is the first thing on the screen, and left to
           * lazy-load it arrived a beat after the title and the button, so the
           * palace opened on an empty grey circle.
           */}
          <NextImage src={MASCOT_SRC} alt="" width={110} height={99} priority />
        </div>
        <p className="memo-study-empty-title">{t("palace.title")}</p>
        <p className="memo-study-empty-copy">{t("palace.intro")}</p>

        <button type="button" className="memo-study-empty-cta" onClick={enterGame}>
          <Msym name="explore" size="1.2rem" fill={false} weight={500} />
          {done > 0 ? t("palace.resume") : t("palace.start")}
        </button>

        {/* Everything below is the walk's own state, in the app's list idiom. */}
        <div className="memo-palace-summary">
          <div className="memo-palace-progress">
            <div className="memo-palace-bar">
              <span style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }} />
            </div>
            <p className="memo-palace-count">{t("palace.progressCount", { done, total })}</p>
          </div>

          {done > 0 ? (
            <button type="button" className="memo-button-outline small" onClick={restart}>
              <Msym name="replay" size="1.1rem" fill={false} weight={500} />
              {t("palace.restart")}
            </button>
          ) : null}
        </div>
      </div>

      {isOpen ? (
        <MemoPortal>
          <div
            className="memo-palace-stage"
            role="dialog"
            aria-modal="true"
            aria-label={t("palace.title")}
          >
            <canvas key={canvasEpoch} ref={canvasRef} className="memo-palace-canvas" />

            <div
              className="memo-palace-look"
              onPointerDown={onLookPointerDown}
              onPointerMove={onLookPointerMove}
              onPointerUp={endLook}
              onPointerCancel={endLook}
            />

            {isTouch ? (
              <div
                className="memo-palace-stick"
                onPointerDown={onStickPointerDown}
                onPointerMove={onStickPointerMove}
                onPointerUp={endStick}
                onPointerCancel={endStick}
              >
                {/* A base at rest, so the stick is somewhere you can see rather
                    than somewhere you have to know about. */}
                <span className="memo-palace-stick-base" aria-hidden="true" />
                {stickKnob ? (
                  <span
                    className="memo-palace-knob"
                    style={{ left: `${stickKnob.x}px`, top: `${stickKnob.y}px` }}
                  />
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              className="memo-palace-map"
              onClick={() => setIsMapOpen(true)}
              aria-label={t("palace.map")}
            >
              <canvas ref={attachMinimap} />
            </button>

            <div className="memo-palace-hud-top">
              <span className="memo-palace-score">
                <span className="memo-palace-score-token" aria-hidden="true" />
                {done} <span className="memo-palace-score-slash">/</span> {total}
              </span>
              <span className="memo-palace-district-pill">{district?.title}</span>
            </div>

            <button
              type="button"
              className="memo-palace-exit"
              onClick={leaveGame}
              aria-label={t("palace.exit")}
            >
              <Msym name="arrow_back" size="1.1rem" />
              <span className="memo-palace-exit-label">{t("palace.exit")}</span>
            </button>

            {isTouch ? null : <p className="memo-palace-hint">{t("palace.hintDesktop")}</p>}

            {!isBuilt && !loadError ? (
              /* The app's own wait, in the shape of the thing being built. */
              <div className="memo-palace-loading">
                <StudyGenerationNotice
                  preview="palace"
                  stageCopy={t("palace.loading")}
                  bodyCopy=""
                />
              </div>
            ) : null}

            {loadError ? (
              <div className="memo-palace-loading">
                <p>{t("palace.unsupported")}</p>
                <button
                  type="button"
                  className="memo-button-outline small"
                  onClick={leaveGame}
                >
                  {t("palace.exit")}
                </button>
              </div>
            ) : null}

            {station ? (
              <div
                className={sheetClass("memo-palace-panel-scrim", stationSheet.closing)}
                role="presentation"
                onClick={() => stationSheet.dismiss()}
              >
              <div
                className={sheetClass(
                  `memo-palace-panel mobile-draggable-sheet ${station.kind}`,
                  stationSheet.closing,
                )}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={kindPill[station.kind].label}
                {...stationSheet.dragProps}
              >
                <button
                  type="button"
                  className="mobile-sheet-drag-handle"
                  aria-label={t("folders.dragToClose")}
                  data-drag-handle
                />
                <div className="memo-palace-panel-head" data-drag-zone>
                  <span
                    className="memo-tab active memo-palace-panel-kind"
                    style={{ "--tab-tint": kindPill[station.kind].tint } as CSSProperties}
                  >
                    <Msym name={kindPill[station.kind].icon} size="1.2rem" fill={false} weight={500} />
                    <span>{kindPill[station.kind].label}</span>
                  </span>
                  <span className="memo-palace-panel-where">{district?.title}</span>
                  <button
                    type="button"
                    className="memo-close-button"
                    aria-label={t("common.close")}
                    onClick={leaveStation}
                  >
                    <Msym name="close" size="1.1rem" />
                  </button>
                </div>
                {renderStation()}
              </div>
              </div>
            ) : null}

            {isMapOpen ? (
              <div
                className={sheetClass("memo-palace-sheet", mapSheet.closing)}
                role="presentation"
                onClick={() => mapSheet.dismiss()}
              >
                <div
                  className={sheetClass(
                    "memo-palace-sheet-inner mobile-draggable-sheet",
                    mapSheet.closing,
                  )}
                  role="dialog"
                  aria-modal="true"
                  aria-label={t("palace.map")}
                  onClick={(event) => event.stopPropagation()}
                  {...mapSheet.dragProps}
                >
                  <button
                    type="button"
                    className="mobile-sheet-drag-handle"
                    aria-label={t("folders.dragToClose")}
                    data-drag-handle
                  />
                  <div className="memo-palace-sheet-head" data-drag-zone>
                    <h3>{t("palace.map")}</h3>
                    <button
                      type="button"
                      className="memo-close-button"
                      aria-label={t("common.close")}
                      onClick={() => mapSheet.dismiss()}
                    >
                      <Msym name="close" size="1.1rem" />
                    </button>
                  </div>
                  {/* Everything under the head scrolls, so the title and its
                      close stay where the thumb left them. */}
                  <div className="memo-palace-sheet-body">
                    {/* The whole town, so the corner map's two blocks are a view
                        of something rather than all there is. */}
                    <canvas ref={townMapRef} className="memo-palace-townmap" />
                    <h3>{t("palace.districts")}</h3>
                    <ul>
                    {layout.districts.map((entry) => {
                      const entryDone = entry.stationIds.filter((id) => collected.has(id)).length;

                      return (
                        <li key={entry.index}>
                          <span
                            className="memo-palace-dot"
                            style={{ background: `hsl(${entry.hue} 70% 58%)` }}
                          />
                          <span className="memo-palace-district-title">{entry.title}</span>
                          <span className="memo-palace-district-count">
                            {entryDone}/{entry.stationIds.length}
                          </span>
                          <button
                            type="button"
                            className="memo-button-outline small"
                            onClick={() => {
                              const index = entry.index;

                              mapSheet.dismiss(() => gameRef.current?.travelTo(index));
                            }}
                          >
                            {t("palace.travel")}
                          </button>
                        </li>
                      );
                      })}
                    </ul>
                  </div>
                </div>
              </div>
            ) : null}

            {done === total ? (
              /*
               * The same results screen a finished deck, quiz or test gets —
               * the walk is one of them, so it ends the way they do rather than
               * with a panel of its own. The score is what was recalled first
               * time: a card you had to come back to is not a card you knew.
               */
              <div className="memo-palace-finish">
                <StudyCompletionCard
                  eyebrow={t("study.completed")}
                  title={t("palace.done.title")}
                  subtitle={t("palace.done.copy")}
                  percentage={total === 0 ? 0 : (firstTimeKnown / total) * 100}
                  percentageLabel={t("study.score")}
                  primaryMetric={{
                    label: t("study.correctAnswers"),
                    value: `${firstTimeKnown}/${total}`,
                  }}
                  actions={
                    <>
                      <button
                        type="button"
                        onClick={restart}
                        className="lecture-study-refresh lecture-study-restart"
                        aria-label={t("palace.restart")}
                      >
                        <Msym name="replay" size="1.2rem" fill={false} weight={500} />
                        {t("palace.restart")}
                      </button>
                      {/* The design gives a results screen's second action its
                          own surface-and-border treatment; this only has to
                          bring the text colour and the pill shape. */}
                      <button
                        type="button"
                        className="memo-button-outline small"
                        onClick={leaveGame}
                      >
                        {t("palace.exit")}
                      </button>
                    </>
                  }
                />
              </div>
            ) : null}

          </div>
        </MemoPortal>
      ) : null}
    </>
  );
}
