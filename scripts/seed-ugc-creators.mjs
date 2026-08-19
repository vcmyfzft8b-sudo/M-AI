/**
 * Seeds the UGC campaign creators, collects their recent TikTok posts, and
 * backfills the view history.
 *
 * Run it once after migration 0027 has been applied:
 *
 *   node --experimental-strip-types scripts/seed-ugc-creators.mjs
 *   node --experimental-strip-types scripts/seed-ugc-creators.mjs --sync
 *   node --experimental-strip-types scripts/seed-ugc-creators.mjs --sync --days 14
 *
 * Without `--sync` it only writes the creator rows, which is the safe default.
 * With `--sync` it also runs an Apify collection (which spends Apify credit),
 * ingests the results, and seeds each video's history at the day it was posted.
 *
 * Detection, date handling and TikTok link parsing are imported from the app so
 * this script and the dashboard can never disagree about what counts.
 */

import { createClient } from "@supabase/supabase-js";

import { todayInReportZone } from "../src/lib/admin/ranges.ts";
import { classifyVideo } from "../src/lib/ugc/classification.ts";
import { parseTikTokProfile } from "../src/lib/ugc/tiktok.ts";

const APIFY_ACTOR = "clockworks~tiktok-scraper";

/**
 * The campaign roster.
 *
 * `mode` is a starting guess, editable per account in the dashboard: accounts
 * whose handle carries the brand are dedicated, the rest are personal accounts
 * that only sometimes post Memo AI content.
 *
 * `promoCodes` were read out of the creators' own captions in a live collection
 * and cross-checked against the promotion codes in Stripe, except where noted.
 * Three creators had no code that could be established either way and are left
 * blank on purpose rather than guessed; add theirs from the creator's page.
 */
const CREATORS = [
  // The brand's own account. Marked `owned` so its very real views and revenue
  // stay countable without being ranked against the creators being paid to post.
  {
    name: "Memo AI (brand)",
    links: ["https://www.tiktok.com/@memo_ai_si"],
    mode: "dedicated",
    kind: "owned",
    promoCodes: ["MEMO50"],
  },
  // MAVIJA50 exists in Stripe but has not appeared in a caption yet; unconfirmed.
  { name: "Mavija", links: ["https://www.tiktok.com/@mavija94"], mode: "mixed", promoCodes: ["MAVIJA50"] },
  { name: "Maja", links: ["https://www.tiktok.com/@mt_memoai"], mode: "dedicated", promoCodes: ["MAJA50"] },
  { name: "Megi", links: ["https://www.tiktok.com/@mm.memoai"], mode: "dedicated", promoCodes: ["MIJAMEGI50"] },
  {
    name: "Martin & David",
    links: ["https://www.tiktok.com/@memo_ai_sii"],
    mode: "dedicated",
    promoCodes: ["MARTIN50", "DAVID50"],
  },
  { name: "Milos", links: ["https://www.tiktok.com/@limkaema"], mode: "mixed", promoCodes: ["LIMKA50"] },
  // LEILA50 has real redemptions in Stripe; her Memo AI posts predate the last
  // 30 on the account, so raise --per-profile to pull them in.
  { name: "Leila", links: ["https://www.tiktok.com/@dejnehino"], mode: "mixed", promoCodes: ["LEILA50"] },
  { name: "Ema", links: ["https://www.tiktok.com/@eemadilema"], mode: "mixed", promoCodes: ["EMA50"] },
  { name: "Ana", links: ["https://www.tiktok.com/@ma_anamana"], mode: "mixed", promoCodes: ["ANA50"] },
  { name: "Pija", links: ["https://www.tiktok.com/@studywithpija"], mode: "mixed", promoCodes: ["PIJA50"] },
  { name: "Daily", links: ["https://www.tiktok.com/@jz.daily"], mode: "mixed", promoCodes: ["ZALA50"] },
  // No code found in Lara's captions and none in Stripe matches her name.
  { name: "Lara", links: ["https://www.tiktok.com/@lara_memoai"], mode: "dedicated", promoCodes: [] },
  // Same for Klara: her posts carry #memoai but never a discount code.
  { name: "Klara", links: ["https://www.tiktok.com/@rubissiti"], mode: "mixed", promoCodes: [] },
  { name: "Tara", links: ["https://www.tiktok.com/@studiesbytara"], mode: "mixed", promoCodes: ["TARA50"] },
  { name: "Zoja", links: ["https://www.tiktok.com/@zoja.vajda"], mode: "mixed", promoCodes: ["ZOJA50"] },
];

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function slugify(value) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "creator"
  );
}

function readArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function seedCreators(supabase) {
  let created = 0;
  let existing = 0;

  for (const entry of CREATORS) {
    const parsed = entry.links
      .map((link) => parseTikTokProfile(link))
      .filter(Boolean);

    if (parsed.length === 0) {
      log(`  ! ${entry.name}: no readable TikTok link, skipped`);
      continue;
    }

    // Idempotent on the account handle, which is the thing that must be unique.
    const { data: alreadyTracked } = await supabase
      .from("ugc_creator_accounts")
      .select("id, creator_id")
      .eq("platform", "tiktok")
      .ilike("handle", parsed[0].handle)
      .maybeSingle();

    if (alreadyTracked) {
      existing += 1;
      log(`  = ${entry.name} (@${parsed[0].handle}) already tracked`);
      continue;
    }

    const { data: creator, error } = await supabase
      .from("ugc_creators")
      .insert({
        name: entry.name,
        slug: slugify(entry.name),
        status: "active",
        kind: entry.kind ?? "creator",
        promo_codes: entry.promoCodes,
        created_by: "script:seed-ugc-creators",
      })
      .select("id")
      .single();

    if (error) {
      log(`  ! ${entry.name}: ${error.message}`);
      continue;
    }

    const { error: accountError } = await supabase
      .from("ugc_creator_accounts")
      .insert(
        parsed.map((profile) => ({
          creator_id: creator.id,
          platform: "tiktok",
          handle: profile.handle,
          profile_url: profile.profileUrl,
          content_mode: entry.mode,
          status: "active",
        })),
      );

    if (accountError) {
      await supabase.from("ugc_creators").delete().eq("id", creator.id);
      log(`  ! ${entry.name}: ${accountError.message}`);
      continue;
    }

    created += 1;
    log(
      `  + ${entry.name} (@${parsed.map((p) => p.handle).join(", @")}) [${entry.mode}]${
        entry.promoCodes.length ? ` ${entry.promoCodes.join(", ")}` : " no promo code"
      }`,
    );
  }

  return { created, existing };
}

