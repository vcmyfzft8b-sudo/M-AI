import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createTranslator } from "../src/lib/i18n/translate.ts";
import { LOCALES } from "../src/lib/i18n/locales.ts";
import { sl } from "../src/lib/i18n/messages/sl.ts";
import { en } from "../src/lib/i18n/messages/en.ts";
import { hr } from "../src/lib/i18n/messages/hr.ts";
import { bs } from "../src/lib/i18n/messages/bs.ts";
import { sr } from "../src/lib/i18n/messages/sr.ts";
import { buildAcceptanceEmail } from "../src/lib/ugc/acceptance-email.ts";
import {
  applicationSchema,
  invalidFields,
  marketForApplication,
  normalizeReferrer,
  videoEmbedUrl,
} from "../src/lib/ugc/creator-application.ts";
import { CREATOR_DISCORD_INVITES, CREATOR_TERMS } from "../src/lib/ugc/creator-campaigns.ts";
import {
  MARKET_COUNTRIES,
  PLAN_LIST_PRICES,
  codeSaleBonus,
  PAID_VIDEOS_PER_MONTH,
  VIDEO_RANGE,
  VIEW_STEPS,
  campaignLocale,
  defaultMarket,
  estimateEarnings,
  marketForCountry,
  perVideoTotal,
  tierRanges,
} from "../src/lib/ugc/creator-program.ts";
import { CREATOR_TERMS_VERSION, creatorTermsMarkdown } from "../src/lib/ugc/creator-terms.ts";

const CATALOGUES = { sl, en, hr, bs, sr };

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

test("the published pay is what was agreed: per platform, 60 videos a month", () => {
  // Slovenia: €5 on TikTok + €1 more on Instagram, and 20% of code sales.
  assert.deepEqual(CREATOR_TERMS.si, { perTikTok: 5, perInstagram: 1, codeSharePercent: 20, viewRatePer1k: 0, bonusCap: 2000 });
  // Balkans: €7 on TikTok + €5 more on Instagram (€12), and €1 per 1,000 views up to €2,000.
  assert.deepEqual(CREATOR_TERMS.balkans, { perTikTok: 7, perInstagram: 5, codeSharePercent: 0, viewRatePer1k: 1, bonusCap: 2000 });
  assert.equal(perVideoTotal(CREATOR_TERMS.si), 6);
  assert.equal(perVideoTotal(CREATOR_TERMS.balkans), 12);
  assert.equal(PAID_VIDEOS_PER_MONTH, 60);
});

test("the Balkan view bonus pays €1 per thousand views and stops at the cap", () => {
  assert.deepEqual(estimateEarnings(CREATOR_TERMS.balkans, 60, 500_000), {
    tiktokPay: 420,
    instagramPay: 300,
    videoPay: 720,
    bonus: 500,
    total: 1220,
    capped: false,
  });

  const capped = estimateEarnings(CREATOR_TERMS.balkans, 60, 5_000_000);
  assert.equal(capped.bonus, 2000);
  assert.equal(capped.capped, true);
  assert.equal(capped.total, 60 * 12 + 2000);
});

test("the Slovenian code bonus is capped at €2,000 a month too", () => {
  const estimate = estimateEarnings(CREATOR_TERMS.si, 60, 5_000_000);

  assert.equal(estimate.bonus, 2000);
  assert.equal(estimate.capped, true);
  assert.equal(estimate.total, 60 * 6 + 2000);
  assert.match(creatorTermsMarkdown("en", "si"), /up to \*\*€2,000 a month\*\*/);
});

test("videos past the monthly cap earn nothing more", () => {
  assert.equal(estimateEarnings(CREATOR_TERMS.si, 90, 0).videoPay, 60 * 6);
  assert.equal(estimateEarnings(CREATOR_TERMS.balkans, 61, 0).videoPay, 60 * 12);
});

test("a code sale earns 20% of the discounted price: €2 monthly, €13 yearly", () => {
  assert.equal(codeSaleBonus(CREATOR_TERMS.si, "monthly"), 2);
  assert.equal(codeSaleBonus(CREATOR_TERMS.si, "yearly"), 13);

  // The list prices must be the ones the app charges.
  const billing = readSource("src/lib/billing.ts");
  assert.match(billing, new RegExp(`monthly: \\{[^}]*amount: ${PLAN_LIST_PRICES.monthly},`, "s"));
  assert.match(billing, new RegExp(`yearly: \\{[^}]*amount: ${PLAN_LIST_PRICES.yearly},`, "s"));
});

