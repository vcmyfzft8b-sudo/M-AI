"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import { creatorFont } from "@/components/ugc/creator-font";
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
  type ApplicationField,
} from "@/lib/ugc/creator-application";
import { MARKET_COUNTRIES, OTHER_COUNTRY, type CreatorMarket } from "@/lib/ugc/creator-program";

import type { ShowcaseVideo } from "./creator-program";

/**
 * The application, step for step as on the campaign pages creators already know: the
 * format with examples, your details, the demo video (instructions, then an upload or a
 * link, one or the other) and three confirmations before it sends. It posts to
 * `/api/ugc/applications`; each step is checked with the server's own schema before the
 * next one opens.
 *
 * The demo video goes straight from the phone to storage on a signed URL (see
 * `/api/ugc/applications/video`); the application only carries its path.
 */

type TextField = "firstName" | "lastName" | "email" | "phone" | "country" | "age" | "referralCode" | "sampleVideoUrl";
type CheckField = "followedInstructions" | "titleVisible" | "notRandom" | "consent";
type Values = Record<TextField, string>;

const EMPTY: Values = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  country: "",
  age: "",
  referralCode: "",
  sampleVideoUrl: "",
};

const NO_CHECKS: Record<CheckField, boolean> = {
  followedInstructions: false,
  titleVisible: false,
  notRandom: false,
  consent: false,
};

const ERROR_KEYS: Partial<Record<ApplicationField, MessageKey>> = {
  firstName: "ugcApply.error.firstName",
  lastName: "ugcApply.error.lastName",
  email: "ugcApply.error.email",
  phone: "ugcApply.error.phone",
  country: "ugcApply.error.country",
  age: "ugcApply.error.age",
  referralCode: "ugcApply.error.referral",
  sampleVideo: "ugcApply.error.sampleVideo",
  sampleVideoPath: "ugcApply.error.videoUpload",
  sampleVideoUrl: "ugcApply.error.sampleVideoUrl",
};

const STEP_LABELS: MessageKey[] = [
  "ugcApply.formStep.brief",
  "ugcApply.formStep.details",
  "ugcApply.formStep.video",
  "ugcApply.formStep.confirm",
];