async function apify(path, { token, method = "GET", body }) {
  const url = new URL(`https://api.apify.com/v2${path}`);
  url.searchParams.set("token", token);

  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(
      `Apify ${method} ${path} failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
  }

  return response.json();
}

async function collect(token, handles, maxPerProfile) {
  log(`\nStarting Apify run for ${handles.length} accounts…`);

  const run = await apify(`/acts/${APIFY_ACTOR}/runs`, {
    token,
    method: "POST",
    body: {
      profiles: handles,
      resultsPerPage: maxPerProfile,
      profileScrapeSections: ["videos"],
      profileSorting: "latest",
      excludePinnedPosts: false,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadAvatars: false,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false,
    },
  });

  const runId = run.data.id;
  log(`  run ${runId}`);

  // Poll until the run settles, with a hard ceiling so this cannot hang.
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const status = await apify(`/actor-runs/${runId}`, { token });
    const state = status.data.status;

    if (attempt % 6 === 0) {
      log(`  ${state}…`);
    }

    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(state)) {
      if (state !== "SUCCEEDED") {
        throw new Error(`Apify run ended as ${state}`);
      }

      const items = await apify(
        `/datasets/${status.data.defaultDatasetId}/items?clean=true&format=json&limit=1000`,
        { token },
      );

      log(`  collected ${items.length} posts`);
      return items;
    }
  }

  throw new Error("Apify run did not finish within 10 minutes.");
}

function normalizeItem(item) {
  const author = item.authorMeta ?? {};
  const handle = (author.name ?? item.input ?? "").replace(/^@/, "");

  if (!item.id || !handle) {
    return null;
  }

  const hashtags = Array.isArray(item.hashtags)
    ? item.hashtags.map((tag) => tag?.name).filter(Boolean).map((tag) => tag.toLowerCase())
    : [];

  const detailed = Array.isArray(item.detailedMentions)
    ? item.detailedMentions.map((mention) => mention?.name).filter(Boolean)
    : [];
  const plain = Array.isArray(item.mentions) ? item.mentions.filter(Boolean) : [];

  return {
    platformVideoId: String(item.id),
    handle,
    url: item.webVideoUrl ?? `https://www.tiktok.com/@${handle}/video/${item.id}`,
    caption: item.text ?? null,
    hashtags: [...new Set(hashtags)],
    mentions: [...new Set([...detailed, ...plain].map((m) => String(m).toLowerCase()))],
    coverUrl: item.videoMeta?.coverUrl ?? null,
    durationSeconds: item.videoMeta?.duration ?? null,
    postedAt:
      item.createTimeISO ??
      (item.createTime ? new Date(item.createTime * 1000).toISOString() : null),
    views: Math.max(0, Math.round(item.playCount ?? 0)),
    likes: Math.max(0, Math.round(item.diggCount ?? 0)),
    comments: Math.max(0, Math.round(item.commentCount ?? 0)),
    shares: Math.max(0, Math.round(item.shareCount ?? 0)),
    saves: Math.max(0, Math.round(item.collectCount ?? 0)),
    author,
  };
}

