"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type {
  TestPersona,
  TestPersonaBilling,
  TestPersonaOnboarding,
} from "@/lib/test-persona";

/**
 * The test-persona panel, in Settings, for one account.
 *
 * Written in English and kept out of the message catalogues on purpose. This is
 * a tool for the person whose email is in `super-admin.ts` and it is the only
 * thing in the app nobody else can ever see; putting nine labels into five
 * languages would be five translations nobody reads.
 *
 * Rendering is not what protects it — `settings/page.tsx` decides whether to
 * mount this, and the endpoint behind it checks again and 404s.
 */

const BILLING: Array<{ value: TestPersonaBilling; label: string; detail: string }> = [
  { value: "real", label: "Real", detail: "Whatever this account actually has" },
  { value: "free", label: "Free note", detail: "Never subscribed, first note still unused" },
  { value: "spent", label: "Paywalled", detail: "Never subscribed, free note used up" },
  { value: "trialing", label: "Trialing", detail: "On the 3-day trial" },
  { value: "paid", label: "Subscribed", detail: "Yearly, active" },
];

const ONBOARDING: Array<{ value: TestPersonaOnboarding; label: string; detail: string }> = [
  { value: "real", label: "Real", detail: "Whatever this account actually has" },
  { value: "pending", label: "Not done", detail: "Sends you back into the survey" },
  { value: "done", label: "Done", detail: "Straight into the app" },
];

export function SettingsTestPersona({ persona }: { persona: TestPersona }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(persona);
  const [error, setError] = useState<string | null>(null);

  const isReal = current.billing === "real" && current.onboarding === "real";

  async function apply(next: TestPersona) {
    const previous = current;
    setCurrent(next);
    setError(null);

    try {
      const response = await fetch("/api/test-persona", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });

      if (!response.ok) {
        throw new Error(`The persona could not be set (${response.status}).`);
      }

      // Entitlement is resolved on the server, so the whole tree has to be
      // asked again rather than nudged in place.
      startTransition(() => router.refresh());
    } catch (cause) {
      setCurrent(previous);
      setError(cause instanceof Error ? cause.message : "The persona could not be set.");
    }
  }

  return (
    <section className="memo-persona" aria-label="Test persona">
      <header className="memo-persona-head">
        <span className="memo-persona-title">Test persona</span>
        <span className={`memo-persona-badge ${isReal ? "" : "on"}`.trim()}>
          {isReal ? "Off" : "On"}
        </span>
      </header>

      <p className="memo-persona-lead">
        Shows you the app as another kind of account would see it. Nothing is written — no
        profile is edited, no subscription is created, and Stripe is never told anything.
        Only this account can see or use it.
      </p>

      <div className="memo-persona-group">
        <span className="memo-persona-label">Billing</span>
        <div className="memo-persona-options">
          {BILLING.map((option) => (
            <button
              key={option.value}
              type="button"
              className={current.billing === option.value ? "active" : ""}
              aria-pressed={current.billing === option.value}
              disabled={pending}
              onClick={() => void apply({ ...current, billing: option.value })}
            >
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="memo-persona-group">
        <span className="memo-persona-label">Onboarding</span>
        <div className="memo-persona-options">
          {ONBOARDING.map((option) => (
            <button
              key={option.value}
              type="button"
              className={current.onboarding === option.value ? "active" : ""}
              aria-pressed={current.onboarding === option.value}
              disabled={pending}
              onClick={() => void apply({ ...current, onboarding: option.value })}
            >
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
      </div>

      {/*
        Finishing the survey under a "Not done" persona writes a real
        `onboarding_completed_at` and then this sends you back into it anyway,
        which looks like the save failing. Said here rather than discovered.
      */}
      {current.onboarding === "pending" ? (
        <p className="memo-persona-note">
          The survey will keep reappearing until you set this back — completing it saves for
          real, but the persona still says you have not.
        </p>
      ) : null}

      {error ? <p className="memo-persona-error">{error}</p> : null}

      <button
        type="button"
        className="memo-persona-reset"
        disabled={pending || isReal}
        onClick={() => void apply({ billing: "real", onboarding: "real" })}
      >
        Back to my real account
      </button>
    </section>
  );
}
