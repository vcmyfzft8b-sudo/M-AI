"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { InstantLink } from "@/components/instant-link";
import { LocaleOptionList, useLocaleChange } from "@/components/language-picker";
import { MemoPortal } from "@/components/memo-portal";
import { Msym } from "@/components/msym";
import { CreatorApplyDialog } from "@/components/ugc/creator-apply-dialog";
import { BRAND_LOCKUP_HEIGHT, BRAND_LOCKUP_SRC, BRAND_LOCKUP_WIDTH, BRAND_SUPPORT_EMAIL, SEO_BRAND_NAME } from "@/lib/brand";
import { LOCALE_INTL_TAG, LOCALE_LABELS, type Locale } from "@/lib/i18n/locales";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import {
  CREATOR_PROGRAM_STATS,
  INITIAL_VIEW_STEP,
  PAID_VIDEOS_PER_MONTH,
  VIDEO_RANGE,
  VIEW_STEPS,
  estimateEarnings,
  perVideoTotal,
  tierRanges,
  type CreatorMarket,
  type CreatorTerms,
} from "@/lib/ugc/creator-program";
import { formatCurrency } from "@/lib/utils";

/**
 * The public creator-program page at `/ugc`, laid out like the campaign pages creators
 * already know: a headline with real videos beside it, the numbers, an earnings
 * calculator, what it pays, how to join, the application and a short FAQ.
 *
 * Slovenia and the Balkans are separate programs with different pay. The server decides
 * which one this visitor gets (`resolveCreatorMarket`, from the IP country) and hands
 * over only that campaign's terms: there is no switch, and the other's pay is not in
 * the page at all. The example videos are real campaign posts (`creator-showcase.ts`).
 */

export type ShowcaseVideo = { id: string; url: string; thumbnail: string; views: number };

const WHY: Array<{ icon: string; title: MessageKey; body: MessageKey }> = [
  { icon: "payments", title: "ugcApply.why.paidTitle", body: "ugcApply.why.paidBody" },
  { icon: "person", title: "ugcApply.why.followersTitle", body: "ugcApply.why.followersBody" },
  { icon: "assignment", title: "ugcApply.why.guideTitle", body: "ugcApply.why.guideBody" },
  { icon: "trending_up", title: "ugcApply.why.unlimitedTitle", body: "ugcApply.why.unlimitedBody" },
];

const STEPS: Array<{ title: MessageKey; body: MessageKey }> = [
  { title: "ugcApply.step.applyTitle", body: "ugcApply.step.applyBody" },
  { title: "ugcApply.step.reviewTitle", body: "ugcApply.step.reviewBody" },
  { title: "ugcApply.step.testTitle", body: "ugcApply.step.testBody" },
  { title: "ugcApply.step.startTitle", body: "ugcApply.step.startBody" },
];

const TIER_COPY: Record<string, { title: MessageKey; body: MessageKey }> = {
  beginner: { title: "ugcApply.tier.beginner", body: "ugcApply.tier.beginnerBody" },
  experienced: { title: "ugcApply.tier.experienced", body: "ugcApply.tier.experiencedBody" },
  ultra: { title: "ugcApply.tier.ultra", body: "ugcApply.tier.ultraBody" },
};

const FAQ: Array<{ q: MessageKey; a: MessageKey }> = [
  { q: "ugcApply.faq.faceQ", a: "ugcApply.faq.faceA" },
  { q: "ugcApply.faq.viralQ", a: "ugcApply.faq.viralA" },
  { q: "ugcApply.faq.timeQ", a: "ugcApply.faq.timeA" },
  { q: "ugcApply.faq.accountQ", a: "ugcApply.faq.accountA" },
  { q: "ugcApply.faq.payQ", a: "ugcApply.faq.payA" },
];

const MARKET_FLAGS: Record<CreatorMarket, string> = { si: "🇸🇮", balkans: "🇭🇷 🇧🇦 🇷🇸 🇲🇪 🇲🇰" };

const MARKET_BANNER: Record<CreatorMarket, MessageKey> = { si: "ugcApply.banner.si", balkans: "ugcApply.banner.balkans" };