test("the Slovenian code bonus estimate is one sale per 10,000 views, one in three yearly", () => {
  // 500k views -> 50 sales; (2/3 x €2 + 1/3 x €13) = €5.67 a sale -> €283.
  const estimate = estimateEarnings(CREATOR_TERMS.si, 60, 500_000);
  assert.equal(estimate.tiktokPay, 300);
  assert.equal(estimate.instagramPay, 60);
  assert.equal(estimate.bonus, 283);
  assert.equal(estimate.total, 643);
  assert.equal(estimateEarnings(CREATOR_TERMS.si, 0, 0).total, 0);
});

test("tier ranges come from the calculator's own arithmetic, the top tier open-ended", () => {
  for (const market of ["si", "balkans"]) {
    const tiers = tierRanges(CREATOR_TERMS[market]);

    assert.deepEqual(tiers.map((tier) => tier.key), ["beginner", "experienced", "ultra"]);
    assert.equal(tiers[2].high, null);

    for (const tier of tiers.slice(0, 2)) {
      assert.ok(tier.low < tier.high, `${market} ${tier.key} range is inverted`);
    }

    // Each tier starts above the last one.
    assert.ok(tiers[0].low < tiers[1].low && tiers[1].low < tiers[2].low);
  }

  assert.equal(tierRanges(CREATOR_TERMS.balkans)[2].videos, PAID_VIDEOS_PER_MONTH);
  assert.equal(tierRanges(CREATOR_TERMS.balkans)[2].low, 2700);
});

test("the views slider stops at 2M, where the Balkan view bonus hits its cap", () => {
  const top = VIEW_STEPS[VIEW_STEPS.length - 1];
  assert.equal(top, 2_000_000);
  assert.equal(CREATOR_TERMS.balkans.viewRatePer1k * (top / 1000), CREATOR_TERMS.balkans.bonusCap);
});

test("the calculator never offers more paid videos than the terms pay for", () => {
  assert.equal(VIDEO_RANGE.max, PAID_VIDEOS_PER_MONTH);
});

test("the IP country picks the campaign, and nothing the visitor controls can change it", () => {
  assert.equal(marketForCountry("SI"), "si");

  for (const country of ["HR", "BA", "RS", "ME", "MK", "hr"]) {
    assert.equal(marketForCountry(country), "balkans");
  }

  assert.equal(marketForCountry("DE"), null);
  assert.equal(marketForApplication("ZZ"), "other");
  // The IP country alone decides; anyone not on a Balkan IP gets Slovenia.
  assert.equal(defaultMarket("HR"), "balkans");
  assert.equal(defaultMarket("SI"), "si");
  assert.equal(defaultMarket("DE"), "si");
  assert.equal(defaultMarket(null), "si");
});

test("each campaign's Discord is the invite checked against Discord's API", () => {
  // Dur6dfF2qD resolves to "UGC Memo AI - Balkan", 4mae76zNhj to "UGC Memo AI +".
  assert.equal(CREATOR_DISCORD_INVITES.balkans, "https://discord.gg/Dur6dfF2qD");
  assert.equal(CREATOR_DISCORD_INVITES.si, "https://discord.gg/4mae76zNhj");
});

const VALID = {
  firstName: "Ana",
  lastName: "Novak",
  email: " Ana@Example.com ",
  phone: "+386 41 123 456",
  country: "SI",
  age: "19",
  referralCode: "pija50",
  sampleVideoPath: "",
  sampleVideoUrl: "https://www.tiktok.com/@ana.studira/video/7400000000000000000",
  followedInstructions: true,
  titleVisible: true,
  notRandom: true,
  consent: true,
};

test("an application is accepted with a link instead of an upload, and normalised on the way in", () => {
  const parsed = applicationSchema.parse(VALID);

  assert.equal(parsed.email, "ana@example.com");
  assert.equal(parsed.referralCode, "PIJA50");
  assert.equal(parsed.age, 19);
  assert.equal(parsed.sampleVideoPath, null);
});

