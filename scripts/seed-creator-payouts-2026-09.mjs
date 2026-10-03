/**
 * Records the September 2026 creator payout run on the Payouts page.
 *
 * Run once, after migration 0056 is live:
 *
 *   node scripts/seed-creator-payouts-2026-09.mjs          # dry run
 *   node scripts/seed-creator-payouts-2026-09.mjs --apply  # write
 *
 * The base pay is Klara's hand count of 30 September 2026 ("placilo" note),
 * with Pija's TikTok rate corrected from €5 to €10. The code bonus is 20% of
 * the cash each code collected in September (Europe/Ljubljana), read from
 * Stripe on 2 October 2026; no creator-code sale was refunded or disputed.
 *
 * It also adds the two creators Klara pays who were never in the dashboard
 * (Špela, Ema Kozelj), Neli's second account, and the per-video fee Klara
 * pays where the dashboard had none — only where nothing is set, so terms an
 * admin entered by hand are never overwritten.
 *
 * Payment details (Flik numbers, IBANs) are deliberately not in this file:
 * they go into each creator's "Payment details" field by hand.
 *
 * Idempotent: a payout line is keyed by creator, month and payee, and
 * re-running replaces the amounts without touching whether it was paid.
 */

import { createClient } from "@supabase/supabase-js";

const PERIOD = "2026-09-01";
const APPLY = process.argv.includes("--apply");

/** Creators Klara pays who have no dashboard row yet. */
const NEW_CREATORS = [
  {
    name: "Špela",
    slug: "spela",
    promo_codes: ["SPELA50"],
    rate_kind: "per_video",
    rate_amount: 5,
    revenue_share_percent: 20,
    account: { handle: "spelcaa41", content_mode: "dedicated" },
  },
  {
    name: "Ema Kozelj",
    slug: "ema-kozelj",
    promo_codes: [],
    rate_kind: "per_video",
    rate_amount: 5,
    revenue_share_percent: null,
    account: { handle: "emakozelj5", content_mode: "mixed" },
  },
];

/** Fees Klara pays that the dashboard did not record. Applied only when unset. */
const FILL_TERMS = [
  { slug: "ana", rate_kind: "per_video", rate_amount: 5 },
  { slug: "neli", rate_kind: "per_video", rate_amount: 5 },
];

/** Accounts a creator posts from that the dashboard was not watching. */
const EXTRA_ACCOUNTS = [{ slug: "neli", handle: "neligomolj2", content_mode: "dedicated" }];

const PAYOUTS = [
  { slug: "pija", base: 261, bonus: 187, note: "24 scripted TikToks × €10 + 21 Instagram posts × €1 · 20% of €935 via PIJA50 (22 sales)" },
  { slug: "neli", base: 80, bonus: 13, note: "16 videos × €5 (@neligomolj2) · 20% of €65 via NELI50" },
  { slug: "ema", base: 50, bonus: 13, note: "5 videos × €10 · 20% of €65 via EMA50" },
  { slug: "daily", base: 10, bonus: 43, note: "2 videos × €5 · 20% of €215 via ZALA50 (5 sales)" },
  { slug: "maja", base: 0, bonus: 41, note: "Code only · 20% of €205 via MAJA50 (4 sales)" },
  { slug: "spela", base: 35, bonus: 0, note: "7 videos × €5 · SPELA50 had no sales yet" },
  { slug: "ana", base: 15, bonus: 15, note: "3 videos × €5 · 20% of €75 via ANA50" },
  { slug: "martin-david", payee: "David", base: 16, bonus: 13, note: "€2 per 1000 views · 20% of €65 via DAVID50" },
  { slug: "martin-david", payee: "Martin", base: 2, bonus: 0, note: "€2 per 1000 views" },
  { slug: "megi", payee: "Mija", base: 0, bonus: 6.5, note: "Half of 20% of €65 via MIJAMEGI50 · no videos since the per-video deal" },
  { slug: "megi", payee: "Megi", base: 0, bonus: 6.5, note: "Half of 20% of €65 via MIJAMEGI50 · no videos since the per-video deal" },
  { slug: "ema-kozelj", base: 10, bonus: 0, note: "2 videos × €5 · her TikTok showed no videos on 2 Oct — check before paying" },
];

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const supabase = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

async function bySlug() {
  const { data, error } = await supabase
    .from("ugc_creators")
    .select("id, slug, name, rate_kind");

  if (error) {
    throw new Error(`Could not read creators: ${error.message}`);
  }

  return new Map(data.map((row) => [row.slug, row]));
}

