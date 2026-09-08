"use client";

import Image from "next/image";
import { useT } from "@/components/i18n-provider";

/** Lightweight enough to paint before the 3D engine starts building the town. */
export function PalaceLoading({ ready = false }: { ready?: boolean }) {
  const t = useT();

  return (
    <div className={`memo-palace-loading memo-palace-arrival${ready ? " is-ready" : ""}`} aria-hidden={ready || undefined}>
      <div className="memo-palace-arrival-content" role={ready ? undefined : "status"} aria-live="polite" aria-busy={!ready}>
        <div className="memo-palace-arrival-scene" aria-hidden="true">
          <svg viewBox="0 0 360 200" fill="none">
            <ellipse className="memo-palace-arrival-ground" cx="180" cy="160" rx="164" ry="28" />
            <g className="memo-palace-arrival-buildings" strokeWidth="2" strokeLinejoin="round">
              <path d="M40 149V109L69 87L98 109V149Z" />
              <path d="M34 111L69 83L104 111M61 149V129H77V149M48 117H57V125H48ZM82 117H91V125H82Z" />
              <path d="M114 149V54Q114 48 120 48H146Q152 48 152 54V149M110 149H156M115 73H151M115 94H151M115 115H151M132 49V149" />
              <path d="M225 149V100H281V149M219 100A34 34 0 0 1 287 100ZM245 149V126A8 8 0 0 1 261 126V149M234 109H241V117H234ZM265 109H272V117H265Z" />
              <path d="M293 149L316 108L340 149Z" />
            </g>
            <path className="memo-palace-arrival-route" d="M60 164H180Q193 164 193 151V114" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 8" />
            <circle className="memo-palace-arrival-pin" cx="60" cy="164" r="5" />
          </svg>
          <Image src="/memo-mascot.png" alt="" width={84} height={76} priority className="memo-palace-arrival-mascot" />
        </div>
        <p className="memo-eyebrow">{t("palace.title")}</p>
        <h2>{t("palace.loading")}</h2>
        <p className="memo-palace-arrival-copy">{t("palace.loadingHint")}</p>
        <span className="memo-gen-track" aria-hidden="true"><span /></span>
      </div>
    </div>
  );
}