test("the three confirmations and consent are all required, as on the form", () => {
  for (const field of ["followedInstructions", "titleVisible", "notRandom", "consent"]) {
    assert.deepEqual(invalidFields({ ...VALID, [field]: false }), [field], field);
  }
});

test("details need a legal name and a phone number; the referral code is optional", () => {
  assert.deepEqual(invalidFields({ ...VALID, firstName: " ", lastName: "", phone: "abc" }), ["firstName", "lastName", "phone"]);
  assert.deepEqual(invalidFields({ ...VALID, referralCode: "" }), []);
  assert.deepEqual(invalidFields({ ...VALID, referralCode: "not a code!" }), ["referralCode"]);
});

test("an application needs a video: an upload, a link, or both", () => {
  assert.deepEqual(invalidFields({ ...VALID, sampleVideoUrl: "" }), ["sampleVideo"]);
  // Reported on its own step even while the confirmations further on are still empty.
  assert.deepEqual(invalidFields({ ...VALID, sampleVideoUrl: "", consent: false }, ["sampleVideo", "sampleVideoUrl"]), [
    "sampleVideo",
  ]);

  const uploaded = { ...VALID, sampleVideoUrl: "", sampleVideoPath: "pending/0b9a1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4.mov" };
  assert.deepEqual(invalidFields(uploaded), []);
});

test("an upload path is only ever one the server could have named", () => {
  for (const path of ["../secret.mp4", "pending/x.mp4", "approved/0b9a1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4.mp4"]) {
    assert.ok(invalidFields({ ...VALID, sampleVideoPath: path }).includes("sampleVideoPath"), path);
  }
});

test("the form reports a step's own mistakes in the order it shows them", () => {
  const failed = invalidFields({ ...VALID, firstName: "", email: "nope", consent: false }, ["firstName", "email", "country"]);

  assert.deepEqual(failed, ["firstName", "email"]);
});

test("referrers are cleaned rather than trusted", () => {
  assert.equal(normalizeReferrer("instagram-story"), "instagram-story");
  assert.equal(normalizeReferrer("<script>"), null);
  assert.equal(normalizeReferrer(["a"]), null);
});

test("sample-video links become players the admin can embed", () => {
  assert.equal(
    videoEmbedUrl("https://www.tiktok.com/@ana/video/7400000000000000000?is_from_webapp=1"),
    "https://www.tiktok.com/embed/v2/7400000000000000000",
  );
  assert.equal(videoEmbedUrl("https://www.instagram.com/reel/C9abcDEF12/"), "https://www.instagram.com/reel/C9abcDEF12/embed");
  assert.equal(videoEmbedUrl("https://youtu.be/dQw4w9WgXcQ"), "https://www.youtube.com/embed/dQw4w9WgXcQ");
  assert.equal(videoEmbedUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "https://www.youtube.com/embed/dQw4w9WgXcQ");
  assert.equal(
    videoEmbedUrl("https://drive.google.com/file/d/1AbCdEf/view?usp=sharing"),
    "https://drive.google.com/file/d/1AbCdEf/preview",
  );
  assert.equal(videoEmbedUrl("https://vm.tiktok.com/ZMabc/"), null);
  assert.equal(videoEmbedUrl("not a url"), null);
});

test("each campaign's form only offers that campaign's countries", () => {
  assert.deepEqual(MARKET_COUNTRIES.si, ["SI"]);
  assert.deepEqual([...MARKET_COUNTRIES.balkans].sort(), ["BA", "HR", "ME", "MK", "RS"]);
});

test("the terms name Memo AI's registered company, never the template's", () => {
  for (const locale of LOCALES) {
    for (const market of ["si", "balkans"]) {
    const terms = creatorTermsMarkdown(locale, market);

    assert.match(terms, /Memo AI, Nace Valenčič s\.p\., poslovno svetovanje/);
    assert.match(terms, /Zgoša 87, 4275 Begunje na Gorenjskem/);
    assert.match(terms, /7578474000/);
    assert.match(terms, /52958248/);
    assert.match(terms, new RegExp(CREATOR_TERMS_VERSION));
    assert.doesNotMatch(terms, /Kismo|Sideshift|Parakeet|MegaSheet|Megasheet|astrolog/i, locale);
    assert.doesNotMatch(terms, /\{\w+\}|<!--/, `${locale} left a placeholder or marker`);
    }
  }
});

