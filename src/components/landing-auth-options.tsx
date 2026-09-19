"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { isNativeIOS, nativeRequest } from "@/lib/mobile/client";

function GoogleMark() {
  return (
    <svg className="memo-auth-provider-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg className="memo-auth-provider-icon memo-auth-provider-icon-apple" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.67 12.91c.02 2.29 2 3.05 2.02 3.06-.02.05-.31 1.06-1.03 2.1-.62.89-1.27 1.78-2.29 1.8-1 .02-1.32-.59-2.46-.59-1.15 0-1.5.57-2.44.61-.99.04-1.75-.99-2.37-1.88-1.27-1.83-2.24-5.18-.94-7.44.65-1.12 1.8-1.83 3.06-1.85.95-.02 1.86.64 2.46.64.61 0 1.75-.79 2.95-.67.5.02 1.91.2 2.82 1.53-.08.05-1.69.99-1.68 2.69Zm-2.11-7.29c.52-.63.87-1.5.78-2.37-.75.03-1.65.5-2.18 1.13-.48.56-.9 1.45-.79 2.31.84.07 1.68-.42 2.19-1.07Z"
      />
    </svg>
  );
}

type PendingTarget = "google" | "apple" | "email" | null;

export function LandingAuthOptions(props: {
  providers: {
    apple: boolean;
    email: boolean;
    google: boolean;
  };
  next: string;
  /**
   * Which email flow the "continue with email" button opens. The landing page
   * wants `signup` so a new visitor gets an account; the admin login wants
   * `login`, which must not create one for an address nobody has allowlisted.
   */
  mode?: "login" | "signup";
}) {
  const t = useT();
  const router = useRouter();
  const [pendingTarget, setPendingTarget] = useState<PendingTarget>(null);
  const [notice, setNotice] = useState("");
  const emailHref = `/auth/email-entry?mode=${props.mode ?? "signup"}&next=${encodeURIComponent(props.next)}`;

  /*
   * The wrapper replies to a failed native sign-in with its localised
   * "action failed" text plus, in brackets, the step that failed (the
   * provider's error, a rejected callback, a server status). The headline is
   * ours; the bracketed detail is kept so a failure can be reported exactly.
   */
  function signInFailure(error: unknown) {
    const detail = error instanceof Error ? /\[(.+)\]\s*$/.exec(error.message)?.[1] : undefined;
    return detail ? `${t("native.signInFailed")} (${detail})` : t("native.signInFailed");
  }

  /*
   * The other way the app's Google sign-in can finish.
   *
   * The sign-in sheet is supposed to hand the code back by navigating to the
   * app's own scheme, and on some phones that navigation never arrives: the
   * page the provider returns to is reached every time, the sheet simply sits
   * there, and nothing completes. That page also writes the code down for this
   * cookie jar, so this asks for it. Whichever route answers first signs in;
   * the note is single use, so the other finds nothing left.
   */
  async function collectGoogleSession(flow: { done: boolean }) {
    const deadline = Date.now() + 3 * 60 * 1000;

    while (!flow.done && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1200));

      if (flow.done) {
        return "stopped";
      }

      try {
        const response = await fetch("/api/mobile/google-auth?poll=1", { cache: "no-store" });

        if (!response.ok) {
          continue;
        }

        const body = (await response.json()) as { status?: string };

        if (body.status === "signedIn" || body.status === "failed") {
          return body.status;
        }
      } catch {
        // A dropped request while the sheet is open is not an answer.
      }
    }

    return "stopped";
  }

  async function signInWithGoogle() {
    const flow = { done: false };
    let thrown: unknown = null;
    const sheet = nativeRequest<{ status: string }>("signInWithGoogle")
      .then(result => (result.status === "signedIn" ? "signedIn" : "stopped"))
      .catch(error => { thrown = error; return "stopped"; });

    try {
      const outcome = await Promise.race([sheet, collectGoogleSession(flow)]);

      if (outcome === "signedIn") {
        window.location.assign(props.next);
        return;
      }

      // "stopped" with nothing thrown is the sheet being closed by hand, which
      // needs no explaining.
      if (outcome === "failed" || thrown) {
        setNotice(signInFailure(thrown));
      }
    } finally {
      flow.done = true;
      setPendingTarget(null);
    }
  }

  function isPending(target: Exclude<PendingTarget, null>) {
    return pendingTarget === target;
  }

  return (
    <div className="memo-auth-stack">
      {props.providers.google ? (
        <form
          action="/auth/google"
          method="post"
          className="memo-auth-provider-form"
          onSubmit={event => {
            if (!isNativeIOS()) { setPendingTarget("google"); return; }
            event.preventDefault();
            if (pendingTarget) return;
            setPendingTarget("google"); setNotice("");
            void signInWithGoogle();
          }}
        >
          <input type="hidden" name="next" value={props.next} />
          <button
            type="submit"
            className="memo-auth-provider"
            disabled={pendingTarget !== null}
            aria-busy={isPending("google")}
          >
            {isPending("google") ? <Msym name="progress_activity" fill={false} weight={500} className="memo-spin" /> : <GoogleMark />}
            <span>{t(isPending("google") ? "auth.redirecting" : "auth.continueGoogle")}</span>
          </button>
        </form>
      ) : null}

      {props.providers.apple ? (
        <form
          action="/auth/apple"
          method="post"
          className="memo-auth-provider-form"
          onSubmit={event => {
            if (!isNativeIOS()) { setPendingTarget("apple"); return; }
            event.preventDefault();
            if (pendingTarget) return;
            setPendingTarget("apple"); setNotice("");
            void nativeRequest<{ status: string }>("signInWithApple").then(result => {
              if (result.status === "signedIn") window.location.assign(props.next);
            }).catch(error => setNotice(signInFailure(error))).finally(() => setPendingTarget(null));
          }}
        >
          <input type="hidden" name="next" value={props.next} />
          <button
            type="submit"
            className="memo-auth-provider"
            disabled={pendingTarget !== null}
            aria-busy={isPending("apple")}
          >
            {isPending("apple") ? <Msym name="progress_activity" fill={false} weight={500} className="memo-spin" /> : <AppleMark />}
            <span>{t(isPending("apple") ? "auth.redirecting" : "auth.continueApple")}</span>
          </button>
        </form>
      ) : null}

      {props.providers.email && (props.providers.google || props.providers.apple) ? (
        <div className="memo-auth-divider">{t("auth.or")}</div>
      ) : null}

      {props.providers.email ? (
        <button
          type="button"
          className="memo-auth-provider"
          disabled={pendingTarget !== null}
          aria-busy={isPending("email")}
          onClick={() => {
            setPendingTarget("email");
            router.push(emailHref);
          }}
        >
          {isPending("email") ? <Msym name="progress_activity" fill={false} weight={500} className="memo-spin" /> : <Msym name="mail" fill={false} weight={500} />}
          <span>{t(isPending("email") ? "auth.opening" : "auth.continueEmail")}</span>
        </button>
      ) : null}
      {notice ? <p className="memo-inline-error" role="status">{notice}</p> : null}
    </div>
  );
}
