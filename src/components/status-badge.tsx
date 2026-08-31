"use client";

import { useT } from "@/components/i18n-provider";
import type { LectureStatus } from "@/lib/database.types";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { cn } from "@/lib/utils";

const statusMap: Record<
  LectureStatus,
  { labelKey: MessageKey; className: string }
> = {
  uploading: {
    labelKey: "status.uploading",
    className: "bg-[var(--tertiary-background)] text-[var(--secondary-label)]",
  },
  queued: {
    labelKey: "status.queued",
    className: "bg-[var(--tertiary-background)] text-[var(--secondary-label)]",
  },
  transcribing: {
    labelKey: "status.transcribing",
    className: "bg-[var(--tertiary-background)] text-[var(--secondary-label)]",
  },
  generating_notes: {
    labelKey: "status.generatingNotes",
    className: "bg-[var(--tertiary-background)] text-[var(--secondary-label)]",
  },
  ready: {
    labelKey: "status.ready",
    className: "bg-[var(--green-soft)] text-[var(--green)]",
  },
  failed: {
    labelKey: "status.failed",
    className: "bg-[var(--red-soft)] text-[var(--red)]",
  },
};

export function StatusBadge({ status }: { status: LectureStatus }) {
  const t = useT();
  const config = statusMap[status];

  return (
    <span
      className={cn(
        "ios-status px-2.5 py-1 uppercase tracking-[0.04em]",
        config.className,
      )}
    >
      {t(config.labelKey)}
    </span>
  );
}
