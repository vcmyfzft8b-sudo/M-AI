import type { MessageKey } from "./i18n/messages/keys";
import type { PaywallReason } from "./paywall-reasons";

/**
 * What the plan adds, ticked off in pen under the headline: three short items
 * for the screen nothing opened, and for each feature the ones that answer it.
 *
 * Shared by the paywall and its skeleton (`paywall-loading.tsx`), which sets
 * the same words in the page's ink so they take the room the real ones will.
 */
export const PAYWALL_CHECKLISTS: Record<PaywallReason | "plain", MessageKey[]> = {
  plain: ["paywall.check.unlimitedNotes", "paywall.check.everyTool", "paywall.check.tutorPodcasts"],
  note: ["paywall.check.everyLecture", "paywall.check.flashcards", "paywall.check.quizzes"],
  locked: ["paywall.check.allNotes", "paywall.check.everyTool", "paywall.check.tutor"],
  chat: ["paywall.check.everyNote", "paywall.check.noLimits", "paywall.check.instant"],
  listen: ["paywall.check.everyNote", "paywall.check.anywhere", "paywall.check.noLimits"],
  tutor: ["paywall.check.everyNote", "paywall.check.everyDay", "paywall.check.yourPace"],
  podcast: ["paywall.check.everyNote", "paywall.check.everyDay", "paywall.check.anywhere"],
  regenerate: ["paywall.check.flashcards", "paywall.check.mindMaps", "paywall.check.tests"],
  library: ["paywall.check.everySubject", "paywall.check.oneChat"],
  exam: ["paywall.check.studyPlan", "paywall.check.mockExams", "paywall.check.tutor"],
  offer: ["paywall.check.notes", "paywall.check.chat", "paywall.check.tutor"],
};

/** The headline: the feature's, or the browsing offer's "still your best price" when it did not improve. */
export function paywallTitleKey(reason: PaywallReason | null, improved: boolean): MessageKey {
  if (reason === "offer" && !improved) {
    return "paywall.reason.offer.titleBest";
  }

  return reason ? `paywall.reason.${reason}.title` : "paywall.title";
}
