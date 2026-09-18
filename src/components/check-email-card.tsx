"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function CheckEmailCard(props: {
  email: string;
  message?: string;
  messageType: "error" | "info";
  mode: "login" | "signup";
  next: string;
  sentAt: number;
  cooldownSeconds: number;
}) {
  const t = useT();
  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [pendingAction, setPendingAction] = useState<"verify" | "resend" | null>(null);
  const bypassSubmitRef = useRef(false);

  const resendAvailableAt = useMemo(
    () => props.sentAt + props.cooldownSeconds * 1000,
    [props.cooldownSeconds, props.sentAt],
  );

  useEffect(() => {
    function updateCountdown() {
      const remaining = Math.max(
        0,
        Math.ceil((resendAvailableAt - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
    }

    updateCountdown();

    const intervalId = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(intervalId);
  }, [resendAvailableAt]);

  function lockAndSubmit(
    event: React.FormEvent<HTMLFormElement>,
    action: "verify" | "resend",
  ) {
    if (bypassSubmitRef.current) {
      bypassSubmitRef.current = false;
      return;
    }

    if (pendingAction !== null) {
      event.preventDefault();
      return;
    }

    const form = event.currentTarget;

    if (!form.reportValidity()) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    setPendingAction(action);

    requestAnimationFrame(() => {
      bypassSubmitRef.current = true;
      form.requestSubmit();
    });
  }

  return (
    <>
      <form
        action="/auth/email/verify"
        method="post"
        className="memo-auth-form"
        onSubmit={(event) => {
          lockAndSubmit(event, "verify");
        }}
      >
        <input type="hidden" name="email" value={props.email} />
        <input type="hidden" name="mode" value={props.mode} />
        <input type="hidden" name="next" value={props.next} />

        <label className="memo-auth-field code">
          <Msym name="password" fill={false} weight={500} />
          <input
            type="text"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6,8}"
            minLength={6}
            maxLength={8}
            autoComplete="one-time-code"
            placeholder={t("auth.enterCodePlaceholder")}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 8));
            }}
            aria-disabled={pendingAction !== null}
            required
            readOnly={pendingAction !== null}
          />
        </label>

        <button
          type="submit"
          className="memo-button-coral memo-auth-submit"
          disabled={pendingAction !== null}
          aria-busy={pendingAction === "verify"}
        >
          {pendingAction === "verify" ? (
            <Msym name="progress_activity" fill={false} weight={500} className="memo-spin" />
          ) : null}
          <span>{t(pendingAction === "verify" ? "auth.verifying" : "common.continue")}</span>
        </button>
      </form>

      {/* `auth.codeValidNote` says the same thing as the copy on the page above
          this card, word for word, so the note is kept for what only it can
          say: what the server sent back on the last attempt. */}
      {props.message ? (
        <p className={`memo-auth-note ${props.messageType === "error" ? "error" : ""}`}>
          {props.message}
        </p>
      ) : null}

      <div className="memo-auth-actions">
        <form
          action="/auth/email"
          method="post"
          className="memo-auth-provider-form"
          onSubmit={(event) => {
            lockAndSubmit(event, "resend");
          }}
        >
          <input type="hidden" name="email" value={props.email} />
          <input type="hidden" name="mode" value={props.mode} />
          <input type="hidden" name="next" value={props.next} />
          <button
            type="submit"
            className="memo-button-outline memo-auth-resend"
            disabled={secondsLeft > 0 || pendingAction !== null}
            aria-disabled={secondsLeft > 0 || pendingAction !== null}
            aria-busy={pendingAction === "resend"}
          >
            {pendingAction === "resend"
              ? t("auth.sending")
              : secondsLeft > 0
                ? t("auth.resendIn", { countdown: formatCountdown(secondsLeft) })
                : t("auth.resendNow")}
          </button>
        </form>
        <Link href="/auth/continue" className="memo-auth-ghost">
          {t("auth.useAnotherMethod")}
        </Link>
      </div>
    </>
  );
}