async function ingest(supabase, items, backfillDays) {
  const { data: accountRows } = await supabase
    .from("ugc_creator_accounts")
    .select("*, creator:ugc_creators!inner(id, promo_codes)");

  const accounts = new Map(
    (accountRows ?? []).map((account) => [account.handle.toLowerCase(), account]),
  );

  const { data: ruleRows } = await supabase
    .from("ugc_classification_rules")
    .select("kind, pattern, weight")
    .eq("active", true);

  const rules = (ruleRows ?? []).map((rule) => ({
    kind: rule.kind,
    pattern: rule.pattern,
    weight: Number(rule.weight),
  }));

  const today = todayInReportZone();
  const cutoff = new Date(Date.now() - backfillDays * 24 * 60 * 60 * 1000);

  let stored = 0;
  let counted = 0;
  let review = 0;
  let seeded = 0;

  for (const raw of items) {
    if (raw?.error) {
      continue;
    }

    const item = normalizeItem(raw);

    if (!item) {
      continue;
    }

    const account = accounts.get(item.handle.toLowerCase());

    if (!account) {
      continue;
    }

    const result = classifyVideo(
      {
        caption: item.caption,
        hashtags: item.hashtags,
        mentions: item.mentions,
        contentMode: account.content_mode,
        promoCodes: account.creator?.promo_codes ?? [],
      },
      rules,
    );

    if (result.classification === "memo") {
      counted += 1;
    } else if (result.classification === "unknown") {
      review += 1;
    }

    const { data: video, error } = await supabase
      .from("ugc_videos")
      .upsert(
        {
          account_id: account.id,
          creator_id: account.creator_id,
          platform: "tiktok",
          platform_video_id: item.platformVideoId,
          url: item.url,
          caption: item.caption,
          hashtags: item.hashtags,
          mentions: item.mentions,
          cover_url: item.coverUrl,
          duration_seconds: item.durationSeconds,
          posted_at: item.postedAt,
          views: item.views,
          likes: item.likes,
          comments: item.comments,
          shares: item.shares,
          saves: item.saves,
          classification: result.classification,
          classification_source: result.source,
          classification_confidence: result.confidence,
          classification_reason: result.reason,
          classified_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "platform,platform_video_id" },
      )
      .select("id")
      .single();

    if (error || !video) {
      continue;
    }

    stored += 1;

    const snapshot = {
      video_id: video.id,
      account_id: account.id,
      creator_id: account.creator_id,
      views: item.views,
      likes: item.likes,
      comments: item.comments,
      shares: item.shares,
      saves: item.saves,
      captured_at: new Date().toISOString(),
    };

    // Today's reading.
    await supabase
      .from("ugc_video_stats")
      .upsert({ ...snapshot, captured_on: today }, { onConflict: "video_id,captured_on" });

    // History seed at the post date. TikTok does not publish what a video's
    // view count was on a past day, so the honest reconstruction is to credit
    // the views we found to the day the video went up.
    const postedAt = item.postedAt ? new Date(item.postedAt) : null;

    if (postedAt && postedAt >= cutoff) {
      const postedDay = todayInReportZone(postedAt);

      if (postedDay < today) {
        await supabase.from("ugc_video_stats").upsert(
          { ...snapshot, captured_on: postedDay },
          { onConflict: "video_id,captured_on", ignoreDuplicates: true },
        );
        seeded += 1;
      }
    }

    // Refresh the account counters from the same payload.
    await supabase
      .from("ugc_creator_accounts")
      .update({
        display_name: item.author.nickName ?? account.display_name,
        avatar_url: item.author.avatar ?? account.avatar_url,
        bio: item.author.signature ?? account.bio,
        platform_account_id: item.author.id ?? account.platform_account_id,
        follower_count: item.author.fans ?? account.follower_count,
        following_count: item.author.following ?? account.following_count,
        total_likes: item.author.heart ?? account.total_likes,
        video_count: item.author.video ?? account.video_count,
        last_synced_at: new Date().toISOString(),
        last_sync_status: "ok",
        last_sync_error: null,
      })
      .eq("id", account.id);

    await supabase.from("ugc_account_stats").upsert(
      {
        account_id: account.id,
        creator_id: account.creator_id,
        captured_on: today,
        follower_count: item.author.fans ?? null,
        total_likes: item.author.heart ?? null,
        video_count: item.author.video ?? null,
        captured_at: new Date().toISOString(),
      },
      { onConflict: "account_id,captured_on" },
    );
  }

  return { stored, counted, review, seeded };
}

async function main() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  log(`Seeding creators into ${supabaseUrl}`);
  const seedResult = await seedCreators(supabase);
  log(`\n${seedResult.created} created, ${seedResult.existing} already present.`);

  if (!process.argv.includes("--sync")) {
    log("\nPass --sync to also collect posts and backfill the view history.");
    return;
  }

  const token = requireEnv("APIFY_TOKEN");
  const days = Number(readArg("--days", "14"));
  const perProfile = Number(readArg("--per-profile", "40"));

  const { data: accounts } = await supabase
    .from("ugc_creator_accounts")
    .select("handle")
    .eq("platform", "tiktok")
    .eq("status", "active");

  const handles = [...new Set((accounts ?? []).map((account) => account.handle))];

  if (handles.length === 0) {
    log("No active accounts to collect.");
    return;
  }

  const items = await collect(token, handles, perProfile);
  const result = await ingest(supabase, items, days);

  log(
    [
      "",
      `Stored ${result.stored} posts.`,
      `  ${result.counted} detected as Memo AI content`,
      `  ${result.review} need a manual decision in the dashboard`,
      `  ${result.seeded} given a history entry at their post date (last ${days} days)`,
      "",
      "Note: TikTok publishes only a video's current view count, never what it",
      "was on a past day. Days before this run therefore show views credited to",
      "the day each video was posted; true day-over-day accrual starts now.",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
