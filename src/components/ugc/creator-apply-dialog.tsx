"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { LOCALE_INTL_TAG } from "@/lib/i18n/locales";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { getPublicEnv } from "@/lib/public-env";
import {
  APPLICATION_STEPS,
  APPLICATION_VIDEO_BUCKET,
  APPLICATION_VIDEO_MAX_BYTES,
  APPLICATION_VIDEO_TYPES,
  invalidFields,
  normalizeHandle,
  type ApplicationField,
} from "@/lib/ugc/creator-application";
import { MARKET_COUNTRIES, OTHER_COUNTRY, type CreatorMarket } from "@/lib/ugc/creator-program";

/**
 * The application form: a four-step sheet (format, details, video, confirm) that posts
 * to `/api/ugc/applications`. Each step is checked with the same schema the server uses
 * before the next one opens, so a mistake is shown on the step it was made.
 *
 * The sample video goes straight from the phone to storage on a signed URL (see
 * `/api/ugc/applications/video`); the application only carries its path.
 */

type TextField = Exclude<ApplicationField, "consent" | "sampleVideo" | "sampleVideoPath">;
type Values = Record<TextField, string>;

const EMPTY: Values = {
  fullName: "",
  email: "",
  country: "",
  age: "",
  phone: "",
  studies: "",
  tiktok: "",
  instagram: "",
  sampleVideoUrl: "",
  message: "",
};

const ERROR_KEYS: Record<ApplicationField, MessageKey> = {
  fullName: "ugcApply.error.fullName",
  email: "ugcApply.error.email",
  country: "ugcApply.error.country",
  age: "ugcApply.error.age",
  phone: "ugcApply.error.phone",
  studies: "ugcApply.error.studies",
  tiktok: "ugcApply.error.handle",
  instagram: "ugcApply.error.handle",
  sampleVideo: "ugcApply.error.sampleVideo",
  sampleVideoPath: "ugcApply.error.videoUpload",
  sampleVideoUrl: "ugcApply.error.sampleVideoUrl",
  message: "ugcApply.error.message",
  consent: "ugcApply.error.consent",
};

const STEP_LABELS: MessageKey[] = [
  "ugcApply.formStep.brief",
  "ugcApply.formStep.details",
  "ugcApply.formStep.video",
  "ugcApply.formStep.confirm",
];

const BRIEF: MessageKey[] = [
  "ugcApply.briefPoint1",
  "ugcApply.briefPoint2",
  "ugcApply.briefPoint3",
  "ugcApply.briefPoint4",
  "ugcApply.briefPoint5",
];

type Outcome = { kind: "received" | "duplicate"; email: string };

type Upload =
  | { state: "idle" }
  | { state: "uploading"; name: string; percent: number }
  | { state: "done"; name: string; path: string }
  | { state: "failed"; error: MessageKey };

/**
 * PUTs the file onto the signed URL by hand rather than through supabase-js: a phone
 * video takes a while, and only an XHR reports upload progress.
 */
function putToSignedUrl(
  path: string,
  token: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
) {
  const { supabaseUrl } = getPublicEnv();
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`/storage/v1/object/upload/sign/${APPLICATION_VIDEO_BUCKET}/${encodedPath}`, supabaseUrl);
  url.searchParams.set("token", token);

  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open("PUT", url.toString());
    request.setRequestHeader("content-type", contentType);
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.onload = () => (request.status < 300 ? resolve() : reject(new Error(`Upload failed: ${request.status}`)));
    request.onerror = () => reject(new Error("Upload failed"));
    request.send(file);
  });
}

