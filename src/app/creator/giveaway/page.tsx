import { GiveawayScreen } from "@/components/giveaway-screen";
import {
  GIVEAWAY_CAMPAIGN,
  GIVEAWAY_GOAL,
  giveawaySeedEntries,
  rankGiveawayEntries,
} from "@/lib/giveaway-shared";

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
      progress={{ qualifiedCount: 5, pendingCount: 1 }}
      leaderboard={{
        campaign: GIVEAWAY_CAMPAIGN,
        goal: GIVEAWAY_GOAL,
        entries: rankGiveawayEntries([
          ...giveawaySeedEntries(),
          {
            name: "Nika",
            qualifiedCount: 5,
            reachedGoalAt: null,
            latestQualifiedAt: "2026-09-04T10:00:00.000Z",
          },
        ]),
        winner: null,
        updatedAt: "2026-09-01T12:00:00.000Z",
      }}
    />
  );
}
