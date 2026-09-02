import type { CSSProperties } from "react";

import "./giveaway-phone.css";

import { GIVEAWAY_PRIZE_NAME } from "@/lib/giveaway-shared";

/**
 * The prize as a picture: an iPhone frame from devices.css with a lock
 * screen of our own, so the landing page and the giveaway screen show the
 * same thing at different sizes. `scale` is a fraction of the library's
 * native 428×868 render.
 */
export function GiveawayPhone({
  scale = 0.4,
  className,
  note,
}: {
  scale?: number;
  className?: string;
  /** The notification on the lock screen, already translated. */
  note?: { title: string; body: string };
}) {
  return (
    <div
      className={["giveaway-phone", className ?? ""].filter(Boolean).join(" ")}
      style={{ "--phone-scale": scale } as CSSProperties}
      role="img"
      aria-label={GIVEAWAY_PRIZE_NAME}
    >
      <div className="device" aria-hidden="true">
        <div className="device-frame">
          <div className="device-screen">
            <p className="lock-date">{GIVEAWAY_PRIZE_NAME}</p>
            <p className="lock-time">9:41</p>
            {note ? (
              <div className="lock-note">
                {/* Fluent Emoji 3D trophy (MIT), in /public/giveaway. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/giveaway/trophy.png" alt="" />
                <div>
                  <strong>{note.title}</strong>
                  <span>{note.body}</span>
                </div>
              </div>
            ) : null}
            <span className="lock-bar" />
          </div>
        </div>
        <div className="device-stripe" />
        <div className="device-header" />
        <div className="device-sensors" />
        <div className="device-btns" />
        <div className="device-power" />
      </div>
    </div>
  );
}