async function main() {
  console.log(`${APPLY ? "Writing" : "Dry run —"} September 2026 payouts to ${process.env.NEXT_PUBLIC_SUPABASE_URL}\n`);

  let creators = await bySlug();

  // Every creator the run names must exist, or be one this script adds,
  // before anything is written: failing on line nine would leave the first
  // eight half-recorded.
  const known = new Set([...creators.keys(), ...NEW_CREATORS.map((row) => row.slug)]);
  const missing = [
    ...new Set(
      [...PAYOUTS, ...FILL_TERMS, ...EXTRA_ACCOUNTS]
        .map((entry) => entry.slug)
        .filter((slug) => !known.has(slug)),
    ),
  ];

  if (missing.length > 0) {
    throw new Error(`No creator with slug ${missing.map((slug) => `"${slug}"`).join(", ")} — nothing written.`);
  }

  for (const entry of NEW_CREATORS) {
    if (creators.has(entry.slug)) {
      continue;
    }

    console.log(`+ creator ${entry.name}`);

    if (!APPLY) {
      continue;
    }

    const { error } = await supabase.from("ugc_creators").insert({
      name: entry.name,
      slug: entry.slug,
      promo_codes: entry.promo_codes,
      rate_kind: entry.rate_kind,
      rate_amount: entry.rate_amount,
      revenue_share_percent: entry.revenue_share_percent,
      status: "active",
      kind: "creator",
      created_by: "script:seed-creator-payouts-2026-09",
    });

    if (error) {
      throw new Error(`Could not add ${entry.name}: ${error.message}`);
    }
  }

  if (APPLY) {
    creators = await bySlug();
  }

  // New creators' accounts go through the same idempotent path as the extra
  // ones, so a failed account insert is retried by the next run instead of
  // being skipped along with its already-created creator.
  const accounts = [
    ...NEW_CREATORS.map((entry) => ({ slug: entry.slug, ...entry.account })),
    ...EXTRA_ACCOUNTS,
  ];

  for (const entry of accounts) {
    const creator = creators.get(entry.slug);
    const name = creator?.name ?? NEW_CREATORS.find((row) => row.slug === entry.slug)?.name;
    // The unique index is on lower(handle), so the check must ignore case too.
    const { data: existing, error: lookupError } = await supabase
      .from("ugc_creator_accounts")
      .select("id")
      .eq("platform", "tiktok")
      .ilike("handle", entry.handle)
      .limit(1);

    if (lookupError) {
      throw new Error(`Could not look up @${entry.handle}: ${lookupError.message}`);
    }

    if (existing.length > 0) {
      continue;
    }

    console.log(`+ account @${entry.handle} for ${name}`);

    if (APPLY) {
      const { error } = await supabase.from("ugc_creator_accounts").insert({
        creator_id: creator.id,
        platform: "tiktok",
        handle: entry.handle,
        profile_url: `https://www.tiktok.com/@${entry.handle}`,
        content_mode: entry.content_mode,
        status: "active",
      });

      if (error) {
        throw new Error(`Could not add @${entry.handle}: ${error.message}`);
      }
    }
  }

  for (const entry of FILL_TERMS) {
    const creator = creators.get(entry.slug);

    if (!creator || creator.rate_kind) {
      continue;
    }

    console.log(`~ ${creator.name}: €${entry.rate_amount} ${entry.rate_kind}`);

    if (APPLY) {
      const { error } = await supabase
        .from("ugc_creators")
        .update({ rate_kind: entry.rate_kind, rate_amount: entry.rate_amount })
        .eq("id", creator.id);

      if (error) {
        throw new Error(`Could not set ${creator.name}'s fee: ${error.message}`);
      }
    }
  }

  let total = 0;

  for (const entry of PAYOUTS) {
    const creator = creators.get(entry.slug);
    const name =
      creator?.name ?? NEW_CREATORS.find((row) => row.slug === entry.slug)?.name ?? entry.slug;
    const label = (entry.payee ?? name).padEnd(12);
    total += Math.round((entry.base + entry.bonus) * 100);

    console.log(`  ${label} base €${entry.base.toFixed(2).padStart(6)}  bonus €${entry.bonus.toFixed(2).padStart(6)}  = €${(entry.base + entry.bonus).toFixed(2)}`);

    if (!APPLY) {
      continue;
    }

    const { error } = await supabase.from("ugc_creator_payouts").upsert(
      {
        creator_id: creator.id,
        period: PERIOD,
        payee: entry.payee ?? "",
        base_amount: entry.base,
        bonus_amount: entry.bonus,
        note: entry.note,
        created_by: "script:seed-creator-payouts-2026-09",
      },
      { onConflict: "creator_id,period,payee" },
    );

    if (error) {
      throw new Error(`Could not save ${entry.slug}: ${error.message}`);
    }
  }

  console.log(`\nTotal €${(total / 100).toFixed(2)}${APPLY ? " — written." : " — nothing written; add --apply."}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
