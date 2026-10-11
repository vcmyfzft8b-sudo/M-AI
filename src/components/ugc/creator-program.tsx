"use client";

import Image from "next/image";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { InstantLink } from "@/components/instant-link";
import { LocaleOptionList, useLocaleChange } from "@/components/language-picker";
import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import { CreatorApplyDialog } from "@/components/ugc/creator-apply-dialog";
import { creatorFont } from "@/components/ugc/creator-font";
import { BRAND_LOCKUP_HEIGHT, BRAND_LOCKUP_SRC, BRAND_LOCKUP_WIDTH, BRAND_SUPPORT_EMAIL, SEO_BRAND_NAME } from "@/lib/brand";
import { LOCALE_INTL_TAG, LOCALE_LABELS, type Locale } from "@/lib/i18n/locales";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import {
  CREATOR_PROGRAM_STATS,
  INITIAL_VIEW_STEP,
  VIDEO_RANGE,
  VIEW_STEPS,
  codeSaleBonus,
  estimateEarnings,
  perVideoTotal,
  tierRanges,
  type CreatorMarket,
  type CreatorTerms,
} from "@/lib/ugc/creator-program";
import { formatCurrency } from "@/lib/utils";

/**
 * The public creator-program page at `/ugc`, built section for section on the campaign
 * page creators already know from our other brand (megasheet.app/parakeet-ai), in Memo
 * AI's colours: the banner, the floating nav, the headline beside a collage of real
 * campaign videos, the numbers, the earnings calculator, the benefit cards, the tiers,
 * "who we're looking for", the four steps, the apply card and the FAQ.
 *
 * Slovenia and the Balkans are separate programs with different pay. The server decides
 * which one this visitor gets (`resolveCreatorMarket`, from the IP country) and hands
 * over only that campaign's terms: there is no switch, and the other's pay is not in
 * the page at all. The videos are real campaign posts (`creator-showcase.ts`).
 */

export type ShowcaseVideo = { id: string; url: string; thumbnail: string; views: number };

const FAQ: Array<{ q: MessageKey; a: MessageKey }> = [
  { q: "ugcApply.faq.faceQ", a: "ugcApply.faq.faceA" },
  { q: "ugcApply.faq.viralQ", a: "ugcApply.faq.viralA" },
  { q: "ugcApply.faq.timeQ", a: "ugcApply.faq.timeA" },
  { q: "ugcApply.faq.accountQ", a: "ugcApply.faq.accountA" },
  { q: "ugcApply.faq.payQ", a: "ugcApply.faq.payA" },
];

const STEPS: Array<{ icon: string; title: MessageKey; body: MessageKey }> = [
  { icon: "check_circle", title: "ugcApply.step.applyTitle", body: "ugcApply.step.applyBody" },
  { icon: "videocam", title: "ugcApply.step.reviewTitle", body: "ugcApply.step.reviewBody" },
  { icon: "search", title: "ugcApply.step.testTitle", body: "ugcApply.step.testBody" },
  { icon: "rocket_launch", title: "ugcApply.step.startTitle", body: "ugcApply.step.startBody" },
];

const TIER_COPY: Record<string, { title: MessageKey; body: MessageKey; dots: number }> = {
  beginner: { title: "ugcApply.tier.beginner", body: "ugcApply.tier.beginnerBody", dots: 3 },
  experienced: { title: "ugcApply.tier.experienced", body: "ugcApply.tier.experiencedBody", dots: 6 },
  ultra: { title: "ugcApply.tier.ultra", body: "ugcApply.tier.ultraBody", dots: 9 },
};

/**
 * The mascot at full resolution. `MascotFigure` draws the app's 320px copy, which is fine
 * at onboarding size and soft at the sizes this page shows it; this is the same artwork
 * from the 3651px original, resized by the image optimiser for each screen.
 */
function CreatorMascot({ sizes }: { sizes: string }) {
  return <Image src="/memo-logo.png" alt="" width={3651} height={3285} sizes={sizes} className="memo-cp-mascot-image" />;
}

