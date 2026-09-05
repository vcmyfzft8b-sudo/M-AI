"use client";

import {
  ArrowRight,
  Check,
  ChevronLeft,
  CircleCheck,
  Instagram,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";
import { startTransition, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

import { useT, useTranslations } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";
import { InstallShot } from "@/components/install-shot";
import { HOME_SCREEN_STEPS } from "@/lib/install-guide";
import { Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { clearOfferResume } from "@/lib/offer-resume";
import { LOCALE_INTL_TAG, type Locale } from "@/lib/i18n/locales";
import { formatCurrency } from "@/lib/utils";
import {
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_SRC,
  BRAND_LOCKUP_WIDTH,
  SEO_BRAND_NAME,
} from "@/lib/brand";
import type { BillingSubscriptionRow, ProfileRow } from "@/lib/database.types";
import {
  AUDIENCE_OPTIONS,
  CLASS_FOCUS_OPTIONS,
  DAILY_GOAL_OPTIONS,
  EDUCATION_OPTIONS,
  ELEMENTARY_SCHOOL_OPTIONS,
  FEATURE_OPTIONS,
  HIGH_SCHOOL_OPTIONS,
  getOnboardingYearOptions,
  MOTIVATION_OPTIONS,
  ROLE_OPTIONS,
  SCHOOL_OPTIONS,
  SOURCE_OPTIONS,
  SUBJECT_OPTIONS,
  UNIVERSITY_SCHOOL_OPTIONS,
  type GradeScale,
} from "@/lib/onboarding-options";

type BillingPlanCard = {
  id: "weekly" | "monthly" | "yearly";
  labelKey: MessageKey;
  cadenceKey: MessageKey;
  amount: number;
  displayAmount?: number;
  billingNoteKey?: MessageKey;
  annualizedAmount: number;
  blurbKey: MessageKey;
};

type OnboardingForm = {
  heardFrom: string;
  audience: string;
  role: string;
  schoolLevel: string;
  schoolYear: string;
  subject: string;
  motivation: string;
  targetGrade: number;
  currentAverageGrade: number;
  feature: string;
  classFocus: string;
  dailyGoal: string;
};


const HOME_SCREEN_DRAG_LOCK_THRESHOLD_PX = 6;
const HOME_SCREEN_SWIPE_THRESHOLD_PX = 18;

const ONBOARDING_STEP_COUNT = 16;

/**
 * The survey is global in English and local in the four home markets, so the
 * decimal separator follows the selected locale rather than being hardcoded.
 */
function formatGrade(value: number, locale: Locale) {
  return new Intl.NumberFormat(LOCALE_INTL_TAG[locale], {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function usesTenPointGrades(schoolLevel: string) {
  return schoolLevel === "university" || schoolLevel === "college";
}

function getGradeDefaults(schoolLevel: string) {
  if (usesTenPointGrades(schoolLevel)) {
    return {
      currentAverageGrade: 6,
      targetGrade: 8,
    };
  }

  return {
    currentAverageGrade: 3.5,
    targetGrade: 4.5,
  };
}

/**
 * The wording of an option, for the free-text summary stored on the profile.
 *
 * Falls back to the raw stored value, which is an English-ish slug — better
 * than an empty sentence if an option is ever removed from the list while an
 * answer still names it.
 */
function findLabel(
  options: readonly { value: string; labelKey: MessageKey }[],
  value: string,
  t: Translate<MessageKey>,
) {
  const option = options.find((candidate) => candidate.value === value);

  return option ? t(option.labelKey) : value;
}

function mapEducationLevel(schoolLevel: string): (typeof EDUCATION_OPTIONS)[number]["value"] {
  if (
    schoolLevel === "elementary_school" ||
    schoolLevel === "high_school" ||
    schoolLevel === "technical_school" ||
    schoolLevel === "vocational_school"
  ) {
    return "high_school";
  }

  if (schoolLevel === "college") {
    return "university";
  }

  if (schoolLevel === "other") {
    return "other";
  }

  return "university";
}

function getSchoolOptionsForRole(role: string) {
  if (role === "elementary_student") {
    return ELEMENTARY_SCHOOL_OPTIONS;
  }

  if (role === "high_school_student") {
    return HIGH_SCHOOL_OPTIONS;
  }

  if (role === "university_student") {
    return UNIVERSITY_SCHOOL_OPTIONS;
  }

  return SCHOOL_OPTIONS;
}

function getYearQuestionKey(role: string): MessageKey {
  return role === "elementary_student" ? "onboarding.q.elementaryYear" : "onboarding.q.year";
}

function isStudentRole(role: string) {
  return (
    role === "elementary_student" ||
    role === "high_school_student" ||
    role === "university_student"
  );
}

function getNextOnboardingStep(currentStep: number, role: string) {
  if (currentStep === 2 && !isStudentRole(role)) {
    return 7;
  }

  if (currentStep === 2 && role === "elementary_student") {
    return 4;
  }

  if (currentStep === 4 && role !== "university_student") {
    return 6;
  }

  if (currentStep === 9) {
    return 11;
  }

  return Math.min(ONBOARDING_STEP_COUNT - 1, currentStep + 1);
}

function getPreviousOnboardingStep(currentStep: number, role: string) {
  if (currentStep === 11) {
    return 9;
  }

  if (currentStep === 7 && !isStudentRole(role)) {
    return 2;
  }

  if (currentStep === 6 && role !== "university_student") {
    return 4;
  }

  if (currentStep === 4 && role === "elementary_student") {
    return 2;
  }

  return Math.max(0, currentStep - 1);
}

function OnboardingOptionIcon({ icon }: { icon: string }) {
  if (icon === "instagram") {
    return <Instagram className="h-6 w-6" strokeWidth={2.35} />;
  }

  if (icon === "tiktok") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
        <path
          d="M14.8 3.2c.2 1.4.8 2.6 1.8 3.5 1 .9 2.2 1.4 3.6 1.5v3.2c-2.1 0-3.9-.7-5.4-2v6.1c0 3.2-2.3 5.4-5.5 5.4-1.7 0-3.1-.5-4.1-1.5-1.1-1-1.6-2.2-1.6-3.8 0-1.5.5-2.7 1.6-3.7 1-1 2.4-1.5 4-1.5.4 0 .8 0 1.2.1v3.4c-.4-.2-.8-.3-1.3-.3-1.2 0-2 .8-2 1.9s.8 1.9 2.1 1.9c1.4 0 2.2-.8 2.2-2.3V3.2h3.4Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (icon === "chatgpt") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-6 w-6">
        <path
          d="M11.248 18.25q-.825 0-1.568-.314a4.3 4.3 0 0 1-1.32-.874 4 4 0 0 1-1.304.214 4 4 0 0 1-2.046-.544 4.27 4.27 0 0 1-1.518-1.485 4 4 0 0 1-.56-2.095q0-.48.131-1.04A4.4 4.4 0 0 1 2.04 10.71a4.07 4.07 0 0 1 .017-3.4 4.2 4.2 0 0 1 1.056-1.418 3.8 3.8 0 0 1 1.6-.842 3.9 3.9 0 0 1 .76-1.683q.593-.759 1.451-1.188a4.04 4.04 0 0 1 1.832-.429q.825 0 1.567.313.742.314 1.32.875a4 4 0 0 1 1.304-.215q1.106 0 2.046.545a4.14 4.14 0 0 1 1.501 1.485q.578.941.578 2.095 0 .48-.132 1.04.66.61 1.023 1.419.363.792.363 1.666 0 .892-.38 1.717a4.3 4.3 0 0 1-1.072 1.435 3.8 3.8 0 0 1-1.584.825 3.8 3.8 0 0 1-.775 1.683 4.06 4.06 0 0 1-1.436 1.188 4.04 4.04 0 0 1-1.832.429m-4.076-2.062q.825 0 1.435-.347l3.103-1.782a.36.36 0 0 0 .164-.313v-1.42L7.881 14.62a.67.67 0 0 1-.726 0l-3.118-1.798a.5.5 0 0 1-.017.115v.198q0 .841.396 1.551.413.693 1.139 1.089a3.2 3.2 0 0 0 1.617.412m.165-2.69a.4.4 0 0 0 .181.05q.083 0 .165-.05l1.238-.71-3.977-2.31a.7.7 0 0 1-.363-.643v-3.58q-.825.362-1.32 1.122a2.9 2.9 0 0 0-.495 1.65q0 .809.413 1.55.412.743 1.072 1.123zm3.91 3.663q.875 0 1.585-.396a2.96 2.96 0 0 0 1.534-2.64v-3.564a.32.32 0 0 0-.165-.297l-1.254-.726v4.604a.7.7 0 0 1-.363.643l-3.119 1.799a3 3 0 0 0 1.783.577m.627-6.039V8.878L10.01 7.822 8.129 8.878v2.244l1.881 1.056zM7.057 5.859a.7.7 0 0 1 .363-.644l3.119-1.798a3 3 0 0 0-1.782-.578q-.874 0-1.584.396A2.96 2.96 0 0 0 6.05 4.324a3.07 3.07 0 0 0-.396 1.551v3.547q0 .199.165.314l1.237.726zm8.383 7.887q.825-.364 1.303-1.123.495-.758.495-1.65a3.15 3.15 0 0 0-.412-1.55q-.413-.743-1.073-1.123l-3.086-1.782q-.099-.065-.181-.049a.3.3 0 0 0-.165.05l-1.238.692 3.993 2.327a.6.6 0 0 1 .264.264.64.64 0 0 1 .1.363zm-3.317-8.382a.63.63 0 0 1 .726 0l3.135 1.831v-.297q0-.792-.396-1.501a2.86 2.86 0 0 0-1.105-1.155q-.71-.43-1.65-.43-.825 0-1.436.347L8.294 5.941a.36.36 0 0 0-.165.314v1.418z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return <>{icon}</>;
}

/**
 * Only the one message the buyer cannot work out for themselves.
 *
 * Backing out of Stripe used to return to a "payment cancelled" pill. It told
 * a buyer who had just pressed the browser's back button something they
 * already knew, and it cost the paywall a row it does not have: the screen is
 * sized to fit exactly once, so the extra line pushed the call to action past
 * the fold and turned the whole thing into a scroller. `success` stays — the
 * subscription is not live until the webhook lands, and that gap is the one
 * moment the screen contradicts itself.
 */
function CheckoutBanner({ state }: { state: string | null }) {
  const t = useT();

  if (state === "success") {
    return (
      <div className="app-start-banner success">
        <Check className="h-4 w-4" />
        {t("paywall.paymentReceived")}
      </div>
    );
  }

  return null;
}

export function OnboardingPaywall({
  profile,
  subscription,
  onboardingComplete,
  hasPaidAccess,
  subscriptionTrialEligible = true,
  plans,
}: {
  profile: ProfileRow | null;
  subscription: BillingSubscriptionRow | null;
  onboardingComplete: boolean;
  hasPaidAccess: boolean;
  subscriptionTrialEligible?: boolean;
  plans: BillingPlanCard[];
}) {
  const { locale, t } = useTranslations();
  const router = useRouter();
  const { navigateWithFeedback, overlay: navigationOverlay } = useInstantNavigation();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(0);
  const [savingProfile, setSavingProfile] = useState(false);
  const [selectedPaywallPlan, setSelectedPaywallPlan] = useState<BillingPlanCard["id"]>("yearly");
  const [checkoutPlan, setCheckoutPlan] = useState<BillingPlanCard["id"] | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [homeScreenStep, setHomeScreenStep] = useState(0);
  const [homeScreenDragging, setHomeScreenDragging] = useState(false);
  const homeScreenScrollRef = useRef<HTMLDivElement | null>(null);
  const homeScreenPointerStartXRef = useRef<number | null>(null);
  const homeScreenPointerStartYRef = useRef<number | null>(null);
  const homeScreenPointerIdRef = useRef<number | null>(null);
  const homeScreenPointerStartScrollLeftRef = useRef(0);
  const homeScreenPointerHasDraggedRef = useRef(false);
  const homeScreenDragAxisRef = useRef<"horizontal" | "vertical" | null>(null);
  const [gradeTouched, setGradeTouched] = useState({
    targetGrade: false,
    currentAverageGrade: false,
  });
  // The survey branches and pre-fills defaults, so a value in `form` is not
  // proof the user picked it. Only keys tracked here are stored as answers.
  const [answered, setAnswered] = useState<Partial<Record<keyof OnboardingForm, boolean>>>({});
  const [form, setForm] = useState<OnboardingForm>({
    heardFrom: SOURCE_OPTIONS[0].value,
    audience: AUDIENCE_OPTIONS[0].value,
    role: ROLE_OPTIONS[2].value,
    schoolLevel: EDUCATION_OPTIONS.some((option) => option.value === profile?.education_level)
      ? profile?.education_level === "high_school"
        ? HIGH_SCHOOL_OPTIONS[0].value
        : UNIVERSITY_SCHOOL_OPTIONS[0].value
      : HIGH_SCHOOL_OPTIONS[0].value,
    schoolYear: getOnboardingYearOptions(locale, "high_school_student", "high_school")[0].value,
    subject: SUBJECT_OPTIONS[1].value,
    motivation: "",
    targetGrade: Number.parseFloat(profile?.target_grade?.replace(",", ".") ?? "") || 4.5,
    currentAverageGrade:
      Number.parseFloat(profile?.current_average_grade?.replace(",", ".") ?? "") || 3.5,
    feature: "",
    classFocus: "",
    dailyGoal: "",
  });

  function markAnswered(key: keyof OnboardingForm) {
    setAnswered((current) => ({ ...current, [key]: true }));
  }

  function goNext(roleOverride = form.role) {
    setStep((current) => getNextOnboardingStep(current, roleOverride));
  }

  function goToHomeScreenStep(nextStep: number) {
    const boundedStep = Math.min(HOME_SCREEN_STEPS.length - 1, Math.max(0, nextStep));
    setHomeScreenStep(boundedStep);

    const scrollContainer = homeScreenScrollRef.current;
    if (scrollContainer) {
      scrollContainer.scrollTo({
        left: scrollContainer.clientWidth * boundedStep,
        behavior: "smooth",
      });
    }
  }

  function resetHomeScreenDrag() {
    homeScreenPointerStartXRef.current = null;
    homeScreenPointerStartYRef.current = null;
    homeScreenPointerIdRef.current = null;
    homeScreenPointerStartScrollLeftRef.current = 0;
    homeScreenPointerHasDraggedRef.current = false;
    homeScreenDragAxisRef.current = null;
    setHomeScreenDragging(false);
  }

  function finishHomeScreenDrag(endX: number | null, endY: number | null) {
    const scrollContainer = homeScreenScrollRef.current;
    const startX = homeScreenPointerStartXRef.current;
    const startY = homeScreenPointerStartYRef.current;

    if (!scrollContainer || startX == null || startY == null || endX == null || endY == null) {
      resetHomeScreenDrag();
      return;
    }

    const deltaX = startX - endX;
    const startStep =
      scrollContainer.clientWidth > 0
        ? Math.round(homeScreenPointerStartScrollLeftRef.current / scrollContainer.clientWidth)
        : homeScreenStep;

    if (
      homeScreenDragAxisRef.current === "horizontal" &&
      Math.abs(deltaX) >= HOME_SCREEN_SWIPE_THRESHOLD_PX
    ) {
      goToHomeScreenStep(startStep + (deltaX > 0 ? 1 : -1));
      resetHomeScreenDrag();
      return;
    }

    goToHomeScreenStep(Math.round(scrollContainer.scrollLeft / scrollContainer.clientWidth));
    resetHomeScreenDrag();
  }

  function selectAndAdvance<Key extends keyof typeof form>(
    key: Key,
    value: (typeof form)[Key],
  ) {
    if (key === "role" || key === "schoolLevel") {
      setGradeTouched({
        targetGrade: false,
        currentAverageGrade: false,
      });
      // Picking a role or school resets the steps below it back to defaults,
      // and going back to change a role can skip those steps entirely.
      setAnswered((current) => ({
        ...current,
        [key]: true,
        schoolYear: false,
        ...(key === "role" ? { schoolLevel: false, subject: false } : {}),
      }));
    } else {
      markAnswered(key);
    }

    setForm((current) => {
      if (key === "role") {
        const schoolOptions = getSchoolOptionsForRole(String(value));
        const yearOptions = getOnboardingYearOptions(locale, String(value), schoolOptions[0].value);
        const gradeDefaults = getGradeDefaults(schoolOptions[0].value);

        return {
          ...current,
          role: String(value),
          schoolLevel: schoolOptions[0].value,
          schoolYear: yearOptions[0].value,
          ...gradeDefaults,
        };
      }

      if (key === "schoolLevel") {
        const yearOptions = getOnboardingYearOptions(locale, current.role, String(value));
        const gradeDefaults = getGradeDefaults(String(value));

        return {
          ...current,
          schoolLevel: String(value),
          schoolYear: yearOptions[0].value,
          ...gradeDefaults,
        };
      }

      return { ...current, [key]: value };
    });
    window.setTimeout(() => {
      const nextRole = key === "role" ? String(value) : form.role;
      setStep((current) => getNextOnboardingStep(current, nextRole));
    }, 120);
  }

  function updateGrade(key: "targetGrade" | "currentAverageGrade", delta: number) {
    const maxGrade = usesTenPointGrades(form.schoolLevel) ? 10 : 5;
    setGradeTouched((current) => ({ ...current, [key]: true }));
    setForm((current) => {
      const nextValue = Math.min(maxGrade, Math.max(1, Number((current[key] + delta).toFixed(1))));
      return { ...current, [key]: nextValue };
    });
  }

  function buildProfilePayload(currentForm = form) {
    const subjectLabel = isStudentRole(currentForm.role)
      ? findLabel(SUBJECT_OPTIONS, currentForm.subject, t).toLowerCase()
      : findLabel(ROLE_OPTIONS, currentForm.role, t).toLowerCase();
    const motivationLabel = findLabel(
      MOTIVATION_OPTIONS,
      currentForm.motivation || "improve_marks",
      t,
    );
    const featureLabel = findLabel(FEATURE_OPTIONS, currentForm.feature || "instant_notes", t);
    const focusLabel = findLabel(CLASS_FOCUS_OPTIONS, currentForm.classFocus || "general_help", t);
    const dailyLabel = findLabel(DAILY_GOAL_OPTIONS, currentForm.dailyGoal || "regular", t);

    const gradeScale: GradeScale = usesTenPointGrades(currentForm.schoolLevel) ? 10 : 5;
    const answeredValue = (key: keyof OnboardingForm) =>
      answered[key] ? (currentForm[key] as string) : null;

    return {
      educationLevel: mapEducationLevel(currentForm.schoolLevel),
      currentAverageGrade: formatGrade(currentForm.currentAverageGrade, locale),
      targetGrade: formatGrade(currentForm.targetGrade, locale),
      studyGoal: [
        `${motivationLabel}.`,
        `${featureLabel}.`,
        `${subjectLabel}.`,
        `${focusLabel}.`,
        `${dailyLabel}.`,
      ].join(" ").slice(0, 240),
      // Every answer exactly as the user gave it; a step that was skipped or
      // never shown stays null instead of reporting its pre-filled default.
      answers: {
        heardFrom: answeredValue("heardFrom"),
        audience: answeredValue("audience"),
        role: answeredValue("role"),
        schoolLevel: answeredValue("schoolLevel"),
        schoolYear: answeredValue("schoolYear"),
        subject: answeredValue("subject"),
        motivation: answeredValue("motivation"),
        feature: answeredValue("feature"),
        classFocus: answeredValue("classFocus"),
        dailyGoal: answeredValue("dailyGoal"),
        currentAverageGrade: gradeTouched.currentAverageGrade
          ? currentForm.currentAverageGrade
          : null,
        targetGrade: gradeTouched.targetGrade ? currentForm.targetGrade : null,
        gradeScale:
          gradeTouched.currentAverageGrade || gradeTouched.targetGrade ? gradeScale : null,
      },
    };
  }

  async function submitOnboarding(formOverride?: typeof form) {
    if (savingProfile) {
      return;
    }

    setSavingProfile(true);
    setBillingError(null);

    try {
      const response = await fetch("/api/profile/onboarding", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(buildProfilePayload(formOverride ?? form)),
      });

      if (!response.ok) {
        throw new Error(t("onboarding.error.saveFailed"));
      }

      startTransition(() => {
        router.push("/app/start");
        router.refresh();
      });
    } catch (error) {
      setBillingError(
        error instanceof Error ? error.message : t("onboarding.error.saveFailed"),
      );
      setSavingProfile(false);
    }
  }

  function renderOptionList<Key extends keyof typeof form>(
    options: readonly {
      value: string;
      labelKey: MessageKey;
      descriptionKey?: MessageKey;
      icon: string;
    }[],
    key: Key,
    mode: "auto" | "manual" = "auto",
  ) {
    return (
      <div
        className={`memo-onboarding-option-list ${options.length === 6 ? "balanced" : ""} ${
          options.length >= 7 ? "dense" : ""
        } ${
          options.length >= 7 ? "compact" : ""
        }`}
      >
        {options.map((option) => {
          const selected = form[key] === option.value;

          return (
            <button
              key={option.value}
              type="button"
              className={`memo-onboarding-option ${selected ? "selected" : ""}`}
              onClick={() => {
                if (mode === "auto") {
                  selectAndAdvance(key, option.value as (typeof form)[Key]);
                  return;
                }

                markAnswered(key);
                setForm((current) => ({ ...current, [key]: option.value }));
              }}
            >
              <span className="memo-onboarding-option-icon" aria-hidden="true">
                <OnboardingOptionIcon icon={option.icon} />
              </span>
              <span>
                <strong>{t(option.labelKey)}</strong>
                {option.descriptionKey ? <small>{t(option.descriptionKey)}</small> : null}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  function renderGradeStepper(key: "targetGrade" | "currentAverageGrade") {
    return (
      <div className="memo-onboarding-grade-wrap">
        <div className="memo-onboarding-grade-stepper" aria-label={t("onboarding.gradeStepper")}>
          <button
            type="button"
            onClick={() => updateGrade(key, -0.1)}
            aria-label={t("onboarding.lowerGrade")}
          >
            <Minus className="h-7 w-7" />
          </button>
          <strong>{formatGrade(form[key], locale)}</strong>
          <button
            type="button"
            onClick={() => updateGrade(key, 0.1)}
            aria-label={t("onboarding.raiseGrade")}
          >
            <Plus className="h-7 w-7" />
          </button>
        </div>
      </div>
    );
  }

  function renderCurrentStep() {
    if (step === 0) {
      return {
        title: t("onboarding.q.heardFrom"),
        body: renderOptionList(SOURCE_OPTIONS, "heardFrom"),
      };
    }

    if (step === 1) {
      return {
        title: t("onboarding.q.audience"),
        body: renderOptionList(AUDIENCE_OPTIONS, "audience"),
      };
    }

    if (step === 2) {
      return {
        title: t("onboarding.q.role"),
        body: renderOptionList(ROLE_OPTIONS, "role"),
      };
    }

    if (step === 3) {
      return {
        title: t("onboarding.q.schoolLevel"),
        body: renderOptionList(getSchoolOptionsForRole(form.role), "schoolLevel"),
      };
    }

    if (step === 4) {
      return {
        title: t(getYearQuestionKey(form.role)),
        body: renderOptionList(getOnboardingYearOptions(locale, form.role, form.schoolLevel), "schoolYear"),
      };
    }

    if (step === 5) {
      return {
        title: t("onboarding.q.subject"),
        body: renderOptionList(SUBJECT_OPTIONS, "subject"),
      };
    }

    if (step === 6) {
      return {
        title: null,
        body: (
          <div className="memo-onboarding-proof">
            <h2>{t("onboarding.proof.title")}</h2>
            <p>{t("onboarding.proof.lead")}</p>
            <ul>
              {(
                [
                  "onboarding.proof.notes",
                  "onboarding.proof.practice",
                  "onboarding.proof.transcripts",
                  "onboarding.proof.chat",
                ] as const
              ).map((itemKey) => (
                <li key={itemKey}>
                  <span aria-hidden="true">
                    <Check className="h-7 w-7" />
                  </span>
                  <strong>{t(itemKey)}</strong>
                </li>
              ))}
            </ul>
          </div>
        ),
        action: t("onboarding.continue"),
      };
    }

    if (step === 7) {
      return {
        title: t("onboarding.q.motivation"),
        body: renderOptionList(MOTIVATION_OPTIONS, "motivation", "manual"),
        action: t("onboarding.continue"),
        disabled: !form.motivation,
      };
    }

    if (step === 8) {
      return {
        title: t("onboarding.q.currentGrade"),
        copy: t("onboarding.q.currentGradeCopy"),
        body: renderGradeStepper("currentAverageGrade"),
        action: t(gradeTouched.currentAverageGrade ? "onboarding.continue" : "onboarding.skip"),
      };
    }

    if (step === 9) {
      return {
        title: t("onboarding.q.targetGrade"),
        body: renderGradeStepper("targetGrade"),
        action: t(gradeTouched.targetGrade ? "onboarding.continue" : "onboarding.skip"),
      };
    }

    if (step === 10) {
      return {
        title: t("onboarding.testimonial.title"),
        body: (
          <div className="memo-onboarding-testimonial">
            <div>
              <strong>{t("onboarding.testimonial.author")}</strong>
              <span>{t("onboarding.testimonial.school")}</span>
            </div>
            <p>{t("onboarding.testimonial.quote")}</p>
            <div className="memo-onboarding-stars" aria-label={t("onboarding.testimonial.stars")}>
              ★★★★★
            </div>
          </div>
        ),
        action: t("onboarding.continue"),
      };
    }

    if (step === 11) {
      return {
        title: null,
        body: (
          <div className="memo-onboarding-progress-story">
            <h2>{t("onboarding.progress.title")}</h2>
            <p>{t("onboarding.progress.copy")}</p>
            <div className="memo-onboarding-chart" aria-label={t("onboarding.progress.chartLabel")}>
              <div className="memo-onboarding-chart-header">
                <strong>{t("onboarding.progress.yourGrades")}</strong>
                <div>
                  <span className="memo-onboarding-legend-primary">
                    {t("onboarding.progress.withMemo")}
                  </span>
                  <span className="memo-onboarding-legend-muted">
                    {t("onboarding.progress.alone")}
                  </span>
                </div>
              </div>
              <div className="memo-onboarding-chart-lines" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <svg viewBox="0 0 560 360" role="presentation">
                  <polyline
                    points="54,282 168,224 328,162 410,78 528,24"
                    className="memo-onboarding-line-primary"
                  />
                  <polyline
                    points="54,282 168,270 272,256 328,272 410,242 528,256"
                    className="memo-onboarding-line-muted"
                  />
                </svg>
              </div>
            </div>
          </div>
        ),
        action: t("onboarding.continue"),
      };
    }

    if (step === 12) {
      return {
        title: t("onboarding.q.feature"),
        body: (
          <div className="memo-onboarding-feature-grid">
            {FEATURE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`memo-onboarding-feature ${form.feature === option.value ? "selected" : ""}`}
                onClick={() => {
                  markAnswered("feature");
                  setForm((current) => ({ ...current, feature: option.value }));
                }}
              >
                <span aria-hidden="true">{option.icon}</span>
                <strong>{t(option.labelKey)}</strong>
              </button>
            ))}
          </div>
        ),
        action: t("onboarding.continue"),
        disabled: !form.feature,
      };
    }

    if (step === 13) {
      return {
        title: t("onboarding.q.classFocus"),
        body: renderOptionList(CLASS_FOCUS_OPTIONS, "classFocus"),
      };
    }

    if (step === 14) {
      return {
        title: t("onboarding.q.dailyGoal"),
        body: (
          <div className="memo-onboarding-option-list">
            {DAILY_GOAL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`memo-onboarding-option ${form.dailyGoal === option.value ? "selected" : ""}`}
                onClick={() => {
                  const nextForm = { ...form, dailyGoal: option.value };
                  markAnswered("dailyGoal");
                  setForm(nextForm);
                  window.setTimeout(() => {
                    setStep(15);
                  }, 120);
                }}
                disabled={savingProfile}
              >
                <span className="memo-onboarding-option-icon" aria-hidden="true">
                  <OnboardingOptionIcon icon={option.icon} />
                </span>
                <span>
                  <strong>{t(option.labelKey)}</strong>
                </span>
              </button>
            ))}
          </div>
        ),
      };
    }

    return {
      title: t("onboarding.homeScreenTitle"),
      body: (
        <div className="memo-onboarding-home-wrap">
          <div
            ref={homeScreenScrollRef}
            className={`memo-onboarding-home-screen ${homeScreenDragging ? "dragging" : ""}`}
            onScroll={(event) => {
              const { clientWidth, scrollLeft } = event.currentTarget;
              if (clientWidth > 0) {
                setHomeScreenStep(Math.round(scrollLeft / clientWidth));
              }
            }}
            onPointerDown={(event) => {
              if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
                return;
              }

              homeScreenPointerStartXRef.current = event.clientX;
              homeScreenPointerStartYRef.current = event.clientY;
              homeScreenPointerIdRef.current = event.pointerId;
              homeScreenPointerStartScrollLeftRef.current = event.currentTarget.scrollLeft;
              homeScreenPointerHasDraggedRef.current = false;
              homeScreenDragAxisRef.current = null;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (homeScreenPointerIdRef.current !== event.pointerId) {
                return;
              }

              const startX = homeScreenPointerStartXRef.current;
              if (startX == null) {
                return;
              }

              const startY = homeScreenPointerStartYRef.current;
              const deltaX = event.clientX - startX;
              const deltaY = startY == null ? 0 : event.clientY - startY;
              const absoluteDeltaX = Math.abs(deltaX);
              const absoluteDeltaY = Math.abs(deltaY);

              if (
                homeScreenDragAxisRef.current == null &&
                absoluteDeltaX < HOME_SCREEN_DRAG_LOCK_THRESHOLD_PX &&
                absoluteDeltaY < HOME_SCREEN_DRAG_LOCK_THRESHOLD_PX
              ) {
                return;
              }

              if (homeScreenDragAxisRef.current == null) {
                homeScreenDragAxisRef.current =
                  absoluteDeltaX >= absoluteDeltaY ? "horizontal" : "vertical";
              }

              if (homeScreenDragAxisRef.current === "vertical") {
                return;
              }

              if (!homeScreenPointerHasDraggedRef.current) {
                homeScreenPointerHasDraggedRef.current = true;
                setHomeScreenDragging(true);
              }
              event.preventDefault();
              event.currentTarget.scrollLeft =
                homeScreenPointerStartScrollLeftRef.current - deltaX;
            }}
            onPointerUp={(event) => {
              if (homeScreenPointerIdRef.current !== event.pointerId) {
                return;
              }

              finishHomeScreenDrag(event.clientX, event.clientY);
            }}
            onPointerCancel={resetHomeScreenDrag}
            onLostPointerCapture={resetHomeScreenDrag}
            onDragStart={(event) => {
              event.preventDefault();
            }}
          >
            <div className="memo-onboarding-home-track">
              {HOME_SCREEN_STEPS.map((item) => (
                <article key={item.titleKey} className="memo-onboarding-home-card">
                  <div className="memo-onboarding-home-copy">
                    <div>
                      <strong>{t(item.titleKey)}</strong>
                      <p>{t(item.descriptionKey)}</p>
                    </div>
                  </div>
                  <div className="memo-onboarding-home-visual">
                    <InstallShot step={item} sizes="(max-width: 640px) 100vw, 35rem" />
                    {"highlight" in item ? (
                      <span
                        className="memo-onboarding-home-highlight"
                        style={{
                          left: item.highlight.left,
                          top: item.highlight.top,
                          width: item.highlight.width,
                          height: item.highlight.height,
                        }}
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="memo-onboarding-home-controls" aria-label={t("onboarding.homeScreenSteps")}>
            <button
              type="button"
              onClick={() => goToHomeScreenStep(homeScreenStep - 1)}
              disabled={homeScreenStep === 0}
              aria-label={t("onboarding.previousStep")}
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <div>
              {HOME_SCREEN_STEPS.map((item, index) => (
                <button
                  key={item.titleKey}
                  type="button"
                  className={homeScreenStep === index ? "active" : ""}
                  onClick={() => goToHomeScreenStep(index)}
                  aria-label={t("onboarding.showStep", { index: index + 1 })}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => goToHomeScreenStep(homeScreenStep + 1)}
              disabled={homeScreenStep === HOME_SCREEN_STEPS.length - 1}
              aria-label={t("onboarding.nextStep")}
            >
              <ArrowRight className="h-6 w-6" />
            </button>
          </div>
        </div>
      ),
      action: t("onboarding.finish"),
    };
  }

  async function startCheckout(plan: BillingPlanCard["id"]) {
    setBillingError(null);
    setCheckoutPlan(plan);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ plan }),
      });

      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? t("paywall.error.checkoutFailed"));
      }

      window.location.href = payload.url;
    } catch (error) {
      setBillingError(
        error instanceof Error ? error.message : t("paywall.error.checkoutFailed"),
      );
    } finally {
      setCheckoutPlan(null);
    }
  }

  const effectiveOnboardingComplete = onboardingComplete;
  const checkoutState = searchParams.get("checkout");
  const hasNotice = checkoutState === "success" || Boolean(billingError);

  /*
   * A completed purchase ends the wheel's offer, so the note that would put its
   * sheet back on the home screen goes with it. Not left to `hasPaidAccess`:
   * the subscription only lands once Stripe's webhook has been processed, and
   * the buyer can reach the home screen before that.
   */
  useEffect(() => {
    if (checkoutState === "success") {
      clearOfferResume();
    }
  }, [checkoutState]);
  const monthlyPlan = plans.find((plan) => plan.id === "monthly");
  const yearlyPlan = plans.find((plan) => plan.id === "yearly");
  const paywallPlans = [yearlyPlan, monthlyPlan].filter(
    (plan): plan is BillingPlanCard => Boolean(plan),
  );

  if (!effectiveOnboardingComplete) {
    const currentStep = renderCurrentStep();
    const progress = ((step + 1) / ONBOARDING_STEP_COUNT) * 100;

    return (
      <section className="app-start-panel app-start-panel-fullscreen app-start-panel-survey memo-onboarding-shell">
        <div className="memo-onboarding-frame">
          <div className="memo-onboarding-topbar">
            <button
              type="button"
              className="memo-onboarding-back"
              onClick={() =>
                setStep((current) => getPreviousOnboardingStep(current, form.role))
              }
              disabled={step === 0 || savingProfile}
              aria-label={t("common.back")}
            >
              <ChevronLeft className="h-9 w-9" />
            </button>
            <div className="memo-onboarding-progress" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="memo-onboarding-content">
            {billingError ? <div className="app-start-banner">{billingError}</div> : null}
            {currentStep.title ? <h2>{currentStep.title}</h2> : null}
            {"copy" in currentStep && currentStep.copy ? <p>{currentStep.copy}</p> : null}
            {currentStep.body}
          </div>

          {"action" in currentStep && currentStep.action ? (
            <div className="memo-onboarding-actions">
              <button
                type="button"
                className={`memo-onboarding-pill-button ${currentStep.action === t("onboarding.skip") ? "secondary" : ""}`}
                onClick={() => {
                  if (step === ONBOARDING_STEP_COUNT - 1) {
                    void submitOnboarding();
                    return;
                  }

                  goNext();
                }}
                disabled={Boolean("disabled" in currentStep && currentStep.disabled) || savingProfile}
              >
                {savingProfile ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                {currentStep.action}
                <ArrowRight className="h-7 w-7" />
              </button>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="app-start-panel app-start-panel-paywall memo-paywall-shell">
      {navigationOverlay}
      {effectiveOnboardingComplete ? (
        <div className="app-start-dismiss-row">
          <button
            type="button"
            className="memo-close-button app-start-close-button"
            onClick={() => navigateWithFeedback("/app")}
            aria-label={t("paywall.close")}
          >
            <Msym name="close" size="1.45rem" fill={false} weight={500} />
          </button>
        </div>
      ) : null}

      {/* A notice takes the wordmark's place rather than a row of its own. The
          screen is laid out to land on exactly one viewport, so a row added on
          top of the full column is a row that pushes the footer under the fold
          — which is how the old cancelled-payment banner turned this into a
          scroller. The wordmark is the one block here that says nothing the
          buyer needs, so it is the one that stands aside. */}
      {hasNotice ? (
        <div className="memo-paywall-notices" role="status" aria-live="polite">
          <CheckoutBanner state={checkoutState} />
          {billingError ? <div className="app-start-banner">{billingError}</div> : null}
        </div>
      ) : (
        <div className="memo-paywall-brand">
          <span className="memo-paywall-logo">
            <Image
              src={BRAND_LOCKUP_SRC}
              alt={SEO_BRAND_NAME}
              width={BRAND_LOCKUP_WIDTH}
              height={BRAND_LOCKUP_HEIGHT}
              priority
            />
          </span>
        </div>
      )}

      <h1 className="memo-paywall-title">{t("paywall.title")}</h1>

      <div className="memo-paywall-benefits">
        {(
          [
            {
              titleKey: "paywall.benefit.notesTitle",
              copyKey: "paywall.benefit.notesCopy",
              icon: "📝",
            },
            {
              titleKey: "paywall.benefit.toolsTitle",
              copyKey: "paywall.benefit.toolsCopy",
              icon: "💡",
            },
            {
              titleKey: "paywall.benefit.speedTitle",
              copyKey: "paywall.benefit.speedCopy",
              icon: "⚡",
            },
          ] as const
        ).map((benefit) => (
          <div className="memo-paywall-benefit" key={benefit.titleKey}>
            <span aria-hidden="true">{benefit.icon}</span>
            <div>
              <strong>{t(benefit.titleKey)}</strong>
              <p>{t(benefit.copyKey)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="memo-paywall-plan-grid" role="radiogroup" aria-label={t("paywall.choosePlan")}>
        {paywallPlans.map((plan) => {
          const selected = selectedPaywallPlan === plan.id;
          const activePlan = subscription?.plan === plan.id && hasPaidAccess;
          const annualizedMonthly = monthlyPlan?.annualizedAmount ?? 0;
          const yearlySavings = annualizedMonthly > plan.annualizedAmount
            ? Math.round((1 - plan.annualizedAmount / annualizedMonthly) * 100)
            : 0;
          const displayPrice = formatCurrency(plan.displayAmount ?? plan.amount, locale);
          const suffix = t("paywall.perMonth");
          const detail =
            plan.id === "yearly"
              ? t("paywall.billedYearly", { amount: formatCurrency(plan.annualizedAmount, locale) })
              : t("paywall.billedMonthly");

          return (
            <button
              type="button"
              key={plan.id}
              className={`memo-paywall-plan ${selected ? "selected" : ""}`}
              onClick={() => setSelectedPaywallPlan(plan.id)}
              role="radio"
              aria-checked={selected}
            >
              {plan.id === "yearly" ? (
                <span className="memo-paywall-plan-badge">{t("paywall.mostPopular")}</span>
              ) : null}
              <span className="memo-paywall-plan-header">
                <strong>{t(plan.labelKey)}</strong>
                <span className="memo-paywall-radio" aria-hidden="true">
                  {selected || activePlan ? <span /> : null}
                </span>
              </span>
              <span className="memo-paywall-plan-price">
                {displayPrice}
                <small>{suffix}</small>
              </span>
              <span className="memo-paywall-plan-detail">{detail}</span>
              {plan.id === "yearly" && yearlySavings > 0 ? (
                <span className="memo-paywall-save">
                  {t("paywall.save", { percent: yearlySavings })}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <p className="memo-paywall-due">
        <CircleCheck className="h-5 w-5" />
        {t(subscriptionTrialEligible ? "paywall.nothingToday" : "paywall.securePayment")}
      </p>

      <button
        type="button"
        className={`memo-paywall-cta ${checkoutPlan === selectedPaywallPlan ? "loading" : ""}`}
        onClick={() => startCheckout(selectedPaywallPlan)}
        disabled={checkoutPlan !== null || (subscription?.plan === selectedPaywallPlan && hasPaidAccess)}
      >
        {checkoutPlan === selectedPaywallPlan ? (
          <Loader2 className="memo-paywall-cta-spinner animate-spin" />
        ) : null}
        {checkoutPlan === selectedPaywallPlan ? null : (
          <span className="memo-paywall-cta-label">
            {subscription?.plan === selectedPaywallPlan && hasPaidAccess
              ? t("paywall.currentPlan")
              : t(
                  subscriptionTrialEligible
                    ? "paywall.startTrial"
                    : "paywall.continueToPayment",
                )}
          </span>
        )}
      </button>

      <div className="memo-paywall-foot">
        <span>
          <CircleCheck className="h-5 w-5" />
          {t("paywall.cancelAnytime")}
        </span>
      </div>
    </section>
  );
}
