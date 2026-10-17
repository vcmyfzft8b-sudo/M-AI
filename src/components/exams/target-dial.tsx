"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import {
  DIAL_SWEEP,
  dialAngle,
  dialValueFromPoint,
  TARGET_RANGE,
  type DialRange,
} from "@/lib/exams/exam-model";

/* The gauge, in the SVG's own units: a 270° arc open at the bottom. */
const CENTER = 100;
const RADIUS = 80;

function point(angle: number, radius = RADIUS) {
  const radians = (angle * Math.PI) / 180;
  return { x: CENTER + radius * Math.sin(radians), y: CENTER - radius * Math.cos(radians) };
}

const START = point(-DIAL_SWEEP);
const END = point(DIAL_SWEEP);
const ARC = `M ${START.x} ${START.y} A ${RADIUS} ${RADIUS} 0 1 1 ${END.x} ${END.y}`;

/**
 * A value set by dragging a knob round a gauge (or with the arrow keys), in the range's steps: the
 * setup's target and the mock exam's length (Astra's circular timer). The maths is
 * `dialValueFromPoint`; the centre shows the value and a word about it, and nothing else: no ticks,
 * no end labels, no "drag" hint (the knob says it).
 */
export function GaugeDial({
  value,
  onChange,
  range,
  label,
  valueText,
  unit,
  caption,
}: {
  value: number;
  onChange: (value: number) => void;
  range: DialRange;
  /** The slider's accessible name. */
  label: string;
  /** How the value reads aloud, e.g. "90 %, excellent". */
  valueText: string;
  unit: string;
  caption: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const share = (value - range.min) / (range.max - range.min);
  const knob = point(dialAngle(value, range));

  function follow(event: PointerEvent<HTMLDivElement>) {
    const box = rootRef.current?.getBoundingClientRect();

    if (!box) {
      return;
    }

    const next = dialValueFromPoint(
      event.clientX - (box.left + box.width / 2),
      event.clientY - (box.top + box.height / 2),
      value,
      range,
    );

    if (next !== value) {
      onChange(next);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowRight: range.step,
      ArrowUp: range.step,
      ArrowLeft: -range.step,
      ArrowDown: -range.step,
      Home: range.min - value,
      End: range.max - value,
    };

    if (!(event.key in moves)) {
      return;
    }

    event.preventDefault();
    onChange(Math.min(range.max, Math.max(range.min, value + moves[event.key])));
  }

  return (
    <div className="memo-exam-dial-wrap">
      <div
        ref={rootRef}
        className={`memo-exam-dial ${dragging ? "dragging" : ""}`.trim()}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={range.min}
        aria-valuemax={range.max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
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
          <path className="memo-exam-dial-fill" d={ARC} pathLength={100} strokeDasharray={`${share * 100} 100`} />
          <circle className="memo-exam-dial-knob" cx={knob.x} cy={knob.y} r={12} />
        </svg>
        <span className="memo-exam-dial-center">
          <b>
            {value}
            <small> {unit}</small>
          </b>
          <span>{caption}</span>
        </span>
      </div>
    </div>
  );
}

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

/** The setup's target, in steps of five between the lowest target the create route accepts and 100 %. */
export function TargetDial({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const t = useT();

  return (
    <GaugeDial
      value={value}
      onChange={onChange}
      range={TARGET_RANGE}
      label={t("exam.setup.target.title")}
      valueText={`${value} %, ${t(levelKey(value))}`}
      unit="%"
      caption={t(levelKey(value))}
    />
  );
}