const CONFIRMATIONS: Array<{ field: Exclude<CheckField, "consent">; label: MessageKey }> = [
  { field: "followedInstructions", label: "ugcApply.confirm1" },
  { field: "titleVisible", label: "ugcApply.confirm2" },
  { field: "notRandom", label: "ugcApply.confirm3" },
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
  videos,
  referrer,
  onClosed,
}: {
  /** The campaign this page is for: the form lists only its countries. */
  market: CreatorMarket;
  videos: ShowcaseVideo[];
  referrer: string | null;
  onClosed: () => void;
}) {
  const { t, locale } = useTranslations();
  const countries = MARKET_COUNTRIES[market];
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values>({ ...EMPTY, country: countries.length === 1 ? countries[0] : "" });
  const [checks, setChecks] = useState(NO_CHECKS);
  const [upload, setUpload] = useState<Upload>({ state: "idle" });
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
    ...checks,
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
      file.type || (Object.entries(APPLICATION_VIDEO_TYPES).find(([, ext]) => ext === extension)?.[0] ?? "");

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

  const inputProps = (name: TextField) => ({
    id: `cp-${name}`,
    name,
    className: "memo-cp-input",
    value: values[name],
    "aria-invalid": errors.includes(name) || undefined,
    onChange: (event: { target: { value: string } }) => set(name, event.target.value),
  });

  const field = (name: TextField, label: string, control: ReactNode, hint?: string) => {
    const error = ERROR_KEYS[name];

    return (
      <div className="memo-cp-form-field" data-invalid={errors.includes(name) || undefined}>
        <label className="memo-cp-form-label" htmlFor={`cp-${name}`}>
          {label}
        </label>
        {control}
        {errors.includes(name) && error ? (
          <p className="memo-cp-form-error">{t(error)}</p>
        ) : hint ? (
          <p className="memo-cp-form-hint">{hint}</p>
        ) : null}
      </div>
    );
  };

  const confirmMissing = CONFIRMATIONS.some((item) => errors.includes(item.field));
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
        className={`${sheetClass("memo-confirm-fixed memo-cp-sheet", sheet.closing)} ${creatorFont.className}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("ugcApply.formatTitle")}
        {...sheet.dragProps}
      >
        <div className="memo-grab" data-drag-handle />
        <div className="memo-cp-sheet-head" data-drag-zone>
          <h2>
            {outcome
              ? t(outcome.kind === "received" ? "ugcApply.successTitle" : "ugcApply.duplicateTitle")
              : t("ugcApply.formatTitle")}
          </h2>
        </div>

        {outcome ? (
          <div className="memo-cp-sheet-done">
            <span className="memo-cp-done-tile">
              <Msym name="check" size="1.8rem" />
            </span>
            <p>
              {t(outcome.kind === "received" ? "ugcApply.successBody" : "ugcApply.duplicateBody", { email: outcome.email })}
            </p>
            {outcome.kind === "received" ? <p className="memo-cp-strong">{t("ugcApply.successThanks")}</p> : null}
            <button
              type="button"
              className="memo-cp-cta memo-cp-cta-block"
              onClick={() => sheet.dismiss(undefined, { force: true })}
            >
              <span>{t("ugcApply.done")}</span>
            </button>
          </div>
        ) : (
          <form
            className="memo-cp-sheet-form"
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
            <ol className="memo-cp-sheet-steps">
              {STEP_LABELS.map((label, index) => (
                <li
                  key={label}
                  aria-current={index === step ? "step" : undefined}
                  data-state={index < step ? "done" : index === step ? "current" : "todo"}
                >
                  <span className="memo-cp-sheet-step-dot">
                    {index < step ? <Msym name="check" size="0.9rem" /> : <span>{index + 1}</span>}
                  </span>
                  <span>{t(label)}</span>
                </li>
              ))}
            </ol>

            {step === 0 ? (
              <div className="memo-cp-sheet-body">
                <p className="memo-cp-sheet-brief">
                  <Msym name="videocam" size="1.3rem" fill={false} />
                  <span>{t("ugcApply.briefPoint1")}</span>
                </p>
                {videos.length > 0 ? (
                  <>
                    <p className="memo-cp-sheet-caption">{t("ugcApply.examplesTitle")}</p>
                    <div className="memo-cp-sheet-examples">
                      {videos.slice(0, 3).map((video) => (
                        <a key={video.id} href={video.url} target="_blank" rel="noreferrer" className="memo-cp-sheet-example">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={video.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
                          <span aria-hidden="true">
                            <Msym name="play_arrow" size="1.2rem" />
                          </span>
                        </a>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {step === 1 ? (
              <div className="memo-cp-sheet-body">
                <div>
                  <h3 className="memo-cp-sheet-title">{t("ugcApply.detailsTitle")}</h3>
                  <p className="memo-cp-form-hint">{t("ugcApply.detailsLead")}</p>
                </div>
                <div className="memo-cp-form-row">
                  {field("firstName", t("ugcApply.field.firstName"), <input autoComplete="given-name" {...inputProps("firstName")} />)}
                  {field("lastName", t("ugcApply.field.lastName"), <input autoComplete="family-name" {...inputProps("lastName")} />)}
                </div>
                {field(
                  "email",
                  t("ugcApply.field.email"),
                  <input type="email" inputMode="email" autoComplete="email" {...inputProps("email")} />,
                )}
                {field("phone", t("ugcApply.field.phone"), <input type="tel" autoComplete="tel" {...inputProps("phone")} />)}
                <div className="memo-cp-form-row">
                  {field(
                    "country",
                    t("ugcApply.field.country"),
                    <select {...inputProps("country")}>
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
                    <input type="number" inputMode="numeric" min={13} max={99} {...inputProps("age")} />,
                  )}
                </div>
                {field(
                  "referralCode",
                  t("ugcApply.field.referral"),
                  <input
                    autoCapitalize="characters"
                    placeholder={t("ugcApply.field.referralPlaceholder")}
                    {...inputProps("referralCode")}
                  />,
                )}
              </div>
            ) : null}

            {step === 2 ? (
              <div className="memo-cp-sheet-body">
                <div className="memo-cp-instructions">
                  <h3 className="memo-cp-sheet-title">{t("ugcApply.videoTitle")}</h3>
                  <p>{t("ugcApply.videoInstr1")}</p>
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
                      <Msym name="progress_activity" size="1.3rem" className="memo-spin" />
                      <span className="memo-cp-upload-name">{upload.name}</span>
                      <span className="memo-cp-upload-meta">{t("ugcApply.videoUploading", { percent: upload.percent })}</span>
                      <span className="memo-cp-upload-bar" aria-hidden="true">
                        <span style={{ width: `${upload.percent}%` }} />
                      </span>
                    </div>
                  ) : upload.state === "done" ? (
                    <div className="memo-cp-upload-row">
                      <Msym name="check_circle" size="1.3rem" />
                      <span className="memo-cp-upload-name">{upload.name}</span>
                      <span className="memo-cp-upload-meta">{t("ugcApply.videoUploaded")}</span>
                      <button type="button" className="memo-cp-link-button" onClick={() => setUpload({ state: "idle" })}>
                        {t("ugcApply.videoRemove")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="memo-cp-upload-pick"
                      disabled={values.sampleVideoUrl.trim() !== ""}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Msym name="cloud_upload" size="1.6rem" fill={false} />
                      <span>{t("ugcApply.videoChoose")}</span>
                    </button>
                  )}
                  {upload.state === "failed" ? <p className="memo-cp-form-error">{t(upload.error)}</p> : null}
                  {errors.includes("sampleVideo") ? <p className="memo-cp-form-error">{t("ugcApply.error.sampleVideo")}</p> : null}
                </div>

                <p className="memo-cp-or">
                  <span>{t("ugcApply.videoOr")}</span>
                </p>

                {field(
                  "sampleVideoUrl",
                  t("ugcApply.field.sampleVideo"),
                  <input
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    placeholder="https://"
                    disabled={upload.state === "done" || uploading}
                    {...inputProps("sampleVideoUrl")}
                  />,
                  upload.state === "done" ? t("ugcApply.videoLinkLocked") : t("ugcApply.field.sampleVideoHint"),
                )}
              </div>
            ) : null}

            {step === lastStep ? (
              <div className="memo-cp-sheet-body">
                <h3 className="memo-cp-sheet-title">{t("ugcApply.confirmTitle")}</h3>
                <p className="memo-cp-warning">
                  <Msym name="warning" size="1.15rem" />
                  <span>{t("ugcApply.confirmWarning")}</span>
                </p>
                <div className="memo-cp-checks">
                  {CONFIRMATIONS.map((item) => (
                    <label key={item.field} className="memo-cp-check" data-invalid={errors.includes(item.field) || undefined}>
                      <input
                        type="checkbox"
                        checked={checks[item.field]}
                        onChange={(event) => {
                          setChecks((current) => ({ ...current, [item.field]: event.target.checked }));
                          clearErrors(item.field);
                        }}
                      />
                      <span>{t(item.label)}</span>
                    </label>
                  ))}
                  <label className="memo-cp-check" data-invalid={errors.includes("consent") || undefined}>
                    <input
                      type="checkbox"
                      checked={checks.consent}
                      onChange={(event) => {
                        setChecks((current) => ({ ...current, consent: event.target.checked }));
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
                </div>
                <p className={confirmMissing ? "memo-cp-form-error" : "memo-cp-form-hint"}>{t("ugcApply.confirmHint")}</p>
                {errors.includes("consent") ? <p className="memo-cp-form-error">{t("ugcApply.error.consent")}</p> : null}
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

            <div className="memo-cp-sheet-actions">
              {step > 0 ? (
                <button
                  type="button"
                  className="memo-cp-ghost"
                  disabled={submitting}
                  onClick={() => {
                    setErrors([]);
                    setStep((current) => current - 1);
                  }}
                >
                  {t("common.back")}
                </button>
              ) : null}
              <button type="submit" className="memo-cp-cta memo-cp-cta-block" disabled={submitting || uploading}>
                <span>
                  {step === lastStep ? (submitting ? t("ugcApply.submitting") : t("ugcApply.submit")) : t("ugcApply.next")}
                </span>
              </button>
            </div>
          </form>
        )}

        <button type="button" className="memo-cp-sheet-close" aria-label={t("common.close")} onClick={() => sheet.dismiss()}>
          <Msym name="close" size="1.25rem" />
        </button>
      </div>
    </MemoPortal>
  );
}
