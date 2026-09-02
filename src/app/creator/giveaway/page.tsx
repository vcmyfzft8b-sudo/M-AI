import { GiveawayScreen } from "@/components/giveaway-screen";
import { GIVEAWAY_CAMPAIGN, GIVEAWAY_GOAL } from "@/lib/giveaway-shared";

/**
 * The demo runs the real giveaway screen on made-up standings, so creators
 * can record it. Nothing here polls or touches Stripe.
 */
export default function CreatorDemoGiveawayPage() {
  return (
    <GiveawayScreen
      isDemo
      code="BTS-DEMO26"
      hasSubscription={false}
      progress={{ qualifiedCount: 7, pendingCount: 1 }}
      leaderboard={{
        campaign: GIVEAWAY_CAMPAIGN,
        goal: GIVEAWAY_GOAL,
        entries: [
          { name: "Zala K.", qualifiedCount: 12, reachedGoalAt: null },
          { name: "Jan P.", qualifiedCount: 9, reachedGoalAt: null },
          { name: "Nika", qualifiedCount: 7, reachedGoalAt: null, isViewer: true },
          { name: "ma***", qualifiedCount: 4, reachedGoalAt: null },
          { name: "Luka B.", qualifiedCount: 2, reachedGoalAt: null },
        ],
        winner: null,
        updatedAt: "2026-09-01T12:00:00.000Z",
      }}
    />
  );
}
