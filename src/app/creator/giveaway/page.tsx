import { GiveawayScreen } from "@/components/giveaway-screen";
import {
  GIVEAWAY_CAMPAIGN,
  GIVEAWAY_GOAL,
  findGiveawayWinner,
  giveawaySeedEntries,
  rankGiveawayEntries,
} from "@/lib/giveaway-shared";

/**
 * The demo runs the real giveaway screen on made-up standings, so creators
 * can record it. Nothing here polls or touches Stripe.
 */
export default async function CreatorDemoGiveawayPage({
  searchParams,
}: {
  searchParams: Promise<{ empty?: string; winner?: string }>;
}) {
  // `?empty=1` shows the screen before a code exists — the "Get my code"
  // button and no friends yet; `?winner=1` shows the giveaway once won.
  const { empty, winner } = await searchParams;
  const isEmpty = empty === "1";
  const hasWinner = winner === "1";
  const entries = rankGiveawayEntries([
    ...giveawaySeedEntries(),
    ...(isEmpty
      ? []
      : [
          {
            name: "Nika",
            qualifiedCount: hasWinner ? GIVEAWAY_GOAL : 5,
            reachedGoalAt: hasWinner ? "2026-09-28T18:20:00.000Z" : null,
            latestQualifiedAt: "2026-09-04T10:00:00.000Z",
          },
        ]),
  ]);

  return (
    <GiveawayScreen
      isDemo
      code={isEmpty ? null : "BTS-SAMPLE"}
      hasSubscription={hasWinner}
      progress={
        isEmpty
          ? { qualifiedCount: 0, pendingCount: 0 }
          : { qualifiedCount: hasWinner ? GIVEAWAY_GOAL : 5, pendingCount: hasWinner ? 0 : 1 }
      }
      leaderboard={{
        campaign: GIVEAWAY_CAMPAIGN,
        goal: GIVEAWAY_GOAL,
        entries,
        winner: findGiveawayWinner(entries),
        updatedAt: "2026-09-01T12:00:00.000Z",
      }}
    />
  );
}
