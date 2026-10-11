import {
  resendAcceptanceEmailAction,
  reviewApplicationAction,
  saveApplicationNotesAction,
} from "@/app/admin/(dashboard)/actions";
import { ActionForm, InlineAction, SubmitButton } from "@/components/admin/forms";
import { PendingLink } from "@/components/admin/pending-link";
import { Badge, EmptyState, formatDateTime, formatRelative, Section, StatCard } from "@/components/admin/ui";
import { isApplicationStatus, listApplications } from "@/lib/admin/applications";
import { requireAdmin } from "@/lib/admin/auth";
import type { UgcApplicationStatus, UgcCreatorApplicationRow } from "@/lib/database.types";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { APPLICATION_VIDEO_BUCKET, videoEmbedUrl } from "@/lib/ugc/creator-application";
import { CREATOR_CAMPAIGN_PATHS, CREATOR_TERMS_PATHS } from "@/lib/ugc/creator-campaigns";
import { creatorJoinUrl } from "@/lib/ugc/send-acceptance-email";

export const dynamic = "force-dynamic";

type Filter = UgcApplicationStatus | "all";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "new", label: "To review" },
  { value: "approved", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const MARKET_LABEL: Record<string, string> = { si: "Slovenia", balkans: "Balkans", other: "Other country" };

type Campaign = "si" | "balkans" | "other";

/**
 * The two campaigns are reviewed separately, each with its own queue, counts and links.
 * `other` only exists for applications stored without a campaign (none since the two
 * pages split), so its tab appears only when there is one.
 */
const CAMPAIGNS: Array<{ value: Campaign; label: string; flag: string; discord?: string }> = [
  { value: "si", label: "Slovenia", flag: "🇸🇮", discord: "UGC Memo AI +" },
  { value: "balkans", label: "Balkans", flag: "🇭🇷🇧🇦🇷🇸🇲🇪🇲🇰", discord: "UGC Memo AI - Balkan" },
  { value: "other", label: "No campaign", flag: "" },
];

function isCampaign(value: unknown): value is Campaign {
  return value === "si" || value === "balkans" || value === "other";
}

function applicationsHref(campaign: Campaign, status: Filter) {
  return `/admin/applications?campaign=${campaign}&status=${status}`;
}

const COUNTRY_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code: string) {
  return code === "ZZ" ? "Other" : (COUNTRY_NAMES.of(code) ?? code);
}

/** One hour is long enough to watch a queue's worth of videos; the page refreshes them on load. */
const VIDEO_URL_SECONDS = 60 * 60;

async function signVideoUrls(rows: UgcCreatorApplicationRow[]): Promise<Map<string, string>> {
  const paths = rows.map((row) => row.sample_video_path).filter((path): path is string => Boolean(path));

  if (paths.length === 0) {
    return new Map();
  }

  const { data } = await createSupabaseServiceRoleClient()
    .storage.from(APPLICATION_VIDEO_BUCKET)
    .createSignedUrls(paths, VIDEO_URL_SECONDS);

  return new Map(
    (data ?? [])
      .filter((entry) => entry.path && entry.signedUrl)
      .map((entry) => [entry.path as string, entry.signedUrl]),
  );
}

/**
 * Creator applications from the public page at `/ugc`: watch the sample video, then
 * accept or reject. Accepting emails the creator their campaign's Discord invite.
 */