export function CreatorApplyDialog({
  market,
  referrer,
  onClosed,
}: {
  /** The campaign this page is for: the form lists only its countries. */
  market: CreatorMarket;
  referrer: string | null;
  onClosed: () => void;
}) {
  const countries = MARKET_COUNTRIES[market];
  const { t, locale } = useTranslations();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values>({ ...EMPTY, country: countries.length === 1 ? countries[0] : "" });
  const [upload, setUpload] = useState<Upload>({ state: "idle" });
  const [consent, setConsent] = useState(false);
  // Hidden from people; a bot that fills every field fills this one too.
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<ApplicationField[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uploading = upload.state === "uploading";
  const sheet = useSheet(onClosed, { scrollable: true, locked: submitting || uploading });
  const { dismiss } = sheet;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dismiss();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  const countryNames = useMemo(() => {
    const names = new Intl.DisplayNames([LOCALE_INTL_TAG[locale], "en"], { type: "region" });

    return Object.fromEntries(countries.map((code) => [code, names.of(code) ?? code])) as Record<string, string>;
  }, [locale, countries]);

  const payload = {
    ...values,
    sampleVideoPath: upload.state === "done" ? upload.path : "",
    consent,
  };

  const clearErrors = useCallback((...fields: ApplicationField[]) => {
    setErrors((current) => current.filter((entry) => !fields.includes(entry)));
  }, []);

  const set = useCallback(
    (field: TextField, value: string) => {
      setValues((current) => ({ ...current, [field]: value }));
      clearErrors(field, ...(field === "sampleVideoUrl" ? (["sampleVideo"] as const) : []));
    },
    [clearErrors],
  );

  async function chooseVideo(file: File) {
    // Some Android pickers hand over a file with no type; the extension still says what it is.
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const contentType =
      file.type ||
      (Object.entries(APPLICATION_VIDEO_TYPES).find(([, ext]) => ext === extension)?.[0] ?? "");

    if (!APPLICATION_VIDEO_TYPES[contentType]) {
      setUpload({ state: "failed", error: "ugcApply.error.videoType" });
      return;
    }

    if (file.size > APPLICATION_VIDEO_MAX_BYTES) {
      setUpload({ state: "failed", error: "ugcApply.error.videoSize" });
      return;
    }

    setUpload({ state: "uploading", name: file.name, percent: 0 });
    clearErrors("sampleVideo", "sampleVideoPath");

    try {
      const response = await fetch("/api/ugc/applications/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType, size: file.size }),
      });
      const target = (await response.json().catch(() => ({}))) as { path?: string; token?: string; error?: string };

      if (!response.ok || !target.path || !target.token) {
        setUpload({
          state: "failed",
          error:
            response.status === 429
              ? "ugcApply.error.rateLimited"
              : target.error === "size"
                ? "ugcApply.error.videoSize"
                : target.error === "type"
                  ? "ugcApply.error.videoType"
                  : "ugcApply.error.videoUpload",
        });
        return;
      }

      const { path, token } = target;

      await putToSignedUrl(path, token, file, contentType, (percent) =>
        setUpload((current) => (current.state === "uploading" ? { ...current, percent } : current)),
      );
      setUpload({ state: "done", name: file.name, path });
    } catch {
      setUpload({ state: "failed", error: "ugcApply.error.videoUpload" });
    }
  }

  function next() {
    const failed = invalidFields(payload, APPLICATION_STEPS[step]);

    setErrors(failed);

    if (failed.length === 0 && !uploading) {
      setStep((current) => current + 1);
    }
  }

  function showFirstError(failed: ApplicationField[]) {
    setErrors(failed);
    setStep(Math.max(1, APPLICATION_STEPS.findIndex((fields) => fields.some((field) => failed.includes(field)))));
  }

  async function submit() {
    const failed = invalidFields(payload);

    if (failed.length > 0) {
      showFirstError(failed);
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch("/api/ugc/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, locale, ref: referrer, website }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        status?: "received" | "duplicate";
        fields?: ApplicationField[];
      };

      if (response.status === 429) {
        setFormError("ugcApply.error.rateLimited");
      } else if (response.status === 400 && body.fields?.length) {
        if (body.fields.includes("sampleVideoPath")) {
          setUpload({ state: "failed", error: "ugcApply.error.videoUpload" });
        }

        showFirstError(body.fields);
      } else if (response.ok && body.status) {
        setOutcome({ kind: body.status, email: values.email.trim().toLowerCase() });
      } else {
        setFormError("ugcApply.error.network");
      }
    } catch {
      setFormError("ugcApply.error.network");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldProps = (name: TextField) => ({
    id: `cp-${name}`,
    name,
    value: values[name],
    "aria-invalid": errors.includes(name) || undefined,
    "aria-describedby": errors.includes(name) ? `cp-${name}-error` : undefined,
    onChange: (event: { target: { value: string } }) => set(name, event.target.value),
  });

  const field = (
    name: ApplicationField,
    label: ReactNode,
    control: ReactNode,
    options?: { optional?: boolean; hint?: string },
  ) => (
    <div className="memo-cp-form-field" data-invalid={errors.includes(name) || undefined}>
      <label className="memo-cp-form-label" htmlFor={`cp-${name}`}>
        <span>{label}</span>
        {options?.optional ? <span className="memo-cp-optional">{t("ugcApply.optional")}</span> : null}
      </label>
      {control}
      {errors.includes(name) ? (
        <p className="memo-cp-form-error" id={`cp-${name}-error`}>
          {t(ERROR_KEYS[name])}
        </p>
      ) : options?.hint ? (
        <p className="memo-cp-form-hint">{options.hint}</p>
      ) : null}
    </div>
  );

  const summary: Array<[MessageKey, string]> = [
    ["ugcApply.field.fullName", values.fullName.trim()],
    ["ugcApply.field.email", values.email.trim()],
    [
      "ugcApply.field.country",
      values.country === OTHER_COUNTRY ? t("ugcApply.field.countryOther") : (countryNames[values.country] ?? ""),
    ],
    ["ugcApply.field.age", values.age.trim()],
    ["ugcApply.field.phone", values.phone.trim()],
    ["ugcApply.field.studies", values.studies.trim()],
    ["ugcApply.field.tiktok", values.tiktok.trim() ? `@${normalizeHandle(values.tiktok)}` : ""],
    ["ugcApply.field.instagram", values.instagram.trim() ? `@${normalizeHandle(values.instagram)}` : ""],
    ["ugcApply.videoTitle", upload.state === "done" ? upload.name : ""],
    ["ugcApply.field.sampleVideo", values.sampleVideoUrl.trim()],
  ];

  const lastStep = STEP_LABELS.length - 1;

  return (
    <MemoPortal>
      <button
        type="button"
        aria-label={t("common.close")}
        className={sheetClass("memo-scrim", sheet.closing)}
        onClick={() => sheet.dismiss()}
      />
      <div
        className={sheetClass("memo-confirm memo-confirm-fixed memo-cp-apply-sheet", sheet.closing)}
        role="dialog"
        aria-modal="true"
        aria-label={t("ugcApply.formTitle")}
        {...sheet.dragProps}
      >
        <div className="memo-grab" data-drag-handle />
        <div className="memo-cp-apply-head" data-drag-zone>
          <h2>
            {outcome
              ? t(outcome.kind === "received" ? "ugcApply.successTitle" : "ugcApply.duplicateTitle")
              : t("ugcApply.formTitle")}
          </h2>
          <button
            type="button"
            className="memo-icon-button memo-cp-apply-close"
            aria-label={t("common.close")}
            onClick={() => sheet.dismiss()}
          >
            <Msym name="close" size="1.3rem" />
          </button>
        </div>

        {outcome ? (
          <div className="memo-cp-apply-done">
            <span className="memo-cp-done-tile">
              <Msym name="check" size="1.8rem" />
            </span>
            <p>
              {t(outcome.kind === "received" ? "ugcApply.successBody" : "ugcApply.duplicateBody", {
                email: outcome.email,
              })}
            </p>
            <button type="button" className="memo-button-coral" onClick={() => sheet.dismiss(undefined, { force: true })}>
              {t("common.close")}
            </button>
          </div>
        ) : (
          <form
            className="memo-cp-apply-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();

              if (step === lastStep) {
                void submit();
              } else {
                next();
              }
            }}
          >
            <ol className="memo-cp-apply-steps">
              {STEP_LABELS.map((label, index) => (
                <li key={label} data-state={index < step ? "done" : index === step ? "current" : "todo"}>
                  <span className="memo-cp-apply-step-dot">
                    {index < step ? <Msym name="check" size="0.95rem" /> : <span>{index + 1}</span>}
                  </span>
                  <span className="memo-cp-apply-step-label">{t(label)}</span>
                </li>
              ))}
            </ol>

            {step === 0 ? (
              <div className="memo-cp-brief">
                <h3>{t("ugcApply.briefTitle")}</h3>
                <ul>
                  {BRIEF.map((key) => (
                    <li key={key}>
                      <Msym name="check_circle" size="1.2rem" />
                      <span>{t(key)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="memo-cp-form-fields">
                {field(
                  "fullName",
                  t("ugcApply.field.fullName"),
                  <input className="memo-field" autoComplete="name" {...fieldProps("fullName")} />,
                )}
                {field(
                  "email",
                  t("ugcApply.field.email"),
                  <input className="memo-field" type="email" inputMode="email" autoComplete="email" {...fieldProps("email")} />,
                )}
                <div className="memo-cp-form-row">
                  {field(
                    "country",
                    t("ugcApply.field.country"),
                    <select className="memo-field memo-cp-select" {...fieldProps("country")}>
                      <option value="" disabled>
                        {t("ugcApply.field.countryPick")}
                      </option>
                      {countries.map((code) => (
                        <option key={code} value={code}>
                          {countryNames[code]}
                        </option>
                      ))}
                      <option value={OTHER_COUNTRY}>{t("ugcApply.field.countryOther")}</option>
                    </select>,
                  )}
                  {field(
                    "age",
                    t("ugcApply.field.age"),
                    <input className="memo-field" type="number" inputMode="numeric" min={13} max={99} {...fieldProps("age")} />,
                  )}
                </div>
                {field(
                  "phone",
                  t("ugcApply.field.phone"),
                  <input className="memo-field" type="tel" autoComplete="tel" {...fieldProps("phone")} />,
                  { optional: true },
                )}
                {field(
                  "studies",
                  t("ugcApply.field.studies"),
                  <input className="memo-field" placeholder={t("ugcApply.field.studiesPlaceholder")} {...fieldProps("studies")} />,
                  { optional: true },
                )}
                <div className="memo-cp-form-row">
                  {field(
                    "tiktok",
                    t("ugcApply.field.tiktok"),
                    <input
                      className="memo-field"
                      autoCapitalize="none"
                      autoCorrect="off"
                      placeholder={t("ugcApply.field.handlePlaceholder")}
                      {...fieldProps("tiktok")}
                    />,
                    { optional: true },
                  )}
                  {field(
                    "instagram",
                    t("ugcApply.field.instagram"),
                    <input
                      className="memo-field"
                      autoCapitalize="none"
                      autoCorrect="off"
                      placeholder={t("ugcApply.field.handlePlaceholder")}
                      {...fieldProps("instagram")}
                    />,
                    { optional: true },
                  )}
                </div>
                <p className="memo-cp-form-hint">{t("ugcApply.field.profilesHint")}</p>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="memo-cp-form-fields">
                <div className="memo-cp-video-intro">
                  <h3>{t("ugcApply.videoTitle")}</h3>
                  <p>{t("ugcApply.videoLead")}</p>
                </div>

                <div
                  className="memo-cp-upload"
                  data-state={upload.state}
                  data-invalid={errors.includes("sampleVideo") || errors.includes("sampleVideoPath") || undefined}
                >
                  <input
                    ref={fileInputRef}
                    className="memo-cp-file"
                    type="file"
                    accept={Object.keys(APPLICATION_VIDEO_TYPES).join(",")}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";

                      if (file) {
                        void chooseVideo(file);
                      }
                    }}
                  />
                  {upload.state === "uploading" ? (
                    <div className="memo-cp-upload-row">
                      <Msym name="progress_activity" size="1.35rem" className="memo-spin" />
                      <span className="memo-cp-upload-name">{upload.name}</span>
                      <span className="memo-cp-upload-meta">{t("ugcApply.videoUploading", { percent: upload.percent })}</span>
                      <span className="memo-cp-upload-bar" aria-hidden="true">
                        <span style={{ width: `${upload.percent}%` }} />
                      </span>
                    </div>
                  ) : upload.state === "done" ? (
                    <div className="memo-cp-upload-row">
                      <Msym name="check_circle" size="1.35rem" />
                      <span className="memo-cp-upload-name">{upload.name}</span>
                      <span className="memo-cp-upload-meta">{t("ugcApply.videoUploaded")}</span>
                      <button type="button" className="memo-chip" onClick={() => setUpload({ state: "idle" })}>
                        {t("ugcApply.videoRemove")}
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="memo-cp-upload-pick" onClick={() => fileInputRef.current?.click()}>
                      <Msym name="videocam" size="1.6rem" />
                      <span>{t("ugcApply.videoChoose")}</span>
                    </button>
                  )}
                  {upload.state === "failed" ? <p className="memo-cp-form-error">{t(upload.error)}</p> : null}
                  {errors.includes("sampleVideo") ? (
                    <p className="memo-cp-form-error">{t("ugcApply.error.sampleVideo")}</p>
                  ) : null}
                </div>

                <p className="memo-cp-or">
                  <span>{t("ugcApply.videoOr")}</span>
                </p>

                {field(
                  "sampleVideoUrl",
                  t("ugcApply.field.sampleVideo"),
                  <input
                    className="memo-field"
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    placeholder="https://"
                    {...fieldProps("sampleVideoUrl")}
                  />,
                  { hint: t("ugcApply.field.sampleVideoHint") },
                )}
                {field(
                  "message",
                  t("ugcApply.field.message"),
                  <textarea className="memo-textarea memo-cp-textarea" rows={3} maxLength={1000} {...fieldProps("message")} />,
                  { optional: true },
                )}
              </div>
            ) : null}

            {step === lastStep ? (
              <div className="memo-cp-form-fields">
                <h3 className="memo-cp-confirm-title">{t("ugcApply.confirmTitle")}</h3>
                <dl className="memo-cp-summary">
                  {summary
                    .filter(([, value]) => value)
                    .map(([label, value]) => (
                      <div key={label}>
                        <dt>{t(label)}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                </dl>
                <div className="memo-cp-consent" data-invalid={errors.includes("consent") || undefined}>
                  <label>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => {
                        setConsent(event.target.checked);
                        clearErrors("consent");
                      }}
                    />
                    <span>
                      {t("ugcApply.field.consent")}{" "}
                      <a href="/legal/privacy-policy" target="_blank" rel="noreferrer">
                        {t("landing.footer.privacy")}
                      </a>
                    </span>
                  </label>
                  {errors.includes("consent") ? <p className="memo-cp-form-error">{t("ugcApply.error.consent")}</p> : null}
                </div>
              </div>
            ) : null}

            <input
              className="memo-cp-honeypot"
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />

            {formError ? (
              <p className="memo-cp-form-error memo-cp-form-alert" role="alert">
                {t(formError)}
              </p>
            ) : null}

            <div className="memo-cp-apply-actions">
              {step > 0 ? (
                <button
                  type="button"
                  className="memo-confirm-cancel"
                  disabled={submitting}
                  onClick={() => {
                    setErrors([]);
                    setStep((current) => current - 1);
                  }}
                >
                  {t("common.back")}
                </button>
              ) : null}
              <button type="submit" className="memo-button-coral" disabled={submitting || uploading}>
                {step === 0
                  ? t("ugcApply.briefContinue")
                  : step === lastStep
                    ? submitting
                      ? t("ugcApply.submitting")
                      : t("ugcApply.submit")
                    : t("common.continue")}
              </button>
            </div>
          </form>
        )}
      </div>
    </MemoPortal>
  );
}
