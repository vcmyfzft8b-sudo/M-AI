"use client";

import NextImage from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useT } from "@/components/i18n-provider";
import { LandingAppScope, type LandingAppTheme } from "@/components/landing/app/landing-app-scope";
import {
  defaultLandingFlashcards,
  defaultLandingQuiz,
  useLandingAutoplay,
  useLandingAutoplayStep,
  type LandingAutoplayStep,
  type LandingFlashcard,
  type LandingQuizQuestion,
} from "@/components/landing/app/landing-study-content";
import { Msym } from "@/components/msym";
import { PalaceLoading } from "@/components/palace-loading";
import { StudyCompletionCard } from "@/components/study-completion-card";
import { StudyFlashcard, type StudyFlashcardExit } from "@/components/study-flashcard";
import { StudyQuizQuestion } from "@/components/study-question";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { buildingProfile } from "@/lib/palace/architecture";
import type { PalaceGame, PalaceSnapshot } from "@/lib/palace/game";
import {
  buildPalaceLayout,
  mapArrowAngle,
  selectPalaceItems,
  STATION_HUE,
  type PalaceLayout,
  type PalaceStation,
  type StudyKind,
} from "@/lib/palace/layout";
import { paintTownDiorama } from "@/lib/palace/diorama";
import { minimapMarker } from "@/lib/palace/navigation";
import { chooseRelocation, relocatedStation, relocationSpots } from "@/lib/palace/relocation";
import { outdoorLandmark, roomIdentity } from "@/lib/palace/rooms";
import { FLASHCARD_EXIT_ANIMATION_MS, type FlashcardBucket } from "@/lib/study/flashcard-drag";
import { quizOptionLetter, shuffleIndices } from "@/lib/study/quiz";

/*
 * The memory palace, as the app draws it (`lecture-palace.tsx`).
 *
 * The intro is the tab's JSX, transcribed: the town drawn from the note's own layout with Memo
 * on its edge, the title and the sentence under it, "0 of N collected", and "Start game". The
 * town is the app's — `buildPalaceLayout` over the landing's sample flashcards and quiz (the same
 * ones its Flashcards and Quiz demos use), painted by the app's own `paintTownDiorama`.
 *
 * "Start game" starts the real thing: the app's own 3D engine (`createPalaceGame`, loaded only
 * then, never before), the app's HUD — minimap, score, the way out — and, at a stop, the app's
 * own study screens, `StudyFlashcard` and `StudyQuizQuestion`. A miss moves the stop somewhere
 * else, as the intro promises. What is not here: the full-screen overlay (a portal), the history
 * entry, the city-map sheet and the practice questions, which need the server to mark them.
 *
 * The walkthrough stays on the intro: Memo walks the map from stop to stop and the count goes
 * up, which is the whole game in one picture. It never loads the engine.
 */

const MASCOT_SRC = "/memo-mascot.png";
const MAP_RANGE = 95;
const MAX_MAP_MARKERS = 5;
const QUIZ_RESULT_PAUSE = 1600;
const STICK_DEADZONE = 6;
const STICK_RADIUS = 46;
/** The walkthrough's pace across the intro map. */
const WALK_LEG_MS = 1_500;
const WALK_REST_MS = 700;

type Walker = { x: number; z: number; facing: number };

