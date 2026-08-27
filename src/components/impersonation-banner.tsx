"use client";

import { Loader2, X } from "lucide-react";
import { useState } from "react";

/**
 * Marks a browser that is inside someone else's account, and gets the admin back out.
 *
 * Deliberately a small fixed overlay rather than a bar across the top: the whole point of
 * impersonation is seeing the learner's app exactly as they see it, and a banner in the document
 * flow would push every page down and change the thing being inspected. It collapses to a dot so
 * a screenshot can be pixel-identical to what the user sees, and the dot still says, at a glance,
 * that this is not your own account.
 */
export function ImpersonationBanner({ targetEmail }: { targetEmail: string | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const [pending, setPending] = useState(false);
  const label = targetEmail ?? "another account";

  if (collapsed) {
    return (
      <button
        type="button"
        className="impersonation-dot"
        onClick={() => setCollapsed(false)}
        title={`Viewing as ${label} — click to expand`}
        aria-label={`Viewing as ${label}. Expand impersonation controls.`}
      />
    );
  }

  return (
    <div className="impersonation-pill" role="status">
      <span className="impersonation-dot-inline" aria-hidden="true" />
      <span className="impersonation-text">
        Viewing as <strong>{label}</strong>
      </span>
      <form
        action="/api/admin/impersonate/stop"
        method="post"
        onSubmit={() => setPending(true)}
      >
        <button type="submit" className="impersonation-stop" data-pending={pending || undefined}>
          {pending ? <Loader2 size={12} className="impersonation-spin" aria-hidden="true" /> : null}
          {pending ? "Leaving…" : "Stop"}
        </button>
      </form>
      <button
        type="button"
        className="impersonation-collapse"
        onClick={() => setCollapsed(true)}
        title="Collapse"
        aria-label="Collapse impersonation controls"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
