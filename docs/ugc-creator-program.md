# UGC creator program (`/ugc/slovenija`, `/ugc/balkan`)

The recruiting pages for the UGC campaign, the application flow behind them, and the
creator Terms of Participation. Each campaign has its own link:

- Slovenia: **https://memoai.eu/ugc/slovenija** (terms: `/ugc/slovenija/pogoji`)
- Balkans: **https://memoai.eu/ugc/balkan** (terms: `/ugc/balkan/uvjeti`)

Add `?ref=<tag>` to see in the admin which post brought each applicant. The short
`/ugc` (and the older `/ugc/terms`) redirects to the visitor's own campaign by IP.

## Two campaigns, never shown together

| | Slovenia | Balkans (HR, BA, RS, ME, MK) |
| --- | --- | --- |
| TikTok, per video | €5 | €7 |
| Same video on Instagram Reels | +€1 | +€5 |
| Bonus | 20% of cash collected through the creator's code | €1 per 1,000 views, max €2,000 / month |
| Paid videos per month | 60 | 60 |
| Discord | discord.gg/4mae76zNhj ("UGC Memo AI +") | discord.gg/Dur6dfF2qD ("UGC Memo AI - Balkan") |

- Two pages, one campaign each, each in **one language with no language switch**:
  Slovenian on the Slovenian page; on the Balkan page the visitor's Balkan language by IP
  (BA → Bosnian, RS/ME/MK → Serbian, anything else → Croatian). The language is forced by
  a nested `I18nProvider` with `persist={false}`, which does not touch the visitor's
  `memo-locale` cookie, so the app's language is not changed behind their back. The join
  page and the acceptance email use the same language (`campaignLocale`).
- The pages are **guarded on the server** by the IP country (`x-vercel-ip-country`, set
  by Vercel's edge): a visitor from Slovenia who opens the Balkan link is redirected to
  the Slovenian page, and a visitor from HR/BA/RS/ME/MK on the Slovenian link to the
  Balkan page (the terms pages likewise; `?ref=` survives). Visitors from anywhere else
  see the link they were given. Language and cookies play no part.
  `src/lib/ugc/creator-market.server.ts`, `src/components/ugc/creator-campaign-page.tsx`.
- The pay figures, Discord invites and the two campaigns' paths live in
  `src/lib/ugc/creator-campaigns.ts`, which only server code imports. The page receives
  its own campaign's terms and terms link as props, so the other campaign's pay and link
  are in neither the HTML nor the JavaScript. A test fails if a client module imports that
  file or contains a `discord.gg` link.
- An allowlisted admin is not redirected and sees an "Admin preview" bar on the other
  campaign's page.
- An application's campaign is the visitor's IP campaign when they have one (they can only
  have seen that page), else the page they applied on; the country must be one of that
  campaign's (or "other"). So every new application is stored as `si` or `balkans`; the
  `other` market (and its two "Accept into …" buttons in the admin) only covers older rows.
- Locally there is no IP country, so both links open; send the header to test the
  redirects (`curl -H "x-vercel-ip-country: HR" localhost:<port>/ugc/slovenija` → 307).

The headline stats (50M+ views, 1,000+ videos, 100+ creators) are kept by hand in
`CREATOR_PROGRAM_STATS` (`src/lib/ugc/creator-program.ts`); the source is not this
database. The calculator and the tier cards use the same arithmetic
(`estimateEarnings`, `tierRanges`); the Slovenian code bonus assumes one sale per 10,000
views, one in three yearly, at 20% of the price after the code's 50% discount (€2 per
monthly, €13 per yearly sale, from `billing.ts`).

## Example videos