/** The registered company behind the program, as on the terms and the legal pages. */
const COMPANY_NAME = "Memo AI, Nace Valenčič s.p.";

const MARKET_FLAGS: Record<CreatorMarket, string> = { si: "🇸🇮", balkans: "🇭🇷 🇧🇦 🇷🇸 🇲🇪 🇲🇰" };

const MARKET_BANNER: Record<CreatorMarket, MessageKey> = { si: "ugcApply.banner.si", balkans: "ugcApply.banner.balkans" };

/** `[[words]]` in a translated string are the words the design sets in the accent colour. */
function rich(text: string): ReactNode {
  return text.split(/\[\[(.+?)\]\]/).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="memo-cp-accent">
        {part}
      </span>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

function useFormatters(locale: Locale) {
  return useMemo(() => {
    const tag = LOCALE_INTL_TAG[locale];
    const compact = new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 });
    const whole = new Intl.NumberFormat(tag);

    return {
      euros: (value: number) => formatCurrency(value, locale),
      compact: (value: number) => compact.format(value),
      whole: (value: number) => whole.format(value),
    };
  }, [locale]);
}

type Formatters = ReturnType<typeof useFormatters>;

export function CreatorProgram({
  market,
  terms,
  videos,
  preview,
  referrer,
}: {
  market: CreatorMarket;
  /** This campaign's pay, and only this campaign's: the other's never reaches the browser. */
  terms: CreatorTerms;
  videos: ShowcaseVideo[];
  /** An admin looking at the other campaign's page with `?market=`. */
  preview: boolean;
  referrer: string | null;
}) {
  const { t, locale } = useTranslations();
  const format = useFormatters(locale);
  const [applying, setApplying] = useState(false);
  const [playing, setPlaying] = useState<ShowcaseVideo | null>(null);

  const tiers = tierRanges(terms);
  const topTier = tiers[tiers.length - 1];
  const perVideo = format.euros(perVideoTotal(terms));

  const stats = {
    views: `${format.compact(CREATOR_PROGRAM_STATS.views)}+`,
    videos: `${format.whole(CREATOR_PROGRAM_STATS.videos)}+`,
    creators: `${format.whole(CREATOR_PROGRAM_STATS.creators)}+`,
  };

  const apply = () => setApplying(true);

  const applyButton = (light = false) => (
    <button type="button" className={light ? "memo-cp-cta memo-cp-cta-light" : "memo-cp-cta"} onClick={apply}>
      <span>{t("ugcApply.applyNow")}</span>
      <Msym name="arrow_forward" size="1.15rem" />
    </button>
  );

  const hero = (headingLevel: "h1" | "h2") => {
    const Heading = headingLevel;

    return (
      <>
        <p className="memo-cp-eyebrow">{t("ugcApply.heroEyebrow")}</p>
        <Heading className="memo-cp-hero-title">
          <span>{t("ugcApply.heroTitleStart")}</span>{" "}
          <span className="memo-cp-accent">{t("ugcApply.heroTitleAmount", { amount: format.euros(topTier.low) })}</span>{" "}
          <span>{t("ugcApply.heroTitleEnd")}</span>
        </Heading>
        <p className="memo-cp-hero-lead">{t("ugcApply.heroLead", { creators: stats.creators, views: stats.views })}</p>
      </>
    );
  };

  return (
    <div className={`memo-cp ${creatorFont.className}`}>
      {preview ? (
        <p className="memo-cp-preview">
          Admin preview: {market === "si" ? "Slovenia" : "Balkans"} page. Visitors only see the page for their own country.
        </p>
      ) : null}

      <p className="memo-cp-banner">
        <span>
          <span aria-hidden="true">{MARKET_FLAGS[market]}</span> {t(MARKET_BANNER[market])}
        </span>
        <span className="memo-cp-banner-sep" aria-hidden="true" />
        <span className="memo-cp-banner-open">
          <Msym name="schedule" size="1.1rem" fill={false} />
          <span>{t("ugcApply.bannerOpen")}</span>
        </span>
      </p>

      <div className="memo-cp-gradient">
        <header className="memo-cp-nav">
          <InstantLink href="/" className="memo-cp-brand" aria-label={SEO_BRAND_NAME}>
            <Image
              src={BRAND_LOCKUP_SRC}
              alt={SEO_BRAND_NAME}
              width={BRAND_LOCKUP_WIDTH}
              height={BRAND_LOCKUP_HEIGHT}
              className="memo-cp-lockup"
              priority
            />
          </InstantLink>
          <nav className="memo-cp-nav-links" aria-label={t("ugcApply.navLabel")}>
            <a href="#benefits">
              <Msym name="auto_awesome" size="1.05rem" fill={false} />
              <span>{t("ugcApply.navBenefits")}</span>
            </a>
            <a href="#earnings">
              <Msym name="euro" size="1.05rem" fill={false} />
              <span>{t("ugcApply.navEarnings")}</span>
            </a>
            <a href="#how">
              <Msym name="info" size="1.05rem" fill={false} />
              <span>{t("ugcApply.navHow")}</span>
            </a>
            <a href="#faq">
              <Msym name="help" size="1.05rem" fill={false} />
              <span>{t("ugcApply.navFaq")}</span>
            </a>
          </nav>
          <div className="memo-cp-nav-actions">
            <CreatorLanguageMenu />
            <button type="button" className="memo-cp-cta memo-cp-cta-small" onClick={apply}>
              <span>{t("ugcApply.applyNow")}</span>
              <Msym name="arrow_forward" size="1.05rem" />
            </button>
          </div>
        </header>

        <section className="memo-cp-hero" data-has-videos={videos.length >= 4 || undefined}>
          {videos.length >= 2 ? (
            <div className="memo-cp-hero-decor" aria-hidden="true">
              {videos.slice(0, 2).map((video, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={video.id} src={video.thumbnail} alt="" data-side={index === 0 ? "left" : "right"} referrerPolicy="no-referrer" />
              ))}
            </div>
          ) : null}
          <div className="memo-cp-hero-copy">
            {hero("h1")}
            <div className="memo-cp-hero-actions">{applyButton()}</div>
          </div>
          {videos.length >= 4 ? <VideoCollage videos={videos} format={format} onPlay={setPlaying} /> : null}
        </section>

        {videos.length >= 4 ? <VideoMarquee videos={videos} format={format} onPlay={setPlaying} /> : null}

        <section className="memo-cp-stats">
          <StatCard icon="visibility" value={stats.views} label={t("ugcApply.statViews")} />
          <StatCard icon="videocam" value={stats.videos} label={t("ugcApply.statVideos")} />
          <StatCard icon="group" value={stats.creators} label={t("ugcApply.statCreators")} />
          <StatCard icon="euro" value={perVideo} label={t("ugcApply.statPerVideo")} />
        </section>
      </div>

      <section className="memo-cp-gradient memo-cp-band" id="earnings">
        <div className="memo-cp-center-head">
          <p className="memo-cp-eyebrow">{t("ugcApply.calcEyebrow")}</p>
          <h2 className="memo-cp-h2">{t("ugcApply.calcTitle")}</h2>
          <p className="memo-cp-sub">{t("ugcApply.calcLead")}</p>
        </div>
        <EarningsCalculator terms={terms} format={format} />
      </section>

      <section className="memo-cp-band memo-cp-white" id="benefits">
        <div className="memo-cp-wrap">
          <h2 className="memo-cp-h2 memo-cp-left">{rich(t("ugcApply.whyTitle", { creators: stats.creators }))}</h2>
          <p className="memo-cp-sub memo-cp-left">{t("ugcApply.whyLead")}</p>
          <p className="memo-cp-strong memo-cp-left">{t("ugcApply.whyStrong")}</p>

          <div className="memo-cp-benefits">
            <BenefitCard
              title={t("ugcApply.why.paidTitle")}
              body={t("ugcApply.why.paidBody", { perVideo })}
              art={<PaidArt videos={videos} amount={perVideo} />}
            />
            <BenefitCard title={t("ugcApply.why.followersTitle")} body={t("ugcApply.why.followersBody")} art={<ProfileArt />} />
            <BenefitCard title={t("ugcApply.why.guideTitle")} body={t("ugcApply.why.guideBody")} art={<GuideArt />} />
            <BenefitCard
              wide
              title={t("ugcApply.why.unlimitedTitle", { cap: format.euros(terms.bonusCap) })}
              body={t("ugcApply.why.unlimitedBody", { top: format.euros(topTier.low), cap: format.euros(terms.bonusCap) })}
              art={<EarningsArt amount={format.euros(topTier.low)} />}
            />
            <BenefitCard
              wide
              title={t("ugcApply.why.appTitle")}
              body={t("ugcApply.why.appBody", { views: stats.views })}
              art={<ViralArt stats={stats} />}
            />
          </div>
        </div>
      </section>

      <section className="memo-cp-gradient memo-cp-band" id="tiers">
        <div className="memo-cp-center-head">
          <h2 className="memo-cp-h2">{rich(t("ugcApply.tiersTitle"))}</h2>
          <p className="memo-cp-sub">{t("ugcApply.tiersLead", { amount: format.euros(tiers[1].low) })}</p>
        </div>
        <div className="memo-cp-tiers">
          {tiers.map((tier) => (
            <article key={tier.key} className="memo-cp-tier">
              <span className="memo-cp-dots" aria-hidden="true">
                {Array.from({ length: 9 }, (_, index) => (
                  <span key={index} data-on={index < TIER_COPY[tier.key].dots || undefined} />
                ))}
              </span>
              <h3>{t(TIER_COPY[tier.key].title)}</h3>
              <p className="memo-cp-tier-range">
                {tier.high === null ? `${format.euros(tier.low)}+` : `${format.euros(tier.low)} – ${format.euros(tier.high)}`}
                {t("ugcApply.calcPerMonth")}
              </p>
              <p>{t(TIER_COPY[tier.key].body, { videos: tier.videos })}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="memo-cp-band memo-cp-white">
        <FeatureCard
          title={t("ugcApply.whoTitle")}
          body={
            <>
              <p>{t("ugcApply.whoBody")}</p>
              <p>
                <strong>{t("ugcApply.whoStrong")}</strong> {t("ugcApply.whoBody2")}
              </p>
            </>
          }
          action={applyButton(true)}
        />
      </section>

      <section className="memo-cp-band memo-cp-white" id="how">
        <div className="memo-cp-center-head">
          <h2 className="memo-cp-h2">{rich(t("ugcApply.stepsTitle"))}</h2>
          <p className="memo-cp-sub">{t("ugcApply.stepsLead")}</p>
        </div>
        <div className="memo-cp-wrap">
          <ol className="memo-cp-step-pills" aria-hidden="true">
            {STEPS.map((step, index) => (
              <li key={step.title}>{t("ugcApply.stepLabel", { number: index + 1 })}</li>
            ))}
          </ol>
          <ol className="memo-cp-steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="memo-cp-step">
                <span className="memo-cp-step-pill">{t("ugcApply.stepLabel", { number: index + 1 })}</span>
                <Msym name={step.icon} size="1.9rem" fill={false} weight={300} />
                <h3>{t(step.title)}</h3>
                <p>{t(step.body)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="memo-cp-band memo-cp-white memo-cp-band-tight">
        <FeatureCard
          title={t("ugcApply.coachTitle")}
          body={
            <>
              <p>{t("ugcApply.coachBody")}</p>
              <p>
                <strong>{t("ugcApply.coachStrong")}</strong> {t("ugcApply.coachBody2")}
              </p>
            </>
          }
          action={applyButton(true)}
        />
      </section>

      <section className="memo-cp-gradient memo-cp-band" id="apply">
        <div className="memo-cp-center-head">
          <h2 className="memo-cp-h2">{rich(t("ugcApply.applyTitle"))}</h2>
          <p className="memo-cp-sub">{t("ugcApply.applyLead")}</p>
        </div>
        <div className="memo-cp-format">
          <div className="memo-cp-format-row">
            <span className="memo-cp-format-icon">
              <Msym name="person_add" size="1.3rem" fill={false} />
            </span>
            <div className="memo-cp-format-copy">
              <h3>{t("ugcApply.formatTitle")}</h3>
              <p>{t("ugcApply.formatBody")}</p>
            </div>
            <button type="button" className="memo-cp-cta memo-cp-cta-small memo-cp-cta-plain" onClick={apply}>
              <span>{t("ugcApply.applyNow")}</span>
              <Msym name="chevron_right" size="1.1rem" />
            </button>
          </div>
          {videos.length > 0 ? (
            <div className="memo-cp-strip">
              {videos.slice(-6).map((video) => (
                <VideoTile key={video.id} video={video} format={format} onPlay={setPlaying} compact />
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="memo-cp-band memo-cp-white" id="faq">
        <div className="memo-cp-wrap memo-cp-faq-layout">
          <div>
            <p className="memo-cp-eyebrow">{t("ugcApply.faqEyebrow")}</p>
            <h2 className="memo-cp-faq-title">{t("ugcApply.faqTitle")}</h2>
          </div>
          <div className="memo-cp-faq">
            {FAQ.map((item) => (
              <details key={item.q} className="memo-cp-faq-item">
                <summary>
                  <span>{t(item.q)}</span>
                  <Msym name="expand_more" size="1.4rem" fill={false} weight={400} />
                </summary>
                <p>{t(item.a)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="memo-cp-gradient memo-cp-band memo-cp-final">
        <div className="memo-cp-final-copy">
          {hero("h2")}
          {applyButton()}
        </div>
      </section>

      <footer className="memo-cp-footer">
        <div className="memo-cp-footer-inner">
          <p className="memo-cp-chat">
            <Msym name="near_me" size="2rem" />
            <span>{t("ugcApply.chatTitle")}</span>
          </p>
          <a className="memo-cp-footer-support" href={`mailto:${BRAND_SUPPORT_EMAIL}`}>
            {t("ugcApply.chatLink")}
          </a>
          <nav className="memo-cp-footer-links" aria-label={t("ugcApply.navLabel")}>
            <InstantLink href={preview ? `/ugc/terms?market=${market}` : "/ugc/terms"}>{t("ugcApply.termsLink")}</InstantLink>
            <InstantLink href="/legal/privacy-policy">{t("landing.footer.privacy")}</InstantLink>
            <a href="https://www.tiktok.com/@memo_ai_si" target="_blank" rel="noreferrer">
              TikTok
            </a>
            <InstantLink href="/">memoai.eu</InstantLink>
          </nav>
          <p>{t("ugcApply.footerRun")}</p>
          <p>{t("ugcApply.footerRights", { company: COMPANY_NAME })}</p>
        </div>
        <div className="memo-cp-footer-mascot" aria-hidden="true">
          <CreatorMascot sizes="(min-width: 640px) 352px, 80vw" />
        </div>
      </footer>

      {applying ? (
        <CreatorApplyDialog market={market} videos={videos} referrer={referrer} onClosed={() => setApplying(false)} />
      ) : null}
      {playing ? <VideoPlayer video={playing} onClose={() => setPlaying(null)} /> : null}
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="memo-cp-stat">
      <Msym name={icon} size="1.5rem" fill={false} weight={300} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function BenefitCard({ title, body, art, wide }: { title: string; body: string; art: ReactNode; wide?: boolean }) {
  return (
    <article className="memo-cp-benefit" data-wide={wide || undefined}>
      <h3>{title}</h3>
      <div className="memo-cp-art" aria-hidden="true">
        {art}
      </div>
      <p>{body}</p>
    </article>
  );
}

function PaidArt({ videos, amount }: { videos: ShowcaseVideo[]; amount: string }) {
  const covers = videos.slice(0, 3);

  return (
    <div className="memo-cp-art-paid">
      {covers.map((video, index) => (
        <div key={video.id} className="memo-cp-art-reel" data-index={index}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={video.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
          <span>+{amount}</span>
        </div>
      ))}
    </div>
  );
}

function ProfileArt() {
  const { t } = useTranslations();

  return (
    <div className="memo-cp-art-profile">
      <div className="memo-cp-art-profile-head">
        <span className="memo-cp-art-avatar">
          <Msym name="person" size="1.2rem" />
        </span>
        <strong>@memo.creator</strong>
        <span className="memo-cp-art-badge">{t("ugcApply.illus.newProfile")}</span>
      </div>
      <div className="memo-cp-art-profile-stats">
        <span>
          <strong>0</strong>
          {t("ugcApply.illus.posts")}
        </span>
        <span>
          <strong>0</strong>
          {t("ugcApply.illus.followers")}
        </span>
        <span>
          <strong>0</strong>
          {t("ugcApply.illus.following")}
        </span>
      </div>
      <span className="memo-cp-art-start">
        {t("ugcApply.illus.startPosting")} <Msym name="arrow_forward" size="0.9rem" />
      </span>
    </div>
  );
}

function GuideArt() {
  const { t } = useTranslations();
  const items: MessageKey[] = ["ugcApply.illus.tutorials", "ugcApply.illus.examples", "ugcApply.illus.instructions"];

  return (
    <div className="memo-cp-art-guide">
      {items.map((key, index) => (
        <span key={key} data-index={index}>
          <Msym name="check_circle" size="1.15rem" />
          {t(key)}
        </span>
      ))}
    </div>
  );
}

function EarningsArt({ amount }: { amount: string }) {
  const { t } = useTranslations();

  return (
    <div className="memo-cp-art-earnings">
      <span className="memo-cp-art-coin" data-index={0}>
        <Msym name="euro" size="1.1rem" />
      </span>
      <span className="memo-cp-art-coin" data-index={1}>
        <Msym name="euro" size="0.9rem" />
      </span>
      <span className="memo-cp-art-coin" data-index={2}>
        <Msym name="euro" size="0.9rem" />
      </span>
      <div className="memo-cp-art-earnings-card">
        <span>{t("ugcApply.illus.earnings")}</span>
        <strong>{amount}+</strong>
        <small>{t("ugcApply.calcPerMonth")}</small>
      </div>
    </div>
  );
}

function ViralArt({ stats }: { stats: { views: string; videos: string; creators: string } }) {
  const { t } = useTranslations();
  const tiles: Array<{ icon: string; label: MessageKey; value: string }> = [
    { icon: "visibility", label: "ugcApply.illus.views", value: stats.views },
    { icon: "videocam", label: "ugcApply.illus.videos", value: stats.videos },
    { icon: "group", label: "ugcApply.illus.creators", value: stats.creators },
  ];

  return (
    <div className="memo-cp-art-viral">
      {tiles.map((tile) => (
        <div key={tile.label}>
          <span>
            <Msym name={tile.icon} size="1.15rem" />
            {t(tile.label)}
          </span>
          <strong>{tile.value}</strong>
        </div>
      ))}
    </div>
  );
}

function FeatureCard({ title, body, action }: { title: string; body: ReactNode; action: ReactNode }) {
  return (
    <div className="memo-cp-feature">
      <div className="memo-cp-feature-copy">
        <h2>{title}</h2>
        {body}
        <div>{action}</div>
      </div>
    </div>
  );
}

/**
 * The hero's video wall: real campaign posts in two columns that drift past endlessly,
 * one up and one down, and fade out at both ends. Each column is its list twice over and
 * moves by exactly one list's height, so the loop has no seam. Hovering pauses it.
 */
const COLLAGE_SHAPES = ["short", "tall", "mid", "tall"] as const;

function VideoCollage({
  videos,
  format,
  onPlay,
}: {
  videos: ShowcaseVideo[];
  format: Formatters;
  onPlay: (video: ShowcaseVideo) => void;
}) {
  const columns = [videos.filter((_, index) => index % 2 === 0), videos.filter((_, index) => index % 2 === 1)];

  return (
    <div className="memo-cp-collage">
      {columns.map((column, columnIndex) => (
        <div key={columnIndex} className="memo-cp-collage-col" data-direction={columnIndex === 0 ? "up" : "down"}>
          <div className="memo-cp-collage-track">
            {[...column, ...column].map((video, index) => (
              <VideoTile
                key={`${video.id}-${index}`}
                video={video}
                format={format}
                onPlay={onPlay}
                hidden={index >= column.length}
                shape={COLLAGE_SHAPES[((index % column.length) + columnIndex) % COLLAGE_SHAPES.length]}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Below the wide layout the wall turns into a row that drifts sideways under the
 * headline, as on the reference page: the list twice over, moving one copy's width.
 */
function VideoMarquee({
  videos,
  format,
  onPlay,
}: {
  videos: ShowcaseVideo[];
  format: Formatters;
  onPlay: (video: ShowcaseVideo) => void;
}) {
  return (
    <div className="memo-cp-marquee">
      <div className="memo-cp-marquee-track">
        {[...videos, ...videos].map((video, index) => (
          <VideoTile
            key={`${video.id}-${index}`}
            video={video}
            format={format}
            onPlay={onPlay}
            hidden={index >= videos.length}
          />
        ))}
      </div>
    </div>
  );
}

/** A campaign video's cover; tapping it plays the post in TikTok's own player. */
function VideoTile({
  video,
  format,
  onPlay,
  compact,
  hidden,
  shape,
}: {
  video: ShowcaseVideo;
  format: Formatters;
  onPlay: (video: ShowcaseVideo) => void;
  compact?: boolean;
  /** The loop's second copy: still clickable, but not read out or tabbed to twice. */
  hidden?: boolean;
  /** The tile's height in the hero wall. */
  shape?: (typeof COLLAGE_SHAPES)[number];
}) {
  const { t } = useTranslations();

  return (
    <button
      type="button"
      className="memo-cp-video"
      tabIndex={hidden ? -1 : undefined}
      aria-hidden={hidden || undefined}
      data-compact={compact || undefined}
      data-shape={shape}
      aria-label={
        video.views > 0 ? t("ugcApply.playVideo", { views: format.compact(video.views) }) : t("ugcApply.examplesLabel")
      }
      onClick={() => onPlay(video)}
    >
      {/* TikTok's CDN signs and expires these, so they bypass the image optimiser. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={video.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
      <span className="memo-cp-video-play" aria-hidden="true">
        <Msym name="play_arrow" size={compact ? "1.2rem" : "1.6rem"} />
      </span>
    </button>
  );
}

function VideoPlayer({ video, onClose }: { video: ShowcaseVideo; onClose: () => void }) {
  const { t } = useTranslations();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <MemoPortal>
      <button type="button" className="memo-scrim" aria-label={t("common.close")} onClick={onClose} />
      <div className="memo-cp-player" role="dialog" aria-modal="true" aria-label={t("ugcApply.examplesLabel")}>
        <iframe
          src={`https://www.tiktok.com/embed/v2/${video.id}`}
          title={t("ugcApply.examplesLabel")}
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
        />
        <button type="button" className="memo-cp-player-close" aria-label={t("common.close")} onClick={onClose}>
          <Msym name="close" size="1.3rem" />
        </button>
      </div>
    </MemoPortal>
  );
}

function EarningsCalculator({ terms, format }: { terms: CreatorTerms; format: Formatters }) {
  const { t } = useTranslations();
  const [videos, setVideos] = useState<number>(VIDEO_RANGE.initial);
  const [viewStep, setViewStep] = useState(INITIAL_VIEW_STEP);

  const views = VIEW_STEPS[viewStep];
  const estimate = estimateEarnings(terms, videos, views);
  const fill = (value: number, max: number, min = 0) => `${((value - min) / (max - min)) * 100}%`;

  return (
    <div className="memo-cp-calc">
      <div className="memo-cp-calc-inputs">
        <label className="memo-cp-slider">
          <span className="memo-cp-slider-head">
            <span className="memo-cp-slider-icon">
              <Msym name="videocam" size="1rem" fill={false} />
            </span>
            <span>{t("ugcApply.calcVideos")}</span>
            <strong>{format.whole(videos)}</strong>
          </span>
          <input
            type="range"
            min={VIDEO_RANGE.min}
            max={VIDEO_RANGE.max}
            step={VIDEO_RANGE.step}
            value={videos}
            style={{ "--fill": fill(videos, VIDEO_RANGE.max, VIDEO_RANGE.min) } as CSSProperties}
            onChange={(event) => setVideos(Number(event.target.value))}
          />
        </label>
        <label className="memo-cp-slider">
          <span className="memo-cp-slider-head">
            <span className="memo-cp-slider-icon">
              <Msym name="visibility" size="1rem" fill={false} />
            </span>
            <span>{t("ugcApply.calcViews")}</span>
            <strong>{format.compact(views)}</strong>
          </span>
          <input
            type="range"
            min={0}
            max={VIEW_STEPS.length - 1}
            step={1}
            value={viewStep}
            aria-valuetext={format.whole(views)}
            style={{ "--fill": fill(viewStep, VIEW_STEPS.length - 1) } as CSSProperties}
            onChange={(event) => setViewStep(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="memo-cp-payout" aria-live="polite">
        <span className="memo-cp-payout-label">{t("ugcApply.calcTotal")}</span>
        <p className="memo-cp-payout-total">
          <strong>{format.euros(estimate.total)}</strong>
          <span>{t("ugcApply.calcPerMonth")}</span>
        </p>
        <p className="memo-cp-payout-lines">
          {t("ugcApply.calcBreakdown", {
            tiktok: format.euros(estimate.tiktokPay),
            instagram: format.euros(estimate.instagramPay),
            bonus: format.euros(estimate.bonus),
          })}
        </p>
        <p className="memo-cp-payout-note">
          {estimate.capped
            ? t("ugcApply.calcCapped", { amount: format.euros(terms.bonusCap) })
            : terms.codeSharePercent > 0
              ? t("ugcApply.calcCodeNote", {
                  monthly: format.euros(codeSaleBonus(terms, "monthly")),
                  yearly: format.euros(codeSaleBonus(terms, "yearly")),
                })
              : t("ugcApply.calcViewNote", { amount: format.euros(terms.bonusCap) })}
        </p>
      </div>
    </div>
  );
}

/** The page's language switch: a globe in the bar opening the app's own language list. */
function CreatorLanguageMenu() {
  const { locale, t } = useTranslations();
  const [open, setOpen] = useState(false);
  const { change, pendingLocale } = useLocaleChange();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="memo-cp-lang" ref={containerRef}>
      <button
        type="button"
        className="memo-cp-lang-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t("settings.language.title")}: ${LOCALE_LABELS[locale]}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Msym name="language" size="1.15rem" fill={false} />
      </button>
      {open ? (
        <LocaleOptionList
          className="memo-cp-lang-menu"
          active={locale}
          pendingLocale={pendingLocale}
          onSelect={(next) => {
            setOpen(false);

            if (next !== locale) {
              change(next);
            }
          }}
        />
      ) : null}
    </div>
  );
}
