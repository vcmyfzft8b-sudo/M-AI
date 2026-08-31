import Image from "next/image";

import type { HOME_SCREEN_STEPS } from "@/lib/install-guide";

type Step = (typeof HOME_SCREEN_STEPS)[number];

/** The captures are all this size; see scripts in src/lib/install-guide.ts. */
const SHOT_WIDTH = 750;
const SHOT_HEIGHT = 1631;

/**
 * One screenshot from the home-screen guide, with the box that points at the
 * control being described.
 *
 * Both appearances are in the DOM and CSS picks between them. A hook reading
 * the theme would be smaller on the wire, but it cannot answer during the
 * server render, so the first paint would show one set and swap to the other —
 * on the very screen whose whole job is to look like the reader's own phone.
 * The pair costs about 80 KB, against the 3.7 MB the four unresized PNGs this
 * replaces used to cost, so the trade is worth making.
 *
 * `unoptimized`, because the files are already cut to the width they render at
 * and 40 KB of WebP is smaller than the optimiser's own round trip on a cold
 * cache. Eager, because a step-by-step guide whose pictures arrive one scroll
 * behind the words is worse than no pictures.
 */
export function InstallShot({ step, sizes }: { step: Step; sizes: string }) {
  return (
    <>
      {(["light", "dark"] as const).map((theme) => (
        <Image
          key={theme}
          className={`memo-shot-${theme}`}
          src={step[theme]}
          alt={step.alt}
          width={SHOT_WIDTH}
          height={SHOT_HEIGHT}
          sizes={sizes}
          loading="eager"
          unoptimized
        />
      ))}
    </>
  );
}