The hero wall, the sideways row, the strip under the application card and the examples
in the form are real campaign posts (`src/lib/ugc/creator-showcase.ts`), **each creator's
few most viewed** (at most four, 3,000+ views, or the creator's single best), so the page
shows many different creators, all with videos that did well:

- from the dashboard: TikTok videos classified as Memo AI, from creator accounts;
- plus the recent posts of every profile in `SHOWCASE_PROFILES` and every dashboard
  account, read from TikTok's public creator embed (`tiktok.com/embed/@handle`, latest
  ~10 posts with cover and play count). A `dedicated` account's posts all count; from a
  `mixed` one only those whose caption mentions Memo. Previews run on staging, whose
  dashboard is empty, so there the wall comes from the embeds alone. Add a handle to
  feature a creator the dashboard does not track (some profiles refuse embedding: 400).

Covers come from the embed where it lists the post, otherwise from TikTok's oEmbed (three
at a time, one retry; TikTok answers bursts with 503s). The pool (up to 60) is cached for
six hours; an empty result is never cached. **Every visit shuffles the pool**
(`shuffleShowcase`) and each section takes its own stretch of it, so no two visits, and no
two sections, show the same order. A tap plays the post in TikTok's embed player. Both
campaigns draw from the same pool.

The hero follows the reference page's breakpoint, 1024px: wider, the headline sits left
and two columns of mixed-height tiles drift up and down; narrower, the headline is centred
over two faded covers with a row drifting sideways underneath.

## Applying

The same four steps as that page: **Format** (what to film, three example posts),
**Details** (legal first and last name, email, phone, country, age, optional referral
code — "for communication, contracts and payments"), **Demo video** (instructions: a title
on screen for the first 7 seconds, talk to the camera, show Memo AI; then an upload or a
link, one or the other) and **Confirm** (three checks — followed the instructions, title
visible for the first 7 seconds, not a random video — plus consent). Uploads go straight
from the phone to the private `ugc-application-videos` bucket on a signed URL (up to 200
MB, MP4/MOV/WebM/M4V/3GP). `POST /api/ugc/applications` validates with the same schema as
the form, is rate limited per IP, drops honeypot submissions silently, and keeps one
application per email.

## Reviewing (`/admin/applications`)

The two campaigns are reviewed apart. A switch at the top picks **Slovenia** or **Balkans**
(`?campaign=si|balkans`, Slovenia by default), each showing how many applications wait
for review. Everything below it belongs to that campaign only: the status tabs and their
counts, the stat cards, the page and terms links, and the Discord named in the hints. A
third "No campaign" tab appears only if an application was ever stored without one.

The queue shows each applicant's video (uploaded file or embedded link) beside their
details. **Accept** saves the decision first, then emails the creator, in the language
they applied in, a personal join link (`/ugc/join/<token>`). **Reject** sends nothing.
An application stored without a campaign (`other`, older rows only) gets two accept
buttons, one per campaign. Uploaded videos stay in the bucket's `pending/` folder.

An applicant uploads their video before sending the form, so an abandoned form or a
duplicate email leaves a file nothing points at. A daily job
(`/api/cron/ugc-pending-uploads`, 03:25 UTC, `CRON_SECRET`) deletes every `pending/` object
older than 24 hours that no application references (rule: `src/lib/ugc/pending-upload-plan.ts`).
A referenced video is never deleted, however old, and the job deletes nothing if it cannot
read which ones are referenced. Each run logs `[ugc-pending-uploads] Sweep complete` with
its counts; a failed delete goes to Sentry.

Signing takes one tap. The email's button ("Accept the terms and join") opens the join
page on a signing card, with the name from the application already filled in and one
button, "Accept and join". The sentence above the button says that tapping it accepts the
terms (version shown), and the full Terms of Participation for their campaign follow
below, linked from the card. A creator under 18 also gets a field for the parent or
guardian's name, and their email says so. There is no checkbox: the tap is the agreement.
It is always the person's own tap (a POST to `/api/ugc/join`). Opening the link never
signs anything, because mail scanners open links on their own. The acceptance is
recorded (`terms_version`, time, typed names, IP, browser) and only then is the Discord
invite shown. The admin card shows whether and when the terms were signed.

## Email

