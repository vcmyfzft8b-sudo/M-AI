"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import type { PalaceGame, PalaceSnapshot } from "@/lib/palace/game";
import { buildPalaceLayout, mapArrowAngle, mapExtent } from "@/lib/palace/layout";
import type { FlashcardWithCitations, StudySectionWithProgress } from "@/lib/types";

/**
 * The memory palace.
 *
 * The oldest study technique there is, which is why it is worth building: you
 * remember a walk through a place far better than a list, so the deck is laid
 * out as a city and each card is a screen you walk up to. One district per
 * section of the note, the cards always in the same order in the same place, so
 * by the third visit "the one by the red tower" is a real memory rather than a
 * figure of speech.
 *
 * A recall here is a recall everywhere: grading a card posts to the same
 * flashcard progress the deck screen writes, so an hour in the city moves the
 * same record as an hour with the cards.
 *
 * The engine is loaded only when the door is opened — three.js is far too much
 * to hand every reader of a note.
 */

const COLLECTED_STORAGE_PREFIX = "memo.palace.collected.";
/** The stick is dead in the middle, so a resting thumb is not a slow walk. */
const STICK_DEADZONE = 6;
const STICK_RADIUS = 46;

type PalaceCardText = { title: string; body: string };

function readCollected(lectureId: string) {
  try {
    const raw = window.localStorage.getItem(`${COLLECTED_STORAGE_PREFIX}${lectureId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
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
  sections,
  isReady,
}: {
  lectureId: string;
  cards: FlashcardWithCitations[];
  sections: StudySectionWithProgress[];
  isReady: boolean;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<PalaceGame | null>(null);
  const snapshotRef = useRef<PalaceSnapshot | null>(null);
  const stickRef = useRef<{ pointerId: number; originX: number; originY: number } | null>(null);
  const lookRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collected, setCollected] = useState<Set<string>>(() => new Set());
  const [nearCardId, setNearCardId] = useState<string | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [districtIndex, setDistrictIndex] = useState(0);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [stickKnob, setStickKnob] = useState<{ x: number; y: number } | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  /*
   * Bumped when the GPU drops the drawing context: the canvas element itself
   * has to be replaced, because a lost context cannot be reopened on it.
   */
  const [canvasEpoch, setCanvasEpoch] = useState(0);

  const layout = useMemo(
    () =>
      cards.length === 0
        ? null
        : buildPalaceLayout({
            seedSource: lectureId,
            cards: cards.map((card) => ({ id: card.id, sectionId: card.section_id })),
            sections: sections.map((section) => ({ id: section.id, title: section.title })),
            fallbackTitle: t("palace.district.default"),
          }),
    [cards, lectureId, sections, t],
  );

  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const cardText = useMemo(() => {
    const entries = new Map<string, PalaceCardText>();

    layout?.stations.forEach((station) => {
      const card = cardsById.get(station.id);

      if (!card) return;

      entries.set(station.id, {
        title: layout.districts[station.districtIndex]?.title ?? "",
        body: card.front,
      });
    });

    return entries;
  }, [cardsById, layout]);

  /* Where the run got to last time, restored on the client only. */
  useEffect(() => {
    setCollected(readCollected(lectureId));
  }, [lectureId]);

  useEffect(() => {
    setIsTouch(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  const nearCard = nearCardId ? cardsById.get(nearCardId) ?? null : null;

  const drawMinimap = useCallback(
    (snapshot: PalaceSnapshot, collectedIds: Set<string>) => {
      const canvas = minimapRef.current;

      if (!canvas || !layout) return;

      const context = canvas.getContext("2d");

      if (!context) return;

      const size = canvas.width;
      const scale = size / (mapExtent(layout) * 2);
      const toCanvas = (x: number, z: number) => ({
        x: size / 2 + x * scale,
        y: size / 2 + z * scale,
      });

      context.clearRect(0, 0, size, size);
      context.fillStyle = "rgba(18, 16, 26, 0.72)";
      context.beginPath();
      context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      context.fill();
      context.save();
      context.clip();

      layout.districts.forEach((district) => {
        const center = toCanvas(district.center.x, district.center.z);

        context.fillStyle = `hsl(${district.hue} 55% 60% / 0.22)`;
        context.beginPath();
        context.arc(center.x, center.y, district.radius * scale, 0, Math.PI * 2);
        context.fill();
      });

      layout.stations.forEach((station) => {
        const point = toCanvas(station.x, station.z);
        const isCollected = collectedIds.has(station.id);

        context.fillStyle = isCollected
          ? "rgba(255, 255, 255, 0.28)"
          : `hsl(${station.hue} 85% 62%)`;
        context.beginPath();
        context.arc(point.x, point.y, isCollected ? 2 : 3.1, 0, Math.PI * 2);
        context.fill();
      });

      /* The player is an arrow, because a dot cannot tell you which way you face. */
      const player = toCanvas(snapshot.x, snapshot.z);

      context.save();
      context.translate(player.x, player.y);
      context.rotate(mapArrowAngle(snapshot.facing));
      context.fillStyle = "#ffffff";
      context.beginPath();
      context.moveTo(0, -6);
      context.lineTo(4.6, 5);
      context.lineTo(0, 2.4);
      context.lineTo(-4.6, 5);
      context.closePath();
      context.fill();
      context.restore();
      context.restore();
    },
    [layout],
  );

  /* The frame callback must not re-render: it fires sixty times a second. */
  const collectedRef = useRef(collected);

  useEffect(() => {
    collectedRef.current = collected;
  }, [collected]);

  const startGame = useCallback(async () => {
    if (!layout || gameRef.current) return;

    setIsLoading(true);
    setLoadError(null);

    try {
      const { createPalaceGame } = await import("@/lib/palace/game");
      const canvas = canvasRef.current;

      if (!canvas) return;

      let minimapFrame = 0;

      gameRef.current = createPalaceGame({
        canvas,
        layout,
        cardText,
        collectedIds: [...collectedRef.current],
        onNearStation: (stationId) => {
          setNearCardId(stationId);
          setIsRevealed(false);
        },
        onContextLost: () => {
          gameRef.current = null;
          setCanvasEpoch((current) => current + 1);
        },
        onFrame: (snapshot) => {
          snapshotRef.current = snapshot;
          minimapFrame += 1;

          /* Twenty map redraws a second is plenty, and leaves the GPU alone. */
          if (minimapFrame % 3 === 0) {
            drawMinimap(snapshot, collectedRef.current);
          }

          setDistrictIndex((current) =>
            current === snapshot.districtIndex ? current : snapshot.districtIndex,
          );
        },
      });
    } catch (error) {
      /* A device without WebGL, or a chunk that never arrived. */
      setLoadError(error instanceof Error ? error.message : t("palace.unsupported"));
    } finally {
      setIsLoading(false);
    }
  }, [cardText, drawMinimap, layout, t]);

  useEffect(() => {
    if (!isOpen) return;

    /* A restarted engine puts you back at the spawn, with nothing under your nose. */
    setNearCardId(null);
    setIsRevealed(false);
    void startGame();

    return () => {
      gameRef.current?.dispose();
      gameRef.current = null;
    };
  }, [canvasEpoch, isOpen, startGame]);

  /* The page behind must not scroll under the city while it is open. */
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

    const onResize = () => gameRef.current?.resize();
    /* A backgrounded tab should not keep a render loop alive on a phone battery. */
    const onVisibility = () => gameRef.current?.setPaused(document.hidden);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  /* The map sheet and an open card both stop the world; the loop keeps rendering. */
  useEffect(() => {
    gameRef.current?.setPaused(isMapOpen);

    if (isMapOpen) {
      gameRef.current?.setMove(0, 0);
    }
  }, [isMapOpen]);

  const grade = useCallback(
    async (cardId: string, confidenceBucket: "again" | "good") => {
      if (confidenceBucket === "good") {
        setCollected((current) => {
          const next = new Set(current);

          next.add(cardId);
          writeCollected(lectureId, next);

          return next;
        });
        gameRef.current?.markCollected(cardId);
      }

      /* Walking is handed back here, not when the card was opened. */
      gameRef.current?.releaseStation();
      setNearCardId(null);
      setIsRevealed(false);

      /*
       * The same record the deck writes. Fire and forget on purpose: a dropped
       * request must not stop the walk, and the next grade will carry the card
       * again anyway.
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
    [lectureId],
  );

  const restart = useCallback(() => {
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
      <div className="memo-palace-intro">
        <div className="memo-palace-cover placeholder" aria-hidden="true" />
        <h2 className="memo-palace-heading">{t("palace.title")}</h2>
        <p className="memo-palace-copy">
          {isReady ? t("palace.empty") : t("palace.notReady")}
        </p>
      </div>
    );
  }

  const total = layout.stations.length;
  const done = layout.stations.filter((station) => collected.has(station.id)).length;
  const district = layout.districts[districtIndex] ?? layout.districts[0];

  return (
    <>
      <div className="memo-palace-intro">
        <div className="memo-palace-cover" aria-hidden="true">
          <span className="memo-palace-cover-sky" />
          <span className="memo-palace-cover-tower tall" />
          <span className="memo-palace-cover-tower" />
          <span className="memo-palace-cover-tower short" />
          <span className="memo-palace-cover-token" />
        </div>
        <h2 className="memo-palace-heading">{t("palace.title")}</h2>
        <p className="memo-palace-copy">{t("palace.intro")}</p>

        <div className="memo-palace-progress" role="group" aria-label={t("palace.progressLabel")}>
          <div className="memo-palace-bar">
            <span style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }} />
          </div>
          <p className="memo-palace-count">
            {t("palace.progressCount", { done, total })}
          </p>
        </div>

        <div className="memo-palace-actions">
          <button type="button" className="memo-palace-cta" onClick={() => setIsOpen(true)}>
            <Msym name="explore" size="1.15rem" />
            {done > 0 ? t("palace.resume") : t("palace.start")}
          </button>
          {done > 0 ? (
            <button type="button" className="memo-button-outline small" onClick={restart}>
              {t("palace.restart")}
            </button>
          ) : null}
        </div>

        <ul className="memo-palace-districts">
          {layout.districts.map((entry) => {
            const entryDone = entry.stationIds.filter((id) => collected.has(id)).length;

            return (
              <li key={entry.index}>
                <span className="memo-palace-dot" style={{ background: `hsl(${entry.hue} 70% 58%)` }} />
                <span className="memo-palace-district-title">{entry.title}</span>
                <span className="memo-palace-district-count">
                  {entryDone}/{entry.stationIds.length}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {isOpen ? (
        <MemoPortal>
          <div className="memo-palace-stage" role="dialog" aria-modal="true" aria-label={t("palace.title")}>
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
              <canvas ref={minimapRef} width={170} height={170} />
            </button>

            <div className="memo-palace-hud-top">
              <span className="memo-palace-score">
                <span className="memo-palace-score-token" aria-hidden="true" />
                {done} <span className="memo-palace-score-slash">/</span> {total}
              </span>
              <span className="memo-palace-district-pill">{district?.title}</span>
            </div>

            <button type="button" className="memo-palace-exit" onClick={() => setIsOpen(false)}>
              <Msym name="arrow_back" size="1.1rem" />
              {t("palace.exit")}
            </button>

            {isTouch ? (
              <button
                type="button"
                className="memo-palace-jump"
                onPointerDown={() => gameRef.current?.jump()}
                aria-label={t("palace.jump")}
              >
                <Msym name="keyboard_double_arrow_up" size="1.5rem" />
              </button>
            ) : (
              <p className="memo-palace-hint">{t("palace.hintDesktop")}</p>
            )}

            {isLoading ? (
              <div className="memo-palace-loading">
                <p>{t("palace.loading")}</p>
                <span className="memo-palace-loading-bar" />
              </div>
            ) : null}

            {loadError ? (
              <div className="memo-palace-loading">
                <p>{t("palace.unsupported")}</p>
                <button type="button" className="memo-button-outline small" onClick={() => setIsOpen(false)}>
                  {t("palace.exit")}
                </button>
              </div>
            ) : null}

            {nearCard ? (
              <div className="memo-palace-card">
                <div className="memo-palace-card-head">
                  <p className="memo-palace-card-eyebrow">{district?.title}</p>
                  <button
                    type="button"
                    className="memo-palace-card-close"
                    aria-label={t("common.close")}
                    onClick={() => {
                      gameRef.current?.releaseStation();
                      setNearCardId(null);
                      setIsRevealed(false);
                    }}
                  >
                    <Msym name="close" size="1.1rem" />
                  </button>
                </div>
                <p className="memo-palace-card-front">{nearCard.front}</p>

                {isRevealed ? (
                  <>
                    <p className="memo-palace-card-back">{nearCard.back}</p>
                    <div className="memo-palace-card-actions">
                      <button
                        type="button"
                        className="memo-button-outline small"
                        onClick={() => void grade(nearCard.id, "again")}
                      >
                        {t("palace.notYet")}
                      </button>
                      <button
                        type="button"
                        className="memo-palace-cta small"
                        onClick={() => void grade(nearCard.id, "good")}
                      >
                        {t("palace.gotIt")}
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className="memo-palace-cta small"
                    onClick={() => setIsRevealed(true)}
                  >
                    {t("palace.reveal")}
                  </button>
                )}
              </div>
            ) : null}

            {isMapOpen ? (
              <div className="memo-palace-sheet">
                <div className="memo-palace-sheet-inner">
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
                              gameRef.current?.travelTo(entry.index);
                              setIsMapOpen(false);
                            }}
                          >
                            {t("palace.travel")}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    type="button"
                    className="memo-palace-cta small"
                    onClick={() => setIsMapOpen(false)}
                  >
                    {t("common.close")}
                  </button>
                </div>
              </div>
            ) : null}

            {done === total ? (
              <div className="memo-palace-done">
                <p className="memo-palace-done-title">{t("palace.done.title")}</p>
                <p className="memo-palace-done-copy">{t("palace.done.copy")}</p>
                <div className="memo-palace-card-actions">
                  <button type="button" className="memo-button-outline small" onClick={restart}>
                    {t("palace.restart")}
                  </button>
                  <button type="button" className="memo-palace-cta small" onClick={() => setIsOpen(false)}>
                    {t("palace.exit")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </MemoPortal>
      ) : null}
    </>
  );
}
