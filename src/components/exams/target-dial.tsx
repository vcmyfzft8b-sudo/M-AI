"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import {
  TARGET_DIAL_SWEEP,
  TARGET_MAX,
  TARGET_MIN,
  TARGET_STEP,
  targetDialAngle,
  targetFromDialPoint,
} from "@/lib/exams/exam-model";

/* The gauge, in the SVG's own units: a 270° arc open at the bottom. */
const CENTER = 100;
const RADIUS = 80;
const TICKS = Array.from({ length: (TARGET_MAX - TARGET_MIN) / 10 + 1 }, (_, index) => TARGET_MIN + index * 10);

function point(angle: number, radius = RADIUS) {
  const radians = (angle * Math.PI) / 180;
  return { x: CENTER + radius * Math.sin(radians), y: CENTER - radius * Math.cos(radians) };
}

const START = point(-TARGET_DIAL_SWEEP);
const END = point(TARGET_DIAL_SWEEP);
const ARC = `M ${START.x} ${START.y} A ${RADIUS} ${RADIUS} 0 1 1 ${END.x} ${END.y}`;

function levelKey(target: number): MessageKey {
  if (target >= 100) {
    return "exam.setup.target.level.all";
  }

  if (target >= 85) {
    return "exam.setup.target.level.great";
  }

  if (target >= 70) {
    return "exam.setup.target.level.good";
  }

  return "exam.setup.target.level.pass";
}

/**
 * The target, set by dragging the knob round a gauge (or with the arrow keys). It moves in steps of
 * five between the lowest target the create route accepts and 100 %; the maths is in
 * `targetFromDialPoint`.
 */
export function TargetDial({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);
  const share = (value - TARGET_MIN) / (TARGET_MAX - TARGET_MIN);
  const knob = point(targetDialAngle(value));

  function follow(event: PointerEvent<HTMLDivElement>) {
    const box = rootRef.current?.getBoundingClientRect();

    if (!box) {
      return;
    }

    const next = targetFromDialPoint(
      event.clientX - (box.left + box.width / 2),
      event.clientY - (box.top + box.height / 2),
      value,
    );

    if (next !== value) {
      onChange(next);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowRight: TARGET_STEP,
      ArrowUp: TARGET_STEP,
      ArrowLeft: -TARGET_STEP,
      ArrowDown: -TARGET_STEP,
      Home: TARGET_MIN - value,
      End: TARGET_MAX - value,
    };

    if (!(event.key in moves)) {
      return;
    }

    event.preventDefault();
    setTouched(true);
    onChange(Math.min(TARGET_MAX, Math.max(TARGET_MIN, value + moves[event.key])));
  }

  return (
    <div className="memo-exam-dial-wrap">
      <div
        ref={rootRef}
        className={`memo-exam-dial ${dragging ? "dragging" : ""}`.trim()}
        role="slider"
        tabIndex={0}
        aria-label={t("exam.setup.target.title")}
        aria-valuemin={TARGET_MIN}
        aria-valuemax={TARGET_MAX}
        aria-valuenow={value}
        aria-valuetext={`${value} %, ${t(levelKey(value))}`}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          setTouched(true);
          follow(event);
        }}
        onPointerMove={(event) => {
          if (dragging) {
            follow(event);
          }
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <path className="memo-exam-dial-track" d={ARC} pathLength={100} />
          {TICKS.map((tick) => {
            const at = point(targetDialAngle(tick), RADIUS - 19);

            return (
              <circle
                key={tick}
                className={`memo-exam-dial-tick ${tick <= value ? "on" : ""}`.trim()}
                cx={at.x}
                cy={at.y}
                r={1.6}
              />
            );
          })}
          <path
            className="memo-exam-dial-fill"
            d={ARC}
            pathLength={100}
            strokeDasharray={`${share * 100} 100`}
          />
          <circle className="memo-exam-dial-knob" cx={knob.x} cy={knob.y} r={12} />
        </svg>
        <span className="memo-exam-dial-center">
          <b>
            {value}
            <small> %</small>
          </b>
          <span>{t(levelKey(value))}</span>
        </span>
        <span className="memo-exam-dial-end start">{TARGET_MIN} %</span>
        <span className="memo-exam-dial-end end">{TARGET_MAX} %</span>
      </div>
      <span className={`memo-exam-dial-hint ${touched ? "gone" : ""}`.trim()}>{t("exam.setup.target.drag")}</span>
    </div>
  );
}
