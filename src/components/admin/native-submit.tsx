"use client";

import { Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";

/**
 * A submit button for a form that posts to a route rather than a server action.
 *
 * `useFormStatus` only sees server actions, so sign-out — a plain POST to
 * `/auth/logout` that comes back as a full page load — had no way to report
 * anything, and sat there looking unpressed for the whole round trip.
 *
 * The button is deliberately not `disabled` while pending: disabling a submit
 * button from inside its own submit handler can cancel the very submission it
 * is reporting on, in the browsers that read the disabled state after the
 * handler returns. The stylesheet takes the pointer events away instead, which
 * stops a second press without touching the first.
 */
export function NativeSubmitButton({
  action,
  method = "post",
  className,
  children,
  pendingLabel,
  formClassName,
  fields,
  confirm,
  ...rest
}: {
  action: string;
  method?: string;
  className: string;
  children: ReactNode;
  pendingLabel: string;
  formClassName?: string;
  /** Hidden inputs to post alongside the press, for row-level actions that name a record. */
  fields?: Record<string, string>;
  /** Native confirm before submitting, for presses that should not happen by accident. */
  confirm?: string;
  "data-variant"?: string;
  "data-size"?: string;
}) {
  const [pending, setPending] = useState(false);

  return (
    <form
      action={action}
      method={method}
      className={formClassName}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) {
          event.preventDefault();
          return;
        }

        setPending(true);
      }}
    >
      {fields
        ? Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}
      <button
        type="submit"
        className={className}
        data-pending={pending || undefined}
        {...rest}
      >
        {pending && (
          <Loader2 size={12} className="admin-spin" aria-hidden="true" />
        )}
        {pending ? pendingLabel : children}
      </button>
    </form>
  );
}
