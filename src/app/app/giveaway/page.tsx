import { GiveawayScreen } from "@/components/giveaway-screen";
import { requireUser } from "@/lib/auth";
import { getViewerAppState } from "@/lib/billing";
import {
  ensureGiveawayCode,
  getGiveawayLeaderboard,
  getGiveawayProgress,
  readGiveawayReferralCookie,
} from "@/lib/giveaway";
import { getTranslations } from "@/lib/i18n/server";

/**
 * The back-to-school giveaway. The account's code is created here on the
 * first visit — one Stripe promotion code, kept for the campaign — so the
 * screen never shows an empty slot where the code should be.
 */
export default async function GiveawayPage() {
  const [user, appState, { t }] = await Promise.all([
    requireUser(),
    getViewerAppState(),
    getTranslations(),
  ]);

  const [code, progress, leaderboard, referralCode] = await Promise.all([
    ensureGiveawayCode({ userId: user.id, email: user.email ?? null }),
    getGiveawayProgress(user.id),
    getGiveawayLeaderboard({ viewerUserId: user.id, fallbackName: t("giveaway.anonymous") }),
    readGiveawayReferralCookie(),
  ]);

  return (
    <GiveawayScreen
      code={code.code}
      progress={progress}
      leaderboard={leaderboard}
      hasSubscription={Boolean(appState?.hasPaidAccess)}
      referralCode={referralCode}
    />
  );
}
