import type { CSSProperties } from "react";

import "./giveaway-phone.css";

import { GIVEAWAY_PRIZE_NAME } from "@/lib/giveaway-shared";

/**
 * The prize as a picture: a rendered iPhone with a lock screen of our
 * own, so the landing page and the giveaway screen show the same thing at
 * different sizes. `scale` is a fraction of the native 430×880 render.
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
      <div className="phone" aria-hidden="true">
        <div className="frame">
          <span className="btn action" />
          <span className="btn vol-up" />
          <span className="btn vol-down" />
          <span className="btn power" />
          <div className="bezel">
            <div className="screen">
              <span className="island" />
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
        </div>
      </div>
    </div>
  );
}