Sent through Resend's HTTP API, on the same Resend account and verified domain
(memoai.eu) as the sign-in codes. Those go out through Supabase Auth's SMTP settings
(`smtp.resend.com`, sender `Memo <no-reply@memoai.eu>`), and Supabase keeps only a hash
of that key, so the app cannot reuse it. It needs its own key in Vercel (Production):

- `RESEND_API_KEY` — a Resend API key with sending access (resend.com → API Keys). Without
  it, Accept still works and the card says the email was not sent; **Send welcome email**
  retries once the key is set.
- `UGC_EMAIL_FROM` — optional, default `Memo AI <creators@memoai.eu>` (any address on
  memoai.eu works, the domain is already verified). Replies go to info@memoai.eu.

## Contracts for creators already in the program

Creators who were in the program before applications existed each have their own deal,
so they get a contract with their own pay. On a creator's admin page, **Contract → Create a
contract** takes:
- the name to sign;
- an optional email, kept for the record (nothing is emailed);
- the campaign, plus the language for the Balkans;
- whether they are under 18;
- the pay, prefilled from the creator's dashboard rates:
  - per TikTok video;
  - the extra for the same video on Instagram;
  - per 1,000 views;
  - % of code sales;
  - a fixed monthly fee;
  - an optional bonus cap and video limit;
  - an optional special agreement, printed as its own clause.

**Nothing is sent to the creator.** The contract shows a signing link (`/ugc/join/<token>`)
with a Copy button, and the admin sends it themselves. The creator signs it like an
applicant: one tap, with a parent or guardian for a minor. A contract is never edited: a
changed deal is a new contract, and an unsigned one can be withdrawn (its link stops
opening). Two people sharing one creator row get a contract each.

**Every signature is stored for good**, with the exact text signed (`terms_snapshot`):
- contracts in `ugc_creator_contracts`;
- accepted applicants on their `ugc_creator_applications` row.

Alongside it go the typed names, the time, the terms version, the IP address and the
browser. **`/admin/contracts`** lists all of them, waiting, signed and withdrawn. Each
signed one opens the signature record and the text exactly as accepted.

## Terms of Participation

`src/lib/ugc/creator-terms-text.ts` holds the terms in all five languages (Slovenian
governs). `creator-terms.ts` fills them from a deal (`ContractPay`,
`src/lib/ugc/creator-pay.ts`): the campaign's standard pay for applicants, or a creator's
own pay for a contract. It writes section 4's pay list from whichever parts the deal has,
and 3.4's video limit. It keeps the code clauses only when the deal pays a code share,
and the view-bonus clause only when it pays for views. It drops the sample-video
comparison for creators who never applied, and strips the other campaign's clauses.
**Bump `CREATOR_TERMS_VERSION` whenever a clause's meaning changes**, in every language
in the same commit; a creator whose page showed an older version is asked to reload.
Adapted from a third-party template for Memo AI, Nace Valenčič s.p., poslovno svetovanje.
They have not been reviewed by a lawyer.

## Database

Migration `0059_ugc_creator_contracts.sql`: `ugc_creator_contracts` (service role only,
RLS on, no policies) and `terms_snapshot` on applications. It was applied to shared staging
on 2026-10-11 to test creating, signing (adult and minor), withdrawing and storing
contracts end to end; production gets it on merge.

Migration `0058_ugc_creator_applications.sql`: the `ugc_creator_applications` table
(service role only, RLS on, no policies) and the private `ugc-application-videos` bucket.
Until it reaches production (on merge), submitting from a dev server on the production
`.env.local` fails with a 500: the table is not there.

**Tested end to end on shared staging on 2026-10-11** (0058 applied there with
`supabase db push --db-url <staging>`, the only pending migration): applying with a link
and with an upload, duplicate email, missing video, wrong country for the IP, a never-
uploaded path, the admin queue, accept (email recorded as not sent without Resend),
the join page with a guardian, and reject. The test rows, the uploaded file and the
temporary admin were removed afterwards; 0058 stays on staging as the PR under test.