export function LandingPalaceScreen({
  theme,
  autoplay = false,
  className,
  cards: cardsOverride,
  quiz: quizOverride,
}: {
  theme?: LandingAppTheme;
  autoplay?: boolean;
  className?: string;
  /** The stops' material; the landing's sample set when left out. */
  cards?: LandingFlashcard[];
  quiz?: LandingQuizQuestion[];
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const introMapRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<PalaceGame | null>(null);
  const snapshotRef = useRef<PalaceSnapshot | null>(null);
  const stickRef = useRef<{ pointerId: number; originX: number; originY: number } | null>(null);
  const lookRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const mascotRef = useRef<HTMLImageElement | null>(null);
  const mascotTileRef = useRef<HTMLCanvasElement | null>(null);
  const dismissRef = useRef<number | null>(null);
  const answeredRef = useRef<string | null>(null);
  const exitTokenRef = useRef(0);
  const exitTimerRef = useRef<number | null>(null);

  const cards = useMemo(() => cardsOverride ?? defaultLandingFlashcards(t), [cardsOverride, t]);
  const quiz = useMemo(() => quizOverride ?? defaultLandingQuiz(t), [quizOverride, t]);
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const quizById = useMemo(() => new Map(quiz.map((question) => [question.id, question])), [quiz]);

  const baseLayout = useMemo(() => {
    const items = selectPalaceItems({
      cards: cards.map((card) => ({ id: card.id, sectionId: null })),
      quiz,
      test: [],
    });

    return items.length === 0
      ? null
      : buildPalaceLayout({
          seedSource: "landing-palace",
          items,
          sections: [],
          fallbackTitle: t("palace.district.default"),
        });
  }, [cards, quiz, t]);
  const spots = useMemo(() => (baseLayout ? relocationSpots(baseLayout) : []), [baseLayout]);

  /* Where each stop is now; a missed one is moved, as in the app. */
  const [layout, setLayout] = useState<PalaceLayout | null>(baseLayout);
  const [layoutBase, setLayoutBase] = useState(baseLayout);

  /* A new town (the language changed, and with it the material) starts from its own layout. */
  if (layoutBase !== baseLayout) {
    setLayoutBase(baseLayout);
    setLayout(baseLayout);
  }

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const [collected, setCollected] = useState<Set<string>>(() => new Set());
  const collectedRef = useRef(collected);
  collectedRef.current = collected;
  const [results, setResults] = useState<Record<string, "again" | "easy">>({});
  const [isOpen, setIsOpen] = useState(false);
  const [isBuilt, setIsBuilt] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [station, setStation] = useState<PalaceStation | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [quizChoice, setQuizChoice] = useState<number | null>(null);
  const [quizOrder, setQuizOrder] = useState<number[]>([]);
  const [cardExit, setCardExit] = useState<StudyFlashcardExit | null>(null);
  const [hasMoved, setHasMoved] = useState(false);
  const movementOriginRef = useRef<{ x: number; z: number } | null>(null);
  const movementStartedRef = useRef(false);
  const [stickKnob, setStickKnob] = useState<{ x: number; y: number } | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  /*
   * The walkthrough's own walk, kept apart from the visitor's: what Memo collects on the intro
   * map is shown while the walkthrough runs and never becomes progress the visitor did not make.
   */
  const [walker, setWalker] = useState<Walker | null>(null);
  const [demoCollected, setDemoCollected] = useState<ReadonlySet<string>>(() => new Set());
  const { running } = useLandingAutoplay(autoplay && !isOpen, rootRef);
  const shownCollected = running ? demoCollected : collected;
  const shownWalker = running ? walker : null;

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setIsTouch(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const image = new Image();

    image.src = MASCOT_SRC;
    image.decoding = "async";
    image.onload = () => {
      mascotTileRef.current = null;
    };
    mascotRef.current = image;
  }, []);

  const clearDismiss = useCallback(() => {
    if (dismissRef.current === null) return;

    window.clearTimeout(dismissRef.current);
    dismissRef.current = null;
  }, []);

  useEffect(
    () => () => {
      clearDismiss();
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
    },
    [clearDismiss],
  );

  /* ---- the intro map --------------------------------------------------- */

  /* Repainted whenever what it shows changes, and re-measured whenever its box does. */
  const paintIntroRef = useRef<() => void>(() => {});

  useEffect(() => {
    paintIntroRef.current = () => {
      if (layout) paintTownDiorama(introMapRef.current, { layout, collected: shownCollected, walker: shownWalker });
    };
    paintIntroRef.current();
  }, [isOpen, layout, shownCollected, shownWalker]);

  useEffect(() => {
    const canvas = introMapRef.current;

    if (isOpen || !canvas || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => paintIntroRef.current());

    observer.observe(canvas);

    return () => observer.disconnect();
  }, [isOpen]);

  /* ---- the minimap, every frame --------------------------------------- */

  const drawMinimap = useCallback((snapshot: PalaceSnapshot, collectedIds: ReadonlySet<string>) => {
    const canvas = minimapRef.current;
    const current = layoutRef.current;

    if (!canvas || !current) return;

    const size = canvas.clientWidth;

    if (size === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      mascotTileRef.current = null;
    }

    const context = canvas.getContext("2d");

    if (!context) return;

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

    const unit = size / 122;

    context.strokeStyle = "rgba(255, 255, 255, 0.2)";
    context.lineWidth = Math.max(2 * unit, 11 * scale);
    current.roads.forEach((road) => {
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

    current.houses.forEach((house) => {
      const point = toCanvas(house.x, house.z);
      if (point.x < -12 || point.x > size + 12 || point.y < -12 || point.y > size + 12) return;
      context.save();
      context.translate(point.x, point.y);
      context.rotate(-house.facing);
      context.fillStyle = house.landmark ? `hsl(${house.hue} 28% 64% / 0.85)` : "rgba(192, 205, 195, 0.35)";
      context.fillRect((-house.width * scale) / 2, (-house.depth * scale) / 2, house.width * scale, house.depth * scale);
      context.restore();
    });

    const icon = Math.round(Math.min(20, Math.max(13, size * 0.15)));
    const mascot = mascotRef.current;

    if (mascotTileRef.current?.width !== Math.round(icon * dpr) && mascot?.complete && mascot.naturalWidth > 0) {
      const tile = document.createElement("canvas");

      tile.width = Math.round(icon * dpr);
      tile.height = Math.round(icon * dpr);
      tile.getContext("2d")?.drawImage(mascot, 0, 0, tile.width, tile.height);
      mascotTileRef.current = tile;
    }

    const mascotTile = mascotTileRef.current;
    const allMarkers = current.stations
      .map((entry) => ({ entry, distance: Math.hypot(entry.x - snapshot.x, entry.z - snapshot.z) }))
      .sort((left, right) => left.distance - right.distance);

    allMarkers
      .filter(({ entry, distance }) => collectedIds.has(entry.id) && distance <= MAP_RANGE)
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

    const drawn: { x: number; y: number }[] = [];
    let nearest: { x: number; y: number } | null = null;

    allMarkers
      .filter(({ entry }) => !collectedIds.has(entry.id))
      .forEach(({ entry }) => {
        const point = minimapMarker(snapshot, entry, size, MAP_RANGE, icon / 2 + 6 * unit);

        nearest ??= point;

        if (drawn.length >= MAX_MAP_MARKERS) return;
        if (drawn.some((other) => Math.hypot(other.x - point.x, other.y - point.y) < icon * 0.85)) return;

        drawn.push(point);
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

    context.fillStyle = "#fff";
    context.font = `600 ${9 * unit}px system-ui`;
    context.textAlign = "center";
    context.fillText("N", radius, 12 * unit);
    context.save();
    context.translate(radius, radius);
    context.rotate(mapArrowAngle(snapshot.cameraYaw));
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
  }, []);

  /* ---- stops ------------------------------------------------------------ */

  const openStation = useCallback(
    (stationId: string | null) => {
      clearDismiss();
      answeredRef.current = null;
      const next = stationId ? layoutRef.current?.stations.find((entry) => entry.id === stationId) ?? null : null;
      setStation(next);
      setIsFlipped(false);
      setQuizChoice(null);
      setQuizOrder(next?.kind === "quiz" ? shuffleIndices(quizById.get(next.id)?.options.length ?? 0) : []);
    },
    [clearDismiss, quizById],
  );

  const leaveStation = useCallback(() => {
    clearDismiss();
    gameRef.current?.releaseStation();
    openStation(null);
  }, [clearDismiss, openStation]);

  /** Only a successful recall collects a stop; a miss moves it somewhere else in town. */
  const resolveAnswer = useCallback(
    (id: string, known: boolean) => {
      if (answeredRef.current === id) return;
      answeredRef.current = id;
      setResults((current) => ({ ...current, [id]: known ? "easy" : "again" }));

      if (known) {
        setCollected((current) => new Set(current).add(id));
        /* The question goes on a sign over the stop, as in the app. */
        gameRef.current?.markCollected(id, cardsById.get(id)?.front ?? quizById.get(id)?.prompt);
        return;
      }

      const current = layoutRef.current;
      const entry = current?.stations.find((candidate) => candidate.id === id);

      if (!current || !entry) return;

      const spotIndex = chooseRelocation(entry, current.stations, spots);

      if (spotIndex === null) return;

      const moved = relocatedStation(entry, spots[spotIndex]);
      const next = { ...current, stations: current.stations.map((candidate) => (candidate.id === id ? moved : candidate)) };

      layoutRef.current = next;
      gameRef.current?.relocateStation(moved);
      setLayout(next);
    },
    [cardsById, quizById, spots],
  );

  const gradeCard = useCallback(
    (cardId: string, bucket: FlashcardBucket, exitStart?: { xPercent: number; yPercent: number; rotationDeg: number }) => {
      if (answeredRef.current === cardId) return;
      resolveAnswer(cardId, bucket === "easy");
      exitTokenRef.current += 1;

      const token = exitTokenRef.current;

      setCardExit({
        bucket,
        flipped: isFlipped,
        token,
        startXPercent: exitStart?.xPercent ?? 0,
        startYPercent: exitStart?.yPercent ?? 0,
        startRotationDeg: exitStart?.rotationDeg ?? 0,
      });

      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);

      exitTimerRef.current = window.setTimeout(() => {
        setCardExit((current) => (current?.token === token ? null : current));
        exitTimerRef.current = null;
      }, FLASHCARD_EXIT_ANIMATION_MS);

      leaveStation();
    },
    [isFlipped, leaveStation, resolveAnswer],
  );

  const answerQuiz = useCallback(
    (questionId: string, optionIndex: number, correctIndex: number) => {
      if (answeredRef.current === questionId) return;
      const right = optionIndex === correctIndex;

      setQuizChoice(optionIndex);
      resolveAnswer(questionId, right);
      clearDismiss();

      if (right) {
        dismissRef.current = window.setTimeout(leaveStation, QUIZ_RESULT_PAUSE);
      }
    },
    [clearDismiss, leaveStation, resolveAnswer],
  );

  /* ---- the engine ------------------------------------------------------- */

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    openStation(null);
    movementOriginRef.current = null;
    movementStartedRef.current = false;
    setHasMoved(false);

    void (async () => {
      try {
        const { createPalaceGame } = await import("@/lib/palace/game");
        /* Let the arrival screen paint before the geometry and shader work. */
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

        const canvas = canvasRef.current;
        const current = layoutRef.current;

        if (cancelled || !canvas || !current || gameRef.current) return;

        gameRef.current = createPalaceGame({
          canvas,
          layout: current,
          collectedIds: [...collectedRef.current],
          onNearStation: openStation,
          onContextLost: () => {
            gameRef.current?.dispose();
            gameRef.current = null;
            setCanvasEpoch((epoch) => epoch + 1);
          },
          onFrame: (snapshot) => {
            snapshotRef.current = snapshot;
            drawMinimap(snapshot, collectedRef.current);

            if (!movementOriginRef.current) movementOriginRef.current = snapshot;
            if (
              !movementStartedRef.current &&
              Math.hypot(snapshot.x - movementOriginRef.current.x, snapshot.z - movementOriginRef.current.z) > 0.08
            ) {
              movementStartedRef.current = true;
              setHasMoved(true);
            }
          },
        });
        setIsBuilt(true);
      } catch {
        /* A device without WebGL, or a chunk that never arrived. */
        if (!cancelled) setLoadError(true);
      }
    })();

    return () => {
      cancelled = true;
      gameRef.current?.dispose();
      gameRef.current = null;
    };
  }, [canvasEpoch, drawMinimap, isOpen, openStation]);

  const isComplete = Boolean(
    layout?.stations.length && layout.stations.every((entry) => collected.has(entry.id)) && !station,
  );

  /* Resized with its box, paused while the page is hidden or the walk is over. */
  useEffect(() => {
    if (!isOpen) return;

    const stage = stageRef.current;
    const observer =
      stage && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => gameRef.current?.resize())
        : null;

    if (stage) observer?.observe(stage);

    /*
     * On the landing page the game can also be scrolled out of sight while it is open.
     * The engine listens for the arrow keys on the whole window, so left running it
     * would keep drawing frames nobody sees and eat the keys that scroll the page.
     */
    let onScreen = true;
    const onVisibility = () =>
      gameRef.current?.setPaused(document.hidden || isComplete || !onScreen);
    const sight =
      stage && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            onScreen = entries.some((entry) => entry.isIntersecting);
            onVisibility();
          })
        : null;

    if (stage) sight?.observe(stage);

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      observer?.disconnect();
      sight?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isBuilt, isComplete, isOpen]);

  const enterGame = useCallback(() => {
    setIsBuilt(false);
    setLoadError(false);
    setIsOpen(true);
  }, []);

  const leaveGame = useCallback(() => {
    clearDismiss();
    setStation(null);
    setStickKnob(null);
    stickRef.current = null;
    lookRef.current = null;
    setIsOpen(false);
  }, [clearDismiss]);

  const restart = useCallback(() => {
    answeredRef.current = null;
    setLayout(baseLayout);
    setResults({});
    setCollected(new Set());
    setIsOpen(false);
  }, [baseLayout]);

  /* Escape takes one layer at a time, as in the app: the stop first, then the town. */
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (station) {
        leaveStation();
        return;
      }

      leaveGame();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, leaveGame, leaveStation, station]);

  /* ---- the stick and the look layer ----------------------------------- */

  /** A pointer in the stage's own pixels, which the landing may be drawing scaled. */
  const stagePoint = (event: ReactPointerEvent<HTMLElement>) => {
    const stage = stageRef.current;
    const rect = stage?.getBoundingClientRect();
    const scale = stage && rect && stage.offsetWidth > 0 ? rect.width / stage.offsetWidth : 1;

    return {
      x: (event.clientX - (rect?.left ?? 0)) / scale,
      y: (event.clientY - (rect?.top ?? 0)) / scale,
    };
  };

  const onStickPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (stickRef.current) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const point = stagePoint(event);
    stickRef.current = { pointerId: event.pointerId, originX: point.x, originY: point.y };
    setStickKnob(point);
  };

  const onStickPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stick = stickRef.current;

    if (!stick || stick.pointerId !== event.pointerId) return;

    const point = stagePoint(event);
    const dx = point.x - stick.originX;
    const dy = point.y - stick.originY;
    const distance = Math.hypot(dx, dy);

    if (distance < STICK_DEADZONE) {
      gameRef.current?.setMove(0, 0);
      return;
    }

    const clamped = Math.min(1, distance / STICK_RADIUS);
    const nx = (dx / distance) * clamped;
    const ny = (dy / distance) * clamped;

    gameRef.current?.setMove(-ny, nx);
    setStickKnob({ x: stick.originX + nx * STICK_RADIUS, y: stick.originY + ny * STICK_RADIUS });
  };

  const endStick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (stickRef.current?.pointerId !== event.pointerId) return;

    stickRef.current = null;
    gameRef.current?.setMove(0, 0);
    setStickKnob(null);
  };

  const onLookPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (lookRef.current) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    lookRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const onLookPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const look = lookRef.current;

    if (!look || look.pointerId !== event.pointerId) return;

    gameRef.current?.look(event.clientX - look.x, event.clientY - look.y);
    look.x = event.clientX;
    look.y = event.clientY;
  };

  const endLook = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (lookRef.current?.pointerId !== event.pointerId) return;

    lookRef.current = null;
  };

  /* ---- the walkthrough -------------------------------------------------- */

  /*
   * Memo walks the intro map from stop to stop, nearest first, and each one it reaches is
   * collected; with the town done it rests, and starts again from an empty walk.
   */
  const walkTargets = useMemo(() => {
    if (!layout) return [];

    const remaining = [...layout.stations];
    const route: PalaceStation[] = [];
    let from = { x: layout.spawn.x, z: layout.spawn.z };

    while (remaining.length > 0) {
      remaining.sort(
        (left, right) => Math.hypot(left.x - from.x, left.z - from.z) - Math.hypot(right.x - from.x, right.z - from.z),
      );
      const next = remaining.shift() as PalaceStation;
      route.push(next);
      from = next;
    }

    return route;
  }, [layout]);

  const nextTarget = walkTargets.find((entry) => !demoCollected.has(entry.id)) ?? null;
  const walkStep: LandingAutoplayStep = !layout
    ? null
    : nextTarget
      ? {
          key: `walk-${nextTarget.id}-${demoCollected.size}`,
          delay: walker ? WALK_REST_MS : 1_200,
          run: () => {
            const start = walker ?? { x: layout.spawn.x, z: layout.spawn.z, facing: 0 };
            const facing = Math.atan2(nextTarget.x - start.x, nextTarget.z - start.z);
            const began = performance.now();

            const frame = (now: number) => {
              const progress = Math.min(1, (now - began) / WALK_LEG_MS);
              const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;

              setWalker({
                x: start.x + (nextTarget.x - start.x) * eased,
                z: start.z + (nextTarget.z - start.z) * eased,
                facing,
              });

              if (progress < 1) {
                window.requestAnimationFrame(frame);
                return;
              }

              setDemoCollected((current) => new Set(current).add(nextTarget.id));
            };

            window.requestAnimationFrame(frame);
          },
        }
      : {
          key: `walk-reset-${demoCollected.size}`,
          delay: 2_600,
          run: () => {
            setDemoCollected(new Set());
            setWalker(null);
          },
        };

  useLandingAutoplayStep(running, walkStep);

  /* ---- render ----------------------------------------------------------- */

  const rootClassName = ["landing-study-screen landing-feature-screen", className].filter(Boolean).join(" ");

  if (!layout) {
    return (
      <LandingAppScope theme={theme} className={rootClassName}>
        <div className="landing-study-frame" data-note-tab="palace">
          <div className="memo-study-empty">
            <p className="memo-study-empty-title">{t("palace.title")}</p>
            <p className="memo-study-empty-copy">{t("palace.empty")}</p>
          </div>
        </div>
      </LandingAppScope>
    );
  }

  const total = layout.stations.length;
  const done = layout.stations.filter((entry) => collected.has(entry.id)).length;
  const shownDone = layout.stations.filter((entry) => shownCollected.has(entry.id)).length;
  const hasProgress = Object.keys(results).length > 0;

  const placeName = (index: number, location: PalaceStation | undefined = layout.stations[index]) => {
    const room = roomIdentity(index);
    const houseIndex = location?.houseIndex;
    const building =
      houseIndex === undefined
        ? ""
        : t(`palace.building.${buildingProfile(layout.houses[houseIndex], houseIndex).kind}` as MessageKey);

    if (location?.originalLocation) {
      return `${building} · ${String(room.number).padStart(2, "0")} · ${t("palace.outside")}`;
    }

    return `${building} · ${String(room.number).padStart(2, "0")} · ${t(`palace.color.${room.color}` as MessageKey)} · ${t(
      (location?.placement === "outside"
        ? `palace.outdoor.${outdoorLandmark(index)}`
        : `palace.room.${room.theme}`) as MessageKey,
    )}`;
  };

  const kindPill: Record<StudyKind, { label: string; icon: string; tint: string }> = {
    card: { label: t("note.tab.flashcards"), icon: "style", tint: "oklch(0.66 0.15 295)" },
    quiz: { label: t("note.tab.quiz"), icon: "quiz", tint: "oklch(0.66 0.15 340)" },
    test: { label: t("note.subScreen.test"), icon: "assignment", tint: "oklch(0.66 0.15 150)" },
  };
  const flipHint = t(isTouch ? "study.cards.flipMobile" : "study.cards.flipDesktop");

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
          onGrade={(bucket, exitStart) => gradeCard(card.id, bucket, exitStart)}
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

    const question = quizById.get(station.id);

    if (!question) return null;

    const wrong = quizChoice !== null && quizChoice !== question.correct_option_idx;
    const order = quizOrder.length === question.options.length ? quizOrder : question.options.map((_, index) => index);

    return (
      <div className="lecture-quiz-card">
        <StudyQuizQuestion
          question={question}
          order={order}
          selection={quizChoice}
          collapseAnswered={isTouch}
          onSelect={(optionIndex) => answerQuiz(question.id, optionIndex, question.correct_option_idx)}
        />

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
                  {t("quiz.correctAnswerIs", { letter: quizOptionLetter(order, question.correct_option_idx) })}
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

  return (
    <LandingAppScope theme={theme} className={rootClassName}>
      <div ref={rootRef} className="landing-study-frame" data-note-tab="palace">
        <div className="memo-palace-intro">
          <div className="memo-palace-hero">
            <canvas ref={introMapRef} className="memo-palace-hero-map" aria-hidden="true" />
            <NextImage className="memo-palace-hero-mascot" src={MASCOT_SRC} alt="" width={110} height={99} />
          </div>

          <div className="memo-palace-lede">
            <h2>{t("palace.title")}</h2>
            <p>{t("palace.intro")}</p>
          </div>

          <div className="memo-palace-progress">
            <div className="memo-palace-bar">
              <span style={{ width: `${total === 0 ? 0 : (shownDone / total) * 100}%` }} />
            </div>
            <p className="memo-palace-count">{t("palace.progressCount", { done: shownDone, total })}</p>
          </div>

          <div className="memo-palace-intro-actions">
            <button type="button" className="memo-palace-enter" onClick={enterGame}>
              <Msym name="play_arrow" size="1.35rem" fill weight={500} />
              {hasProgress ? t("palace.resume") : t("palace.start")}
            </button>

            {hasProgress ? (
              <button type="button" className="memo-button-outline small" onClick={restart}>
                <Msym name="replay" size="1.1rem" fill={false} weight={500} />
                {t("palace.restart")}
              </button>
            ) : null}
          </div>
        </div>

        {isOpen ? (
          <div ref={stageRef} className="memo-palace-stage" role="dialog" aria-label={t("palace.title")}>
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
                onLostPointerCapture={endStick}
              >
                <span className="memo-palace-stick-base" aria-hidden="true" />
                {stickKnob ? (
                  <span className="memo-palace-knob" style={{ left: `${stickKnob.x}px`, top: `${stickKnob.y}px` }} />
                ) : null}
              </div>
            ) : null}

            {/* The app's corner map; its full-screen city map is a sheet, and is not drawn here. */}
            <div className="memo-palace-map" aria-hidden="true">
              <canvas ref={minimapRef} />
            </div>

            <div className="memo-palace-hud-top">
              <span className="memo-palace-score">
                <span className="memo-palace-score-token" aria-hidden="true" />
                {done} <span className="memo-palace-score-slash">/</span> {total}
              </span>
            </div>

            <button type="button" className="memo-palace-exit" onClick={leaveGame} aria-label={t("palace.exit")}>
              <Msym name="arrow_back" size="1.1rem" />
              <span className="memo-palace-exit-label">{t("palace.exit")}</span>
            </button>

            {!hasMoved && !station ? (
              <p className="memo-palace-hint">{t(isTouch ? "palace.hintTouch" : "palace.hintDesktop")}</p>
            ) : null}

            {!loadError ? <PalaceLoading ready={isBuilt} /> : null}

            {loadError ? (
              <div className="memo-palace-loading">
                <p>{t("palace.unsupported")}</p>
                <button type="button" className="memo-button-outline small" onClick={leaveGame}>
                  {t("palace.exit")}
                </button>
              </div>
            ) : null}

            {station ? (
              <div className="memo-palace-panel-scrim" role="presentation" onClick={leaveStation}>
                <div
                  className={`memo-palace-panel ${station.kind}`}
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  aria-label={kindPill[station.kind].label}
                  data-presentation={isTouch ? "sheet" : "dialog"}
                >
                  <button
                    type="button"
                    className="memo-sheet-close memo-palace-close"
                    aria-label={t("common.close")}
                    onClick={leaveStation}
                  >
                    <Msym name="close" size="1.1rem" />
                  </button>
                  <div className="memo-palace-panel-head memo-sheet-title">
                    <span
                      className="memo-tab active memo-palace-panel-kind"
                      style={{ "--tab-tint": kindPill[station.kind].tint } as CSSProperties}
                    >
                      <Msym name={kindPill[station.kind].icon} size="1.2rem" fill={false} weight={500} />
                      <span>{kindPill[station.kind].label}</span>
                    </span>
                  </div>
                  <div className="memo-palace-panel-where">{placeName(station.index, station)}</div>
                  {renderStation()}
                </div>
              </div>
            ) : null}

            {isComplete ? (
              <div className="memo-palace-finish">
                <StudyCompletionCard
                  eyebrow={t("study.completed")}
                  title={t("palace.done.title")}
                  subtitle={t("palace.done.copy")}
                  percentage={total === 0 ? 0 : (done / total) * 100}
                  percentageLabel={t("study.score")}
                  primaryMetric={{ label: t("study.correctAnswers"), value: `${done}/${total}` }}
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
                      <button type="button" className="memo-button-outline small" onClick={leaveGame}>
                        {t("palace.exit")}
                      </button>
                    </>
                  }
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </LandingAppScope>
  );
}
