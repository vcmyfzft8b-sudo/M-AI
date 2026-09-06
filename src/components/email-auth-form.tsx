"use client";

import { useRef, useState, type ReactNode } from "react";

import { Msym } from "@/components/msym";

type EmailAuthFormProps = {
  buttonClassName: string;
  defaultEmail?: string;
  formClassName?: string;
  helperText?: string;
  /** Drawn inside the field, ahead of the input. */
  icon?: ReactNode;
  inputClassName?: string;
  inputWrapperClassName?: string;
  mode: "login" | "signup";
  next: string;
  placeholder: string;
  pendingLabel: string;
  readOnlyWhileSubmitting?: boolean;
  submitLabel: string;
};

export function EmailAuthForm(props: EmailAuthFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const bypassSubmitRef = useRef(false);

  return (
    <form
      action="/auth/email"
      method="post"
      className={props.formClassName}
      onSubmit={(event) => {
        if (bypassSubmitRef.current) {
          bypassSubmitRef.current = false;
          return;
        }

        if (isSubmitting) {
          event.preventDefault();
          return;
        }

        const form = event.currentTarget;

        if (!form.reportValidity()) {
          event.preventDefault();
          return;
        }

        event.preventDefault();
        setIsSubmitting(true);

        requestAnimationFrame(() => {
          bypassSubmitRef.current = true;
          form.requestSubmit();
        });
      }}
    >
      <input type="hidden" name="mode" value={props.mode} />
      <input type="hidden" name="next" value={props.next} />

      <label className={props.inputWrapperClassName}>
        {props.icon}
        <input
          type="email"
          name="email"
          required
          defaultValue={props.defaultEmail}
          placeholder={props.placeholder}
          autoComplete="email"
          className={props.inputClassName}
          aria-disabled={isSubmitting}
          readOnly={props.readOnlyWhileSubmitting && isSubmitting}
        />
      </label>

      <button
        type="submit"
        className={props.buttonClassName}
        disabled={isSubmitting}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? <Msym name="progress_activity" fill={false} weight={500} className="memo-spin" /> : null}
        <span>{isSubmitting ? props.pendingLabel : props.submitLabel}</span>
      </button>

      {props.helperText ? <p className="memo-auth-helper">{props.helperText}</p> : null}
    </form>
  );
}