test("each campaign's terms show its own pay and never the other's", () => {
  const si = creatorTermsMarkdown("en", "si");
  const balkans = creatorTermsMarkdown("en", "balkans");

  assert.match(si, /€5 for every Eligible Video published on TikTok/);
  assert.match(si, /€1 more/);
  assert.match(si, /20% bonus/);
  assert.match(si, /60 Eligible Videos per calendar month/);
  assert.doesNotMatch(si, /€7|€12|per 1,000 Views|Balkans|Croatia\b/);

  assert.match(balkans, /€7 for every Eligible Video published on TikTok/);
  assert.match(balkans, /€5 more/);
  assert.match(balkans, /€1 per 1,000 Views/);
  assert.match(balkans, /€2,000 a month/);
  assert.doesNotMatch(balkans, /Slovenia campaign|Slovenia Campaign|20% bonus|Discount Code/);

  for (const locale of LOCALES) {
    assert.doesNotMatch(creatorTermsMarkdown(locale, "si"), /€\s?7|7\s?€|12\s?€|€\s?12/, `${locale} Slovenian terms show Balkan pay`);
  }
});

test("each campaign has its own link, guarded by IP country, never chosen on the page", () => {
  const page = readSource("src/components/ugc/creator-program.tsx");
  assert.doesNotMatch(page, /role="radiogroup"|setMarket/);
  // One language per campaign page: no language switch to reach the other campaign through.
  assert.doesNotMatch(page, /LocaleOptionList|useLocaleChange|LanguageMenu/);
  // The other campaign's link never reaches the page.
  assert.doesNotMatch(page, /\/ugc\/(?:slovenija|balkan)/);

  const resolver = readSource("src/lib/ugc/creator-market.server.ts");
  assert.match(resolver, /GEO_COUNTRY_HEADER/);
  // The language (cookie) must not be an input: switching to Croatian must not reveal the Balkan page.
  assert.doesNotMatch(resolver, /getLocale|LOCALE_COOKIE|cookies\(\)/);
  // A visitor from the other campaign's country is redirected; only an allowlisted admin may stay.
  assert.match(resolver, /redirect\(/);
  assert.match(resolver, /getAdminContext/);

  for (const [route, market] of [
    ["src/app/ugc/slovenija/page.tsx", "si"],
    ["src/app/ugc/balkan/page.tsx", "balkans"],
    ["src/app/ugc/slovenija/pogoji/page.tsx", "si"],
    ["src/app/ugc/balkan/uvjeti/page.tsx", "balkans"],
  ]) {
    assert.match(readSource(route), new RegExp(`market="${market}"|\\("${market}"\\)`), route);
  }

  const shared = readSource("src/components/ugc/creator-campaign-page.tsx");
  assert.equal(shared.match(/guardCampaignPage\(/g)?.length, 2, "both the page and its terms are guarded");
  // The campaign's language is forced without touching the visitor's own language cookie.
  assert.match(shared, /persist=\{false\}/);

  const route = readSource("src/app/api/ugc/applications/route.ts");
  assert.match(route, /await ipCampaign\(\)\) \?\?/);
  assert.match(route, /MARKET_COUNTRIES\[market\]\.includes/);
});

test("each campaign speaks one language: Slovenian, or the visitor's Balkan language", () => {
  assert.equal(campaignLocale("si"), "sl");
  assert.equal(campaignLocale("si", "HR"), "sl");
  assert.equal(campaignLocale("si", "hr"), "sl");
  assert.equal(campaignLocale("balkans"), "hr");
  assert.equal(campaignLocale("balkans", "SI"), "hr");
  assert.equal(campaignLocale("balkans", "BA"), "bs");
  assert.equal(campaignLocale("balkans", "RS"), "sr");
  assert.equal(campaignLocale("balkans", "ME"), "sr");
  assert.equal(campaignLocale("balkans", "sr"), "sr");
  assert.equal(campaignLocale("balkans", "en"), "hr");
});

test("the showcase is a mix of creators, shuffled on every visit", () => {
  const showcase = readSource("src/lib/ugc/creator-showcase.ts");
  assert.match(showcase, /return shuffleShowcase\(await cachedShowcaseVideos\(\)/);
  assert.match(showcase, /PER_CREATOR/);
});

test("every language's terms carry the same numbered clauses", () => {
  const clauses = (markdown) => [...markdown.matchAll(/^(?:## (\d+)\.|(\d+\.\d+) )/gm)].map((match) => match[1] ?? match[2]);
  for (const market of ["si", "balkans"]) {
    const reference = clauses(creatorTermsMarkdown("sl", market));

    for (const locale of LOCALES) {
      assert.deepEqual(clauses(creatorTermsMarkdown(locale, market)), reference, `${locale} terms are out of step with sl`);
    }
  }
});

test("the acceptance email links the join page in the creator's language and escapes their name", () => {
  for (const locale of LOCALES) {
    const t = createTranslator(locale, [CATALOGUES[locale]]);
    const email = buildAcceptanceEmail({
      t,
      fullName: "Ana <b>Novak</b>",
      market: "balkans",
      joinUrl: "https://memoai.eu/ugc/join/0b9a1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4",
    });

    assert.equal(email.subject, CATALOGUES[locale]["ugcApply.email.subject"]);
    assert.match(email.html, /href="https:\/\/memoai\.eu\/ugc\/join\/0b9a1d2e/);
    assert.match(email.text, /https:\/\/memoai\.eu\/ugc\/join\/0b9a1d2e/);
    // The invite is reached only through the terms, never straight from the email.
    assert.doesNotMatch(email.html, /discord\.gg/);
    assert.doesNotMatch(email.html, /<b>Novak/);
    assert.doesNotMatch(email.text, /\{\w+\}/);
  }
});

test("the Discord invite is handed out only after the terms are accepted", () => {
  const join = readSource("src/app/api/ugc/join/route.ts");

  assert.match(join, /terms_accepted_at: acceptedAt/);
  assert.match(join, /version !== CREATOR_TERMS_VERSION/);
  assert.match(join, /\.is\("terms_accepted_at", null\)/);

  const page = readSource("src/app/ugc/join/[token]/page.tsx");
  assert.match(page, /accepted \? \{ at: accepted, discordUrl/);
});

test("every application route and the admin's actions are guarded", () => {
  for (const route of ["src/app/api/ugc/applications/route.ts", "src/app/api/ugc/applications/video/route.ts", "src/app/api/ugc/join/route.ts"]) {
    assert.match(readSource(route), /enforceRateLimit/, `${route} is not rate limited`);
  }

  const actions = readSource("src/app/admin/(dashboard)/actions.ts");

  for (const name of ["reviewApplicationAction", "resendAcceptanceEmailAction", "saveApplicationNotesAction"]) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, 400), /await requireAdmin\(\)/, `${name} must re-check the allowlist`);
  }
});

test("the creator pages stay off /creator and out of search", () => {
  assert.match(readSource("src/app/robots.ts"), /"\/ugc"/);

  for (const path of ["src/components/ugc/creator-program.tsx", "src/components/ugc/creator-apply-dialog.tsx"]) {
    assert.doesNotMatch(readSource(path), /oral-quiz/);
  }
});

function filesBelow(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);

    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

test("neither campaign's pay nor any Discord invite can reach the browser", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const clientFiles = filesBelow(join(root, "src"))
    .filter((path) => /\.(tsx?|mjs)$/.test(path))
    .filter((path) => /^["']use client["'];/m.test(readFileSync(path, "utf8")));

  for (const path of clientFiles) {
    const source = readFileSync(path, "utf8");

    assert.doesNotMatch(source, /creator-campaigns/, `${path} is a client module and imports the campaigns' pay`);
    assert.doesNotMatch(source, /discord\.gg/, `${path} would ship a Discord invite to every visitor`);
  }

  // The pure module the page does load carries no figures of its own.
  assert.doesNotMatch(readSource("src/lib/ugc/creator-program.ts"), /perTikTok: \d|discord\.gg/);
});
