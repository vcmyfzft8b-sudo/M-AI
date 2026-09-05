import { GiveawayScreen } from "@/components/giveaway-screen";
import { requireUser } from "@/lib/auth";
import { getViewerAppState } from "@/lib/billing";
import {
  getGiveawayCode,
  getGiveawayLeaderboard,
  getGiveawayProgress,
  readGiveawayReferralCookie,
} from "@/lib/giveaway";
import { getTranslations } from "@/lib/i18n/server";

/**
 * The back-to-school giveaway. Accounts that finished onboarding after the
 * campaign began already hold a code; older ones see a button and get one
 * when they ask, so codes are only ever created for people who take part.
 */
export default async function GiveawayPage() {
  const [user, appState, { t }] = await Promise.all([
    requireUser(),
    getViewerAppState(),
    getTranslations(),
  ]);

  const [code, progress, leaderboard, referralCode] = await Promise.all([
    getGiveawayCode(user.id),
    getGiveawayProgress(user.id),
    getGiveawayLeaderboard({ fallbackName: t("giveaway.anonymous") }),
    readGiveawayReferralCookie(),
  ]);

  return (
    <GiveawayScreen
      code={code?.code ?? null}
      progress={progress}
      leaderboard={leaderboard}
      hasSubscription={Boolean(appState?.hasPaidAccess)}
      referralCode={referralCode}
    />
  );
}