function useFormatters(locale: Locale) {
  return useMemo(() => {
    const tag = LOCALE_INTL_TAG[locale];
    const compact = new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 });
    const whole = new Intl.NumberFormat(tag);
    const percent = new Intl.NumberFormat(tag, { style: "percent" });

    return {
      euros: (value: number) => formatCurrency(value, locale),
      compact: (value: number) => compact.format(value),
      whole: (value: number) => whole.format(value),
      percent: (value: number) => percent.format(value / 100),
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
  const headline = t("ugcApply.heroTitle", { amount: format.euros(topTier.low) });

  const stats = {
    views: `${format.compact(CREATOR_PROGRAM_STATS.views)}+`,
    videos: `${format.whole(CREATOR_PROGRAM_STATS.videos)}+`,
    creators: `${format.whole(CREATOR_PROGRAM_STATS.creators)}+`,
  };

  const apply = () => setApplying(true);

  // The address is a link inside a translated sentence, so the sentence is split around it.
  const [contactBefore, contactAfter = ""] = t("ugcApply.contact", { email: "\u0000" }).split("\u0000");

  const applyButton = (
    <button type="button" className="memo-cp-cta" onClick={apply}>
      <span>{t("ugcApply.applyNow")}</span>
      <Msym name="arrow_forward" size="1.25rem" />
    </button>
  );

  return (
    <div className="memo-cp">
      {preview ? (
        <p className="memo-cp-preview">
          Admin preview: {market === "si" ? "Slovenia" : "Balkans"} page. Visitors only see the page for their own country.
        </p>
      ) : null}
      <p className="memo-cp-banner">
        <span aria-hidden="true">{MARKET_FLAGS[market]}</span>
        <span>{t(MARKET_BANNER[market])}</span>
        <span className="memo-cp-banner-open">
          <span className="memo-cp-dot" aria-hidden="true" />
          <span>{t("ugcApply.bannerOpen")}</span>
        </span>
      </p>

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
        <div className="memo-cp-nav-actions">
          <CreatorLanguageMenu />
          <button type="button" className="memo-cp-cta memo-cp-cta-small" onClick={apply}>
            {t("ugcApply.applyNow")}
          </button>
        </div>
      </header>

      <section className="memo-cp-hero" data-has-videos={videos.length >= 4 || undefined}>
        <div className="memo-cp-hero-copy">
          <p className="memo-eyebrow memo-cp-eyebrow">{t("ugcApply.heroEyebrow")}</p>
          <h1 className="memo-cp-hero-title">{headline}</h1>
          <p className="memo-cp-lead">{t("ugcApply.heroLead", { creators: stats.creators, views: stats.views })}</p>
          <div className="memo-cp-hero-actions">{applyButton}</div>
        </div>

        {videos.length >= 4 ? (
          <div className="memo-cp-hero-videos">
            {videos.slice(0, 4).map((video) => (
              <VideoTile key={video.id} video={video} format={format} onPlay={setPlaying} />
            ))}
          </div>
        ) : null}
      </section>

      <section className="memo-cp-stats">
        <div className="memo-cp-stat">
          <strong>{stats.views}</strong>
          <span>{t("ugcApply.statViews")}</span>
        </div>
        <div className="memo-cp-stat">
          <strong>{stats.videos}</strong>
          <span>{t("ugcApply.statVideos")}</span>
        </div>
        <div className="memo-cp-stat">
          <strong>{stats.creators}</strong>
          <span>{t("ugcApply.statCreators")}</span>
        </div>
        <div className="memo-cp-stat">
          <strong>{format.euros(perVideoTotal(terms))}</strong>
          <span>{t("ugcApply.statPerVideo")}</span>
        </div>
      </section>

      <section className="memo-cp-section" id="earnings">
        <div className="memo-cp-head">
          <p className="memo-eyebrow memo-cp-eyebrow">{t("ugcApply.calcEyebrow")}</p>
          <h2 className="memo-cp-title">{t("ugcApply.calcTitle")}</h2>
        </div>
        <EarningsCalculator terms={terms} format={format} />
      </section>

      <section className="memo-cp-section">
        <div className="memo-cp-head">
          <h2 className="memo-cp-title">{t("ugcApply.whyTitle")}</h2>
          <p className="memo-cp-lead">{t("ugcApply.whyLead")}</p>
        </div>
        <div className="memo-cp-grid">
          {WHY.map((item) => (
            <article key={item.title} className="memo-cp-card">
              <span className="memo-cp-tile">
                <Msym name={item.icon} size="1.35rem" />
              </span>
              <h3>{t(item.title)}</h3>
              <p>{t(item.body)}</p>
            </article>
          ))}
        </div>
        <div className="memo-cp-center">{applyButton}</div>
      </section>

      <section className="memo-cp-section" id="tiers">
        <div className="memo-cp-head">
          <p className="memo-eyebrow memo-cp-eyebrow">{t("ugcApply.tiersEyebrow")}</p>
          <h2 className="memo-cp-title">{t("ugcApply.tiersTitle")}</h2>
        </div>
        <div className="memo-cp-tiers">
          {tiers.map((tier) => (
            <article key={tier.key} className="memo-cp-tier" data-tier={tier.key}>
              <h3>{t(TIER_COPY[tier.key].title)}</h3>
              <p className="memo-cp-tier-range">
                <span>
                  {tier.high === null
                    ? `${format.euros(tier.low)}+`
                    : `${format.euros(tier.low)} – ${format.euros(tier.high)}`}
                </span>
                <span className="memo-cp-per">{t("ugcApply.calcPerMonth")}</span>
              </p>
              <p>{t(TIER_COPY[tier.key].body, { videos: tier.videos })}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="memo-cp-section">
        <div className="memo-cp-card memo-cp-who">
          <h2 className="memo-cp-title">{t("ugcApply.whoTitle")}</h2>
          <p>{t("ugcApply.whoBody")}</p>
          <div>{applyButton}</div>
        </div>
      </section>

      <section className="memo-cp-section" id="how">
        <div className="memo-cp-head">
          <h2 className="memo-cp-title">{t("ugcApply.stepsTitle")}</h2>
        </div>
        <ol className="memo-cp-steps">
          {STEPS.map((step, index) => (
            <li key={step.title} className="memo-cp-step">
              <span className="memo-cp-step-label">{t("ugcApply.stepLabel", { number: index + 1 })}</span>
              <h3>{t(step.title)}</h3>
              <p>{t(step.body)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="memo-cp-section">
        <div className="memo-cp-card memo-cp-coach">
          <h2 className="memo-cp-title">{t("ugcApply.coachTitle")}</h2>
          <p>{t("ugcApply.coachBody")}</p>
        </div>
      </section>

      <section className="memo-cp-section memo-cp-apply" id="apply">
        <div className="memo-cp-head">
          <h2 className="memo-cp-title">{t("ugcApply.applyTitle")}</h2>
          <p className="memo-cp-lead">{t("ugcApply.applyLead")}</p>
        </div>
        <div className="memo-cp-card memo-cp-format">
          <div className="memo-cp-format-row">
            <span className="memo-cp-tile">
              <Msym name="videocam" size="1.35rem" />
            </span>
            <div className="memo-cp-format-copy">
              <h3>{t("ugcApply.formatTitle")}</h3>
              <p>{t("ugcApply.formatBody")}</p>
            </div>
            <button type="button" className="memo-cp-cta memo-cp-cta-small" onClick={apply}>
              <span>{t("ugcApply.applyNow")}</span>
              <Msym name="chevron_right" size="1.2rem" />
            </button>
          </div>
          {videos.length > 0 ? (
            <div className="memo-cp-strip">
              {videos.slice(videos.length > 4 ? 4 : 0).map((video) => (
                <VideoTile key={video.id} video={video} format={format} onPlay={setPlaying} />
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="memo-cp-section" id="faq">
        <div className="memo-cp-head">
          <p className="memo-eyebrow memo-cp-eyebrow">{t("ugcApply.faqEyebrow")}</p>
          <h2 className="memo-cp-title">{t("ugcApply.faqTitle")}</h2>
        </div>
        <div className="memo-cp-faq">
          {FAQ.map((item) => (
            <details key={item.q} className="memo-cp-faq-item">
              <summary>
                <span>{t(item.q)}</span>
                <Msym name="expand_more" size="1.5rem" fill={false} weight={400} />
              </summary>
              <p>{t(item.a)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="memo-cp-section memo-cp-final">
        <p className="memo-eyebrow memo-cp-eyebrow">{t("ugcApply.heroEyebrow")}</p>
        <h2 className="memo-cp-hero-title">{headline}</h2>
        {applyButton}
      </section>

      <footer className="memo-cp-footer">
        <p>
          {contactBefore}
          <a href={`mailto:${BRAND_SUPPORT_EMAIL}`}>{BRAND_SUPPORT_EMAIL}</a>
          {contactAfter}
        </p>
        <p>
          <InstantLink href={preview ? `/ugc/terms?market=${market}` : "/ugc/terms"}>{t("ugcApply.termsLink")}</InstantLink>
          {" · "}
          <InstantLink href="/legal/privacy-policy">{t("landing.footer.privacy")}</InstantLink>
        </p>
      </footer>

      {applying ? <CreatorApplyDialog market={market} referrer={referrer} onClosed={() => setApplying(false)} /> : null}
      {playing ? <VideoPlayer video={playing} onClose={() => setPlaying(null)} /> : null}
    </div>
  );
}

/** A campaign video's cover; tapping it plays the post in TikTok's own player. */
function VideoTile({
  video,
  format,
  onPlay,
}: {
  video: ShowcaseVideo;
  format: Formatters;
  onPlay: (video: ShowcaseVideo) => void;
}) {
  const { t } = useTranslations();

  return (
    <button
      type="button"
      className="memo-cp-video"
      aria-label={t("ugcApply.playVideo", { views: format.compact(video.views) })}
      onClick={() => onPlay(video)}
    >
      {/* TikTok's CDN signs and expires these, so they bypass the image optimiser. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={video.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
      <span className="memo-cp-video-play" aria-hidden="true">
        <Msym name="play_arrow" size="1.6rem" />
      </span>
      <span className="memo-cp-video-views">
        <Msym name="play_arrow" size="1rem" />
        <span>{format.compact(video.views)}</span>
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
        <button type="button" className="memo-icon-button memo-cp-player-close" aria-label={t("common.close")} onClick={onClose}>
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

  return (
    <div className="memo-cp-calc">
      <div className="memo-cp-calc-inputs">
        <label className="memo-cp-slider">
          <span className="memo-cp-slider-head">
            <span>{t("ugcApply.calcVideos")}</span>
            <strong>{format.whole(videos)}</strong>
          </span>
          <input
            type="range"
            min={VIDEO_RANGE.min}
            max={VIDEO_RANGE.max}
            step={VIDEO_RANGE.step}
            value={videos}
            onChange={(event) => setVideos(Number(event.target.value))}
          />
        </label>
        <label className="memo-cp-slider">
          <span className="memo-cp-slider-head">
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
            onChange={(event) => setViewStep(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="memo-cp-calc-result" aria-live="polite">
        <span className="memo-eyebrow">{t("ugcApply.calcTotal")}</span>
        <p className="memo-cp-calc-total">
          <span>{format.euros(estimate.total)}</span>
          <span className="memo-cp-per">{t("ugcApply.calcPerMonth")}</span>
        </p>
        <dl className="memo-cp-calc-lines">
          <div>
            <dt>{t("ugcApply.calcTikTokPay", { count: videos, amount: format.euros(terms.perTikTok) })}</dt>
            <dd>{format.euros(estimate.tiktokPay)}</dd>
          </div>
          <div>
            <dt>{t("ugcApply.calcInstagramPay", { count: videos, amount: format.euros(terms.perInstagram) })}</dt>
            <dd>{format.euros(estimate.instagramPay)}</dd>
          </div>
          <div>
            <dt>
              {terms.codeSharePercent > 0
                ? t("ugcApply.calcCodeBonus", { percent: format.percent(terms.codeSharePercent) })
                : t("ugcApply.calcViewBonus", { amount: format.euros(terms.viewRatePer1k) })}
            </dt>
            <dd>{format.euros(estimate.bonus)}</dd>
          </div>
        </dl>
        <p className="memo-cp-note">
          {estimate.capped
            ? t("ugcApply.calcCapped", { amount: format.euros(terms.viewBonusCap ?? 0) })
            : terms.codeSharePercent > 0
              ? t("ugcApply.calcCodeNote")
              : t("ugcApply.calcViewNote", { amount: format.euros(terms.viewBonusCap ?? 0) })}{" "}
          {t("ugcApply.calcPlatformsNote", { max: PAID_VIDEOS_PER_MONTH })}
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
        <Msym name="language" size="1.2rem" />
        <span className="memo-cp-lang-name">{LOCALE_LABELS[locale]}</span>
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
