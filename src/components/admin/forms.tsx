"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";

import { type ActionState, IDLE_STATE } from "@/lib/admin/action-state";

/** Form plumbing shared by every admin mutation. */

export function SubmitButton({
  children,
  variant = "primary",
  size,
  pendingLabel,
  confirm,
  title,
}: {
  children: ReactNode;
  variant?: "primary" | "danger" | "ghost" | "default";
  size?: "sm";
  pendingLabel?: string;
  /** Shown in a native confirm dialog before the form submits. */
  confirm?: string;
  title?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="admin-button"
      data-variant={variant === "default" ? undefined : variant}
      data-size={size}
      disabled={pending}
      title={title}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) {
          event.preventDefault();
        }
      }}
    >
      {pending && <Loader2 size={13} className="admin-spin" aria-hidden="true" />}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * The form's own status line.
 *
 * Rendered from inside the form so `useFormStatus` can see the submission:
 * "Saving…" appears the moment the button is pressed rather than after the
 * round trip, and the action's answer replaces it when it lands.
 */
function StatusLine({ state }: { state: ActionState }) {
  const { pending } = useFormStatus();

  if (pending) {
    return (
      <div className="admin-alert" data-tone="info" role="status">
        <Loader2 size={13} className="admin-spin" aria-hidden="true" /> Saving…
      </div>
    );
  }

  if (state.status === "idle") {
    return null;
  }

  return (
    <div
      className="admin-alert"
      data-tone={state.status === "error" ? "error" : "success"}
      role="status"
    >
      {state.message}
    </div>
  );
}

/**
 * Wraps a server action with its own result message.
 *
 * `resetOnSuccess` clears the fields after a successful submit, which is what
 * the "add" forms want and what the "edit" forms must not do.
 *
 * The page is refreshed from here after a success, in a transition, rather
 * than by the action revalidating it. That way the answer arrives as soon as
 * the write is done and the current screen stays usable while the fresh data
 * streams in behind it; an action that left work running in the background
 * asks for a second refresh once that work has had time to finish.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  onSuccess,
  hideMessage,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
  hideMessage?: boolean;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, IDLE_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const lastHandled = useRef<ActionState>(IDLE_STATE);

  useEffect(() => {
    if (state === lastHandled.current || state.status !== "success") {
      return;
    }

    lastHandled.current = state;

    if (resetOnSuccess) {
      formRef.current?.reset();
    }

    onSuccess?.();

    startTransition(() => {
      router.refresh();
    });

    if (!state.refreshAfterMs) {
      return;
    }

    const timer = window.setTimeout(() => {
      startTransition(() => {
        router.refresh();
      });
    }, state.refreshAfterMs);

    return () => window.clearTimeout(timer);
  }, [state, resetOnSuccess, onSuccess, router]);

  return (
    <form ref={formRef} action={formAction} className={className}>
      {!hideMessage && <StatusLine state={state} />}
      {children}
    </form>
  );
}

/** A one-button form, for row-level actions like "mark as Memo AI". */
export function InlineAction({
  action,
  fields,
  children,
  variant = "ghost",
  confirm,
  title,
}: {
  action: Action;
  fields: Record<string, string>;
  children: ReactNode;
  variant?: "primary" | "danger" | "ghost" | "default";
  confirm?: string;
  title?: string;
}) {
  return (
    <ActionForm action={action} className="admin-inline-form" hideMessage>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={variant} size="sm" confirm={confirm} title={title}>
        {children}
      </SubmitButton>
    </ActionForm>
  );
}

/** A panel that stays closed until the admin asks for it. */
export function Disclosure({
  label,
  children,
  openLabel,
}: {
  label: string;
  openLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="admin-disclosure">
      <button
        type="button"
        className="admin-button"
        data-variant={open ? "ghost" : "primary"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <>
            <X size={14} aria-hidden="true" /> {openLabel ?? "Cancel"}
          </>
        ) : (
          <>
            <Plus size={14} aria-hidden="true" /> {label}
          </>
        )}
      </button>

      {open && <div className="admin-disclosure-panel">{children}</div>}
    </div>
  );
}
