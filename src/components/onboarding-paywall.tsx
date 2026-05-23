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
  X,
} from "lucide-react";
import { startTransition, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

import { EmojiIcon } from "@/components/emoji-icon";
import type { BillingSubscriptionRow, ProfileRow } from "@/lib/database.types";

type BillingPlanCard = {
  id: "weekly" | "monthly" | "yearly";
  label: string;
  cadence: string;
  amount: number;
  displayAmount?: string;
  billingNote?: string;
  annualizedAmount: number;
  blurb: string;
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

const AGE_OPTIONS = [
  { value: "under_16", label: "Manj kot 16" },
  { value: "16_18", label: "16-18" },
  { value: "19_22", label: "19-22" },
  { value: "23_29", label: "23-29" },
  { value: "30_plus", label: "30+" },
] as const;

const EDUCATION_OPTIONS = [
  { value: "high_school", label: "Srednja šola" },
  { value: "university", label: "Fakulteta" },
  { value: "masters", label: "Magisterij" },
  { value: "self_study", label: "Samostojno učenje" },
  { value: "other", label: "Drugo" },
] as const;

const SOURCE_OPTIONS = [
  { value: "instagram_reels", label: "Instagram Reels", icon: "instagram" },
  { value: "tiktok", label: "TikTok", icon: "tiktok" },
  { value: "chatgpt", label: "ChatGPT", icon: "chatgpt" },
  { value: "friend", label: "Prijatelj", icon: "💬" },
  { value: "other", label: "Drugo", icon: "✏️" },
] as const;

const AUDIENCE_OPTIONS = [
  { value: "me", label: "Zame", icon: "🌱" },
  { value: "me_family", label: "Zame + družina", icon: "🌳" },
  { value: "someone_else", label: "Za nekoga drugega (ne zame)", icon: "🎁" },
] as const;

const ROLE_OPTIONS = [
  {
    value: "working_professional",
    label: "Zaposlen/a",
    description: "Sestanki, glasovni zapiski in drugo",
    icon: "💼",
  },
  {
    value: "elementary_student",
    label: "Osnovnošolec",
    description: "Učenje, domače naloge in priprava na teste",
    icon: "📘",
  },
  {
    value: "high_school_student",
    label: "Dijak",
    description: "Zapiski, testi in matura",
    icon: "📚",
  },
  {
    value: "university_student",
    label: "Študent",
    description: "Predavanja, izpiti/testi in študijsko gradivo",
    icon: "🎓",
  },
  {
    value: "parent",
    label: "Starš",
    description: "Preizkus za otroka ali darilo naročnine",
    icon: "👨‍👩‍👧",
  },
  {
    value: "teacher",
    label: "Učitelj/profesor",
    description: "Snemanje predavanj, deljenje zapiskov ali drugo",
    icon: "🧑‍🏫",
  },
] as const;

const ELEMENTARY_SCHOOL_OPTIONS = [
  { value: "elementary_school", label: "Osnovna šola", icon: "🏫" },
  { value: "other", label: "Nekaj drugega", icon: "✍️" },
] as const;

const HIGH_SCHOOL_OPTIONS = [
  { value: "high_school", label: "Gimnazija", icon: "📘" },
  { value: "technical_school", label: "Srednja strokovna šola", icon: "🧰" },
  { value: "vocational_school", label: "Poklicna šola", icon: "🔧" },
  { value: "other", label: "Nekaj drugega", icon: "✍️" },
] as const;

const UNIVERSITY_SCHOOL_OPTIONS = [
  { value: "university", label: "Fakulteta / univerza", icon: "📚" },
  { value: "college", label: "Višja šola", icon: "🎓" },
  { value: "other", label: "Nekaj drugega", icon: "✍️" },
] as const;

const SCHOOL_OPTIONS = [
  { value: "elementary_school", label: "Osnovna šola", icon: "🏫" },
  { value: "high_school", label: "Srednja šola", icon: "📘" },
  { value: "university", label: "Fakulteta / univerza", icon: "📚" },
  { value: "other", label: "Nekaj drugega", icon: "✍️" },
] as const;

const ELEMENTARY_YEAR_OPTIONS = [
  { value: "grade_1", label: "1. razred", icon: "🌱" },
  { value: "grade_2", label: "2. razred", icon: "🌿" },
  { value: "grade_3", label: "3. razred", icon: "🪴" },
  { value: "grade_4", label: "4. razred", icon: "🌳" },
  { value: "grade_5", label: "5. razred", icon: "📗" },
  { value: "grade_6", label: "6. razred", icon: "📘" },
  { value: "grade_7", label: "7. razred", icon: "📙" },
  { value: "grade_8", label: "8. razred", icon: "📕" },
  { value: "grade_9", label: "9. razred", icon: "🎒" },
] as const;

const HIGH_SCHOOL_YEAR_OPTIONS = [
  { value: "year_1", label: "1. letnik", icon: "🌱" },
  { value: "year_2", label: "2. letnik", icon: "🌿" },
  { value: "year_3", label: "3. letnik", icon: "🪴" },
  { value: "year_4", label: "4. letnik", icon: "🌳" },
  { value: "year_5", label: "5. letnik", icon: "🍂" },
] as const;

const HIGH_SCHOOL_FOUR_YEAR_OPTIONS = HIGH_SCHOOL_YEAR_OPTIONS.slice(0, 4);

const UNIVERSITY_YEAR_OPTIONS = [
  { value: "senior", label: "4. letnik ali več", icon: "🌳" },
  { value: "junior", label: "3. letnik", icon: "🪴" },
  { value: "sophomore", label: "2. letnik", icon: "🌿" },
  { value: "freshman", label: "1. letnik", icon: "🌱" },
  { value: "graduate", label: "Podiplomski študij", icon: "🍂" },
] as const;

const SUBJECT_OPTIONS = [
  { value: "arts_humanities", label: "Umetnost in humanistika", icon: "🎨" },
  { value: "business_economics", label: "Ekonomija", icon: "💼" },
  { value: "computer_science", label: "Računalništvo", icon: "💻" },
  { value: "maths", label: "Matematika", icon: "📐" },
  { value: "education", label: "Pedagoške smeri", icon: "📚" },
  { value: "engineering_technology", label: "Inženirstvo in tehnologija", icon: "⚙️" },
  { value: "health_medicine", label: "Zdravstvo in medicina", icon: "🏥" },
  { value: "law_criminal_justice", label: "Pravo", icon: "⚖️" },
  { value: "life_physical_sciences", label: "Naravoslovje", icon: "🔬" },
  { value: "social_sciences", label: "Družboslovje", icon: "🌍" },
] as const;

const MOTIVATION_OPTIONS = [
  { value: "improve_marks", label: "Izboljšati ocene", icon: "💯" },
  { value: "learn_faster", label: "Učiti se 10x hitreje", icon: "📗" },
  { value: "focus_better", label: "Bolje slediti predavanjem", icon: "🎙️" },
  { value: "never_miss_detail", label: "Ne zamuditi podrobnosti na predavanju", icon: "📈" },
  { value: "something_else", label: "Nekaj drugega", icon: "✍️" },
] as const;

const FEATURE_OPTIONS = [
  { value: "audio_notes", label: "Audio zapiski", icon: "🎧" },
  { value: "quizzes", label: "Kvizi", icon: "📝" },
  { value: "flashcards", label: "Flashcards", icon: "🃏" },
  { value: "record_lectures", label: "Snemanje predavanj", icon: "🎙️" },
  { value: "tests", label: "Testi", icon: "✅" },
  { value: "ai_chat_notes", label: "AI klepet z zapiski", icon: "💬" },
] as const;

const CLASS_FOCUS_OPTIONS = [
  { value: "specific_class", label: "Da, določen predmet", icon: "📗" },
  { value: "upcoming_exam", label: "Da, prihajajoči izpit/test", icon: "📅" },
  { value: "something_else", label: "Da, nekaj drugega", icon: "👀" },
  { value: "general_help", label: "Ne, pomagaj mi na splošno", icon: "📈" },
] as const;

const DAILY_GOAL_OPTIONS = [
  { value: "casual", label: "Sproščeno - 10 min / dan", icon: "🍃" },
  { value: "regular", label: "Redno - 20 min / dan", icon: "🌱" },
  { value: "serious", label: "Resno - 60 min / dan", icon: "🌿" },
  { value: "intensive", label: "Intenzivno - 90+ min / dan", icon: "🌳" },
] as const;

const ONBOARDING_STEP_COUNT = 15;

function formatSlovenianGrade(value: number) {
  return value.toFixed(1).replace(".", ",");
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

function findLabel(options: readonly { value: string; label: string }[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
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

function getYearOptionsForRole(role: string, schoolLevel?: string) {
  if (role === "elementary_student") {
    return ELEMENTARY_YEAR_OPTIONS;
  }

  if (role === "high_school_student") {
    if (schoolLevel === "high_school") {
      return HIGH_SCHOOL_FOUR_YEAR_OPTIONS;
    }

    return HIGH_SCHOOL_YEAR_OPTIONS;
  }

  return UNIVERSITY_YEAR_OPTIONS;
}

function getYearQuestionForRole(role: string) {
  if (role === "elementary_student") {
    return "Kateri razred si?";
  }

  return "Kateri letnik si?";
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

function CheckoutBanner({ state }: { state: string | null }) {
  if (state === "success") {
    return (
      <div className="app-start-banner success">
        <Check className="h-4 w-4" />
        Plačilo prejeto. Stripe trenutno zaključuje aktivacijo naročnine.
      </div>
    );
  }

  if (state === "cancelled") {
    return (
      <div className="app-start-banner">
        <EmojiIcon symbol="🧾" size="1rem" />
        Plačilo je bilo preklicano. Spodaj lahko ponovno izbereš paket.
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
  plans,
  devPreview = false,
}: {
  profile: ProfileRow | null;
  subscription: BillingSubscriptionRow | null;
  onboardingComplete: boolean;
  hasPaidAccess: boolean;
  plans: BillingPlanCard[];
  devPreview?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(0);
  const [previewOnboardingComplete, setPreviewOnboardingComplete] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [selectedPaywallPlan, setSelectedPaywallPlan] = useState<BillingPlanCard["id"]>("yearly");
  const [checkoutPlan, setCheckoutPlan] = useState<BillingPlanCard["id"] | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [gradeTouched, setGradeTouched] = useState({
    targetGrade: false,
    currentAverageGrade: false,
  });
  const [form, setForm] = useState<OnboardingForm>({
    heardFrom: SOURCE_OPTIONS[0].value,
    audience: AUDIENCE_OPTIONS[0].value,
    role: ROLE_OPTIONS[2].value,
    schoolLevel: EDUCATION_OPTIONS.some((option) => option.value === profile?.education_level)
      ? profile?.education_level === "high_school"
        ? HIGH_SCHOOL_OPTIONS[0].value
        : UNIVERSITY_SCHOOL_OPTIONS[0].value
      : HIGH_SCHOOL_OPTIONS[0].value,
    schoolYear: HIGH_SCHOOL_YEAR_OPTIONS[0].value,
    subject: SUBJECT_OPTIONS[1].value,
    motivation: "",
    targetGrade: Number.parseFloat(profile?.target_grade?.replace(",", ".") ?? "") || 4.5,
    currentAverageGrade:
      Number.parseFloat(profile?.current_average_grade?.replace(",", ".") ?? "") || 3.5,
    feature: "",
    classFocus: "",
    dailyGoal: "",
  });

  function goNext(roleOverride = form.role) {
    setStep((current) => getNextOnboardingStep(current, roleOverride));
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
    }

    setForm((current) => {
      if (key === "role") {
        const schoolOptions = getSchoolOptionsForRole(String(value));
        const yearOptions = getYearOptionsForRole(String(value), schoolOptions[0].value);
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
        const yearOptions = getYearOptionsForRole(current.role, String(value));
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
      ? findLabel(SUBJECT_OPTIONS, currentForm.subject).toLowerCase()
      : findLabel(ROLE_OPTIONS, currentForm.role).toLowerCase();
    const motivationLabel = findLabel(MOTIVATION_OPTIONS, currentForm.motivation || "improve_marks");
    const featureLabel = findLabel(FEATURE_OPTIONS, currentForm.feature || "instant_notes");
    const focusLabel = findLabel(CLASS_FOCUS_OPTIONS, currentForm.classFocus || "general_help");
    const dailyLabel = findLabel(DAILY_GOAL_OPTIONS, currentForm.dailyGoal || "regular");

    return {
      ageRange: AGE_OPTIONS[2].value,
      educationLevel: mapEducationLevel(currentForm.schoolLevel),
      currentAverageGrade: formatSlovenianGrade(currentForm.currentAverageGrade),
      targetGrade: formatSlovenianGrade(currentForm.targetGrade),
      studyGoal: [
        `${motivationLabel}.`,
        `${featureLabel}.`,
        `${subjectLabel}.`,
        `${focusLabel}.`,
        `${dailyLabel}.`,
      ].join(" ").slice(0, 240),
    };
  }

  async function submitOnboarding(formOverride?: typeof form) {
    setSavingProfile(true);

    try {
      if (devPreview) {
        setPreviewOnboardingComplete(true);
        return;
      }

      const response = await fetch("/api/profile/onboarding", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(buildProfilePayload(formOverride ?? form)),
      });

      if (!response.ok) {
        throw new Error("Onboardinga ni bilo mogoče shraniti.");
      }

      startTransition(() => {
        router.push("/app/start");
        router.refresh();
      });
    } finally {
      setSavingProfile(false);
    }
  }

  function renderOptionList<Key extends keyof typeof form>(
    options: readonly { value: string; label: string; description?: string; icon: string }[],
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

                setForm((current) => ({ ...current, [key]: option.value }));
              }}
            >
              <span className="memo-onboarding-option-icon" aria-hidden="true">
                <OnboardingOptionIcon icon={option.icon} />
              </span>
              <span>
                <strong>{option.label}</strong>
                {option.description ? <small>{option.description}</small> : null}
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
        <div className="memo-onboarding-grade-stepper" aria-label="Izberi povprečno oceno">
          <button
            type="button"
            onClick={() => updateGrade(key, -0.1)}
            aria-label="Znižaj oceno"
          >
            <Minus className="h-7 w-7" />
          </button>
          <strong>{formatSlovenianGrade(form[key])}</strong>
          <button
            type="button"
            onClick={() => updateGrade(key, 0.1)}
            aria-label="Zvišaj oceno"
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
        title: "Kako si izvedel/a za Memo AI?",
        body: renderOptionList(SOURCE_OPTIONS, "heardFrom"),
      };
    }

    if (step === 1) {
      return {
        title: "Za koga je Memo AI?",
        body: renderOptionList(AUDIENCE_OPTIONS, "audience"),
      };
    }

    if (step === 2) {
      return {
        title: "Kaj te najbolje opiše?",
        body: renderOptionList(ROLE_OPTIONS, "role"),
      };
    }

    if (step === 3) {
      return {
        title: "Kje se šolaš?",
        body: renderOptionList(getSchoolOptionsForRole(form.role), "schoolLevel"),
      };
    }

    if (step === 4) {
      return {
        title: getYearQuestionForRole(form.role),
        body: renderOptionList(getYearOptionsForRole(form.role, form.schoolLevel), "schoolYear"),
      };
    }

    if (step === 5) {
      return {
        title: "Katero je tvoje glavno področje študija?",
        body: renderOptionList(SUBJECT_OPTIONS, "subject"),
      };
    }

    if (step === 6) {
      return {
        title: null,
        body: (
          <div className="memo-onboarding-proof">
            <h2>Si v dobri družbi!</h2>
            <p>Veliko tvojih sošolcev že uporablja Memo AI za:</p>
            <ul>
              {[
                "Podrobne zapiske s predavanj",
                "AI vaje za izpite/teste",
                "Natančne prepise",
                "Klepet z dolgimi PDF-ji in dokumenti",
              ].map((item) => (
                <li key={item}>
                  <span aria-hidden="true">
                    <Check className="h-7 w-7" />
                  </span>
                  <strong>{item}</strong>
                </li>
              ))}
            </ul>
          </div>
        ),
        action: "Nadaljuj",
      };
    }

    if (step === 7) {
      return {
        title: "Kaj te pripelje v Memo AI?",
        body: renderOptionList(MOTIVATION_OPTIONS, "motivation", "manual"),
        action: "Nadaljuj",
        disabled: !form.motivation,
      };
    }

    if (step === 8) {
      return {
        title: "Kakšna je tvoja povprečna ocena zdaj?",
        copy: "Približek je v redu.",
        body: renderGradeStepper("currentAverageGrade"),
        action: gradeTouched.currentAverageGrade ? "Nadaljuj" : "Preskoči",
      };
    }

    if (step === 9) {
      return {
        title: "Kakšna je tvoja ciljna povprečna ocena?",
        body: renderGradeStepper("targetGrade"),
        action: gradeTouched.targetGrade ? "Nadaljuj" : "Preskoči",
      };
    }

    if (step === 10) {
      return {
        title: "Na pravem mestu si.",
        body: (
          <div className="memo-onboarding-testimonial">
            <div>
              <strong>Študent financ</strong>
              <span>Univerza v Ljubljani</span>
            </div>
            <p>
              Nepogrešljivo za hiter tempo na fakulteti. V predavalnici sem bolj miren,
              ker vem, da lahko pozneje znova pregledam vse pomembne razlage.
            </p>
            <div className="memo-onboarding-stars" aria-label="5 od 5 zvezdic">
              ★★★★★
            </div>
          </div>
        ),
        action: "Nadaljuj",
      };
    }

    if (step === 11) {
      return {
        title: null,
        body: (
          <div className="memo-onboarding-progress-story">
            <h2>Naredil/a si prvi korak!</h2>
            <p>Z rednim delom ti Memo AI pomaga doseči dolgoročen napredek.</p>
            <div className="memo-onboarding-chart" aria-label="Primer napredka ocen">
              <div className="memo-onboarding-chart-header">
                <strong>Tvoje ocene</strong>
                <div>
                  <span className="memo-onboarding-legend-primary">z Memo AI</span>
                  <span className="memo-onboarding-legend-muted">samostojno</span>
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
        action: "Nadaljuj",
      };
    }

    if (step === 12) {
      return {
        title: "Kateri del Memo AI-ja ti bo najbolj pomagal?",
        body: (
          <div className="memo-onboarding-feature-grid">
            {FEATURE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`memo-onboarding-feature ${form.feature === option.value ? "selected" : ""}`}
                onClick={() => setForm((current) => ({ ...current, feature: option.value }))}
              >
                <span aria-hidden="true">{option.icon}</span>
                <strong>{option.label}</strong>
              </button>
            ))}
          </div>
        ),
        action: "Nadaljuj",
        disabled: !form.feature,
      };
    }

    if (step === 13) {
      return {
        title: "Imaš v mislih določen predmet ali izpit/test, pri katerem naj ti Memo AI pomaga?",
        body: renderOptionList(CLASS_FOCUS_OPTIONS, "classFocus"),
      };
    }

    return {
      title: "Kakšen je tvoj dnevni študijski cilj?",
      body: (
        <div className="memo-onboarding-option-list">
          {DAILY_GOAL_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`memo-onboarding-option ${form.dailyGoal === option.value ? "selected" : ""}`}
              onClick={() => {
                const nextForm = { ...form, dailyGoal: option.value };
                setForm(nextForm);
                window.setTimeout(() => {
                  void submitOnboarding(nextForm);
                }, 120);
              }}
              disabled={savingProfile}
            >
              <span className="memo-onboarding-option-icon" aria-hidden="true">
                <OnboardingOptionIcon icon={option.icon} />
              </span>
              <span>
                <strong>{option.label}</strong>
              </span>
            </button>
          ))}
        </div>
      ),
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
        throw new Error(payload.error ?? "Plačila ni bilo mogoče začeti.");
      }

      window.location.href = payload.url;
    } catch (error) {
      setBillingError(
        error instanceof Error ? error.message : "Plačila ni bilo mogoče začeti.",
      );
    } finally {
      setCheckoutPlan(null);
    }
  }

  const effectiveOnboardingComplete = onboardingComplete || previewOnboardingComplete;
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
              aria-label="Nazaj"
            >
              <ChevronLeft className="h-9 w-9" />
            </button>
            <div className="memo-onboarding-progress" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="memo-onboarding-content">
            {currentStep.title ? <h2>{currentStep.title}</h2> : null}
            {"copy" in currentStep && currentStep.copy ? <p>{currentStep.copy}</p> : null}
            {currentStep.body}
          </div>

          {"action" in currentStep && currentStep.action ? (
            <div className="memo-onboarding-actions">
              <button
                type="button"
                className={`memo-onboarding-pill-button ${currentStep.action === "Preskoči" ? "secondary" : ""}`}
                onClick={() => goNext()}
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
      {effectiveOnboardingComplete ? (
        <div className="app-start-dismiss-row">
          <button
            type="button"
            className="app-start-close-button"
            onClick={() => router.push("/app")}
            aria-label="Zapri ponudbo naročnine"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : null}

      <CheckoutBanner state={searchParams.get("checkout")} />
      {billingError ? <div className="app-start-banner">{billingError}</div> : null}

      <div className="memo-paywall-brand">
        <span className="memo-paywall-logo" aria-hidden="true">
          <Image
            src="/memo-logo.png"
            alt=""
            width={3651}
            height={3285}
            sizes="2.6rem"
            priority
          />
        </span>
        <span>Memo AI</span>
      </div>

      <h1 className="memo-paywall-title">Nadgradi in ustvarjaj več zapiskov</h1>

      <div className="memo-paywall-benefits">
        {[
          {
            title: "Neomejeni zapiski",
            copy: "Naloži neomejeno PDF-jev in zvoka",
            icon: "📝",
          },
          {
            title: "Pametna učna orodja",
            copy: "Personalizirane vaje za boljše rezultate",
            icon: "💡",
          },
          {
            title: "Uči se 10x hitreje",
            copy: "Pospeši učenje z AI podporo",
            icon: "⚡",
          },
        ].map((benefit) => (
          <div className="memo-paywall-benefit" key={benefit.title}>
            <span aria-hidden="true">{benefit.icon}</span>
            <div>
              <strong>{benefit.title}</strong>
              <p>{benefit.copy}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="memo-paywall-plan-grid" role="radiogroup" aria-label="Izberi paket">
        {paywallPlans.map((plan) => {
          const selected = selectedPaywallPlan === plan.id;
          const activePlan = subscription?.plan === plan.id && hasPaidAccess;
          const annualizedMonthly = monthlyPlan?.annualizedAmount ?? 0;
          const yearlySavings = annualizedMonthly > plan.annualizedAmount
            ? Math.round((1 - plan.annualizedAmount / annualizedMonthly) * 100)
            : 0;
          const displayPrice =
            plan.id === "yearly"
              ? `€${plan.displayAmount ?? plan.amount}`
              : `€${plan.displayAmount ?? plan.amount}`;
          const suffix = "/ mesec";
          const detail =
            plan.id === "yearly"
              ? `Obračunano letno: €${plan.annualizedAmount}`
              : "Obračunano mesečno";

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
                <span className="memo-paywall-plan-badge">Najbolj priljubljeno</span>
              ) : null}
              <span className="memo-paywall-plan-header">
                <strong>{plan.label}</strong>
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
                <span className="memo-paywall-save">Prihrani {yearlySavings}%</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <p className="memo-paywall-due">
        <CircleCheck className="h-5 w-5" />
        Danes brez plačila
      </p>

      <button
        type="button"
        className="memo-paywall-cta"
        onClick={() => startCheckout(selectedPaywallPlan)}
        disabled={checkoutPlan !== null || (subscription?.plan === selectedPaywallPlan && hasPaidAccess)}
      >
        {checkoutPlan === selectedPaywallPlan ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        {subscription?.plan === selectedPaywallPlan && hasPaidAccess
          ? "Trenutni paket"
          : "Začni 3-dnevni brezplačni preizkus"}
      </button>

      <div className="memo-paywall-foot">
        <span>
          <CircleCheck className="h-5 w-5" />
          Prekliči kadarkoli
        </span>
      </div>
    </section>
  );
}