export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; campaign?: string }>;
}) {
  // The layout checks too, but this page shows applicants' contact details.
  await requireAdmin();

  const params = await searchParams;
  const filter: Filter = params?.status === "all" || isApplicationStatus(params?.status) ? (params?.status as Filter) : "new";

  const campaign: Campaign = isCampaign(params?.campaign) ? (params?.campaign as Campaign) : "si";
  const everyApplication = await listApplications();
  const campaignOf = (row: UgcCreatorApplicationRow): Campaign => (isCampaign(row.market) ? row.market : "other");
  const perCampaign = Object.fromEntries(
    CAMPAIGNS.map((option) => [
      option.value,
      {
        all: everyApplication.filter((row) => campaignOf(row) === option.value).length,
        new: everyApplication.filter((row) => campaignOf(row) === option.value && row.status === "new").length,
      },
    ]),
  ) as Record<Campaign, { all: number; new: number }>;
  const campaigns = CAMPAIGNS.filter((option) => option.value !== "other" || perCampaign.other.all > 0 || campaign === "other");
  const current = CAMPAIGNS.find((option) => option.value === campaign) ?? CAMPAIGNS[0];

  // Everything below is the chosen campaign's alone.
  const applications = everyApplication.filter((row) => campaignOf(row) === campaign);
  const counts = {
    new: applications.filter((row) => row.status === "new").length,
    approved: applications.filter((row) => row.status === "approved").length,
    rejected: applications.filter((row) => row.status === "rejected").length,
    all: applications.length,
  };
  // The queue reads oldest first, so nobody waits longest; the other lists newest first.
  const shown = applications.filter((row) => filter === "all" || row.status === filter);

  if (filter === "new") {
    shown.reverse();
  }

  const videoUrls = await signVideoUrls(shown);
  const signedTerms = applications.filter((row) => row.status === "approved" && row.terms_accepted_at).length;
  const unsentEmails = applications.filter((row) => row.status === "approved" && !row.accepted_email_sent_at).length;

  return (
    <>
      <header className="admin-header">
        <h1 className="admin-title">Applications</h1>
      </header>

      <nav className="admin-campaigns" aria-label="Campaign">
        {campaigns.map((option) => (
          <PendingLink
            key={option.value}
            href={applicationsHref(option.value, filter)}
            className="admin-campaign"
            data-active={option.value === campaign}
          >
            {option.flag ? (
              <span className="admin-campaign-flag" aria-hidden="true">
                {option.flag}
              </span>
            ) : null}
            <span className="admin-campaign-name">{option.label}</span>
            <span className="admin-campaign-meta">
              {perCampaign[option.value].new > 0
                ? `${perCampaign[option.value].new} to review`
                : `${perCampaign[option.value].all} application${perCampaign[option.value].all === 1 ? "" : "s"}`}
            </span>
          </PendingLink>
        ))}
      </nav>

      <div className="admin-header">
        <div>
          <p className="admin-subtitle">
            {campaign === "other" ? (
              <>Applications stored without a campaign. Accept each into Slovenia or the Balkans.</>
            ) : (
              <>
                {current.label} campaign: creators who applied at{" "}
                <a className="admin-link" href={CREATOR_CAMPAIGN_PATHS[campaign]} target="_blank" rel="noreferrer">
                  memoai.eu{CREATOR_CAMPAIGN_PATHS[campaign]}
                </a>
                . Accepting emails them a link to sign the{" "}
                <a className="admin-link" href={CREATOR_TERMS_PATHS[campaign]} target="_blank" rel="noreferrer">
                  {current.label} terms
                </a>
                ; signing reveals the “{current.discord}” Discord.
              </>
            )}
          </p>
        </div>
        <nav className="admin-range" aria-label="Status">
          {FILTERS.map((option) => (
            <PendingLink
              key={option.value}
              href={applicationsHref(campaign, option.value)}
              className="admin-range-item"
              data-active={option.value === filter}
            >
              {option.label} ({counts[option.value]})
            </PendingLink>
          ))}
        </nav>
      </div>

      <div className="admin-grid">
        <StatCard label="To review" value={String(counts.new)} meta="Waiting for a decision" />
        <StatCard
          label="Accepted"
          value={String(counts.approved)}
          meta={
            unsentEmails > 0
              ? `${unsentEmails} welcome email${unsentEmails === 1 ? "" : "s"} not sent`
              : `${signedTerms} of ${counts.approved} signed the terms`
          }
        />
        <StatCard
          label="Rejected"
          value={String(counts.rejected)}
          meta={`${counts.all} ${current.label} application${counts.all === 1 ? "" : "s"} in all`}
        />
      </div>

      <Section
        title={FILTERS.find((option) => option.value === filter)?.label}
        hint={
          filter === "new"
            ? campaign === "other"
              ? "Oldest first. Pick the campaign each creator joins."
              : `Oldest first. Accepted creators join the “${current.discord}” Discord.`
            : undefined
        }
      >
        {shown.length === 0 ? (
          <EmptyState
            title={filter === "new" ? `Nothing from ${current.label} waiting for review` : "No applications here yet"}
          >
            {campaign === "other" ? (
              "Every new application belongs to a campaign."
            ) : (
              <>
                Share memoai.eu{CREATOR_CAMPAIGN_PATHS[campaign]} (add <code>?ref=name</code> to see where people
                came from).
              </>
            )}
          </EmptyState>
        ) : (
          <div className="admin-applications">
            {shown.map((application) => (
              <ApplicationCard
                key={application.id}
                application={application}
                videoUrl={application.sample_video_path ? (videoUrls.get(application.sample_video_path) ?? null) : null}
              />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

function ApplicationCard({
  application,
  videoUrl,
}: {
  application: UgcCreatorApplicationRow;
  videoUrl: string | null;
}) {
  const embed = application.sample_video_url ? videoEmbedUrl(application.sample_video_url) : null;
  const known = application.market === "si" || application.market === "balkans";
  const id = { application_id: application.id };

  return (
    <article className="admin-application" data-status={application.status}>
      <div className="admin-application-video">
        {videoUrl ? (
          <video src={videoUrl} controls playsInline preload="metadata" />
        ) : embed ? (
          <iframe src={embed} title={`Sample video from ${application.full_name}`} allow="encrypted-media; fullscreen" allowFullScreen />
        ) : (
          <div className="admin-application-novideo">
            {application.sample_video_path ? "The uploaded video could not be loaded." : "No playable video."}
          </div>
        )}
        {application.sample_video_url ? (
          <a className="admin-link" href={application.sample_video_url} target="_blank" rel="noreferrer">
            Open the video link ↗
          </a>
        ) : null}
      </div>

      <div className="admin-application-body">
        <header className="admin-application-head">
          <div>
            <h3 className="admin-application-name">
              {application.full_name}
              {application.age ? <span>, {application.age}</span> : null}
            </h3>
            <p className="admin-help">
              Applied {formatRelative(application.created_at)} · {formatDateTime(application.created_at)}
              {application.referrer ? ` · via ${application.referrer}` : ""}
            </p>
          </div>
          <div className="admin-application-badges">
            <Badge tone={application.market === "other" ? "red" : "blue"}>
              {application.market === "other"
                ? `${MARKET_LABEL.other} · ${countryName(application.country)}`
                : countryName(application.country)}
            </Badge>
            {application.status === "approved" ? <Badge tone="green">Accepted</Badge> : null}
            {application.status === "rejected" ? <Badge tone="grey">Rejected</Badge> : null}
          </div>
        </header>

        <dl className="admin-application-facts">
          <div>
            <dt>Email</dt>
            <dd>
              <a className="admin-link" href={`mailto:${application.email}`}>
                {application.email}
              </a>
            </dd>
          </div>
          {application.phone ? (
            <div>
              <dt>Phone</dt>
              <dd>
                <a
                  className="admin-link"
                  href={`https://wa.me/${application.phone.replace(/[^\d]/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {application.phone}
                </a>
              </dd>
            </div>
          ) : null}
          {application.tiktok_handle ? (
            <div>
              <dt>TikTok</dt>
              <dd>
                <a className="admin-link" href={`https://www.tiktok.com/@${application.tiktok_handle}`} target="_blank" rel="noreferrer">
                  @{application.tiktok_handle}
                </a>
              </dd>
            </div>
          ) : null}
          {application.instagram_handle ? (
            <div>
              <dt>Instagram</dt>
              <dd>
                <a className="admin-link" href={`https://www.instagram.com/${application.instagram_handle}`} target="_blank" rel="noreferrer">
                  @{application.instagram_handle}
                </a>
              </dd>
            </div>
          ) : null}
          {application.referral_code ? (
            <div>
              <dt>Referral code</dt>
              <dd>{application.referral_code}</dd>
            </div>
          ) : null}
          {application.studies ? (
            <div>
              <dt>Studies</dt>
              <dd>{application.studies}</dd>
            </div>
          ) : null}
          <div>
            <dt>Language</dt>
            <dd>{application.locale.toUpperCase()}</dd>
          </div>
        </dl>

        {application.message ? <blockquote className="admin-application-message">{application.message}</blockquote> : null}

        {application.status === "approved" ? (
          <div className="admin-application-email">
            {application.accepted_email_sent_at ? (
              <p className="admin-help">Welcome email sent {formatRelative(application.accepted_email_sent_at)}.</p>
            ) : (
              <p className="admin-application-warning">
                Welcome email not sent{application.accepted_email_error ? `: ${application.accepted_email_error}` : "."}
              </p>
            )}
            {application.terms_accepted_at ? (
              <p className="admin-help">
                {application.discord_opened_at ? (
                  <Badge tone="green">Opened the Discord invite {formatRelative(application.discord_opened_at)}</Badge>
                ) : (
                  <Badge tone="red">Has not opened the Discord invite yet</Badge>
                )}
              </p>
            ) : null}
            {application.terms_accepted_at ? (
              <p className="admin-help">
                <Badge tone="green">Terms signed</Badge> by {application.terms_signed_name}
                {application.terms_guardian_name ? ` with guardian ${application.terms_guardian_name}` : ""} ·{" "}
                {formatDateTime(application.terms_accepted_at)} · version {application.terms_version}
                {application.terms_accepted_ip ? ` · IP ${application.terms_accepted_ip}` : ""}
              </p>
            ) : (
              <p className="admin-help">
                Terms not signed yet, so no Discord invite yet. Their join link:{" "}
                <a className="admin-link" href={creatorJoinUrl(application.join_token)} target="_blank" rel="noreferrer">
                  {creatorJoinUrl(application.join_token)}
                </a>
              </p>
            )}
          </div>
        ) : null}

        <div className="admin-application-actions">
          {application.status === "new" ? (
            <>
              {known ? (
                <InlineAction action={reviewApplicationAction} fields={{ ...id, decision: "approve" }} variant="primary">
                  Accept &amp; send invite
                </InlineAction>
              ) : (
                <>
                  <InlineAction action={reviewApplicationAction} fields={{ ...id, decision: "approve", campaign: "si" }} variant="primary">
                    Accept into Slovenia
                  </InlineAction>
                  <InlineAction action={reviewApplicationAction} fields={{ ...id, decision: "approve", campaign: "balkans" }} variant="primary">
                    Accept into Balkans
                  </InlineAction>
                </>
              )}
              <InlineAction
                action={reviewApplicationAction}
                fields={{ ...id, decision: "reject" }}
                variant="danger"
                confirm={`Reject ${application.full_name}? They are not emailed.`}
              >
                Reject
              </InlineAction>
            </>
          ) : (
            <>
              {application.status === "approved" ? (
                <InlineAction
                  action={resendAcceptanceEmailAction}
                  fields={id}
                  variant="default"
                  confirm={application.accepted_email_sent_at ? `Send ${application.full_name} the welcome email again?` : undefined}
                >
                  {application.accepted_email_sent_at ? "Send email again" : "Send welcome email"}
                </InlineAction>
              ) : null}
              {/* A signed agreement stays on record: it cannot be reopened or rejected. */}
              {application.terms_accepted_at ? null : (
                <InlineAction action={reviewApplicationAction} fields={{ ...id, decision: "reopen" }}>
                  Move back to review
                </InlineAction>
              )}
            </>
          )}
        </div>

        <ActionForm action={saveApplicationNotesAction} className="admin-application-notes">
          <input type="hidden" name="application_id" value={application.id} />
          <textarea
            className="admin-textarea"
            name="admin_notes"
            placeholder="Private note (only admins see this)"
            defaultValue={application.admin_notes ?? ""}
            rows={2}
          />
          <div>
            <SubmitButton size="sm" variant="ghost" pendingLabel="Saving…">
              Save note
            </SubmitButton>
          </div>
        </ActionForm>

        {application.reviewed_by && application.status !== "new" ? (
          <p className="admin-help">
            {application.status === "approved" ? "Accepted" : "Rejected"} by {application.reviewed_by}{" "}
            {formatRelative(application.reviewed_at)}.
          </p>
        ) : null}
      </div>
    </article>
  );
}
