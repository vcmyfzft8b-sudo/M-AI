# UGC creator program (`/ugc`)

The recruiting page for the UGC campaign, the application flow behind it, and the
creator Terms of Participation. Share **https://memoai.eu/ugc** (add `?ref=<tag>` to
see in the admin which post brought each applicant).

## Two campaigns, never shown together

| | Slovenia | Balkans (HR, BA, RS, ME, MK) |
| --- | --- | --- |
| TikTok, per video | €5 | €7 |
| Same video on Instagram Reels | +€1 | +€5 |
| Bonus | 20% of cash collected through the creator's code | €1 per 1,000 views, max €2,000 / month |
| Paid videos per month | 60 | 60 |
| Discord | discord.gg/4mae76zNhj ("UGC Memo AI +") | discord.gg/Dur6dfF2qD ("UGC Memo AI - Balkan") |

- The campaign is picked **on the server** from the IP country (`x-vercel-ip-country`):
  SI → Slovenia, HR/BA/RS/ME/MK → Balkans, anyone else by page language (hr/bs/sr →
  Balkans, otherwise Slovenia). There is no switch. `src/lib/ugc/creator-market.server.ts`.
- The pay figures and Discord invites live in `src/lib/ugc/creator-campaigns.ts`, which
  only server code imports. The page receives its own campaign's terms as a prop, so the
  other campaign's pay is in neither the HTML nor the JavaScript. A test fails if a client
  module imports that file or contains a `discord.gg` link.
- An allowlisted admin can open the other side with `/ugc?market=si|balkans` (and
  `/ugc/terms?market=…`); everyone else gets their own campaign whatever they type.
- An application is stored under the campaign the server resolved, and its country must
  be one of that campaign's (or "other").
- Locally there is no IP country, so the page follows the language cookie: Slovenian or
  English shows Slovenia, Croatian/Bosnian/Serbian shows the Balkans.

The headline stats (50M+ views, 1,000+ videos, 100+ creators) are kept by hand in
`CREATOR_PROGRAM_STATS` (`src/lib/ugc/creator-program.ts`); the source is not this
database. The calculator and the tier cards use the same arithmetic
(`estimateEarnings`, `tierRanges`); the Slovenian code bonus assumes one sale per 10,000
views at €32.50 collected.

## Example videos

The hero grid and the strip under the application card are real campaign posts: TikTok
videos classified as Memo AI, from creator accounts (not our own), most viewed first, at
most two per creator (`src/lib/ugc/creator-showcase.ts`). Stored covers expire, so
thumbnails come from TikTok's oEmbed and the list is cached for six hours. A tap plays the
post in TikTok's embed player. Both campaigns currently show the same posts.

## Design

The page is built one-to-one on the campaign page creators know from the owner's other
brand (megasheet.app/parakeet-ai), section for section, with Memo AI's logo, mascot and
coral in place of that brand's green: amber banner, floating nav, headline beside a
collage of real campaign videos, stats, calculator, five benefit cards, tiers, "who we're
looking for", four steps, "you're not doing this alone", the apply card and a two-column
FAQ. It uses Inter and a fixed light palette (`--cp-*` in `redesign.css`), so it looks the
same whatever the visitor's appearance setting. Copy uses `[[...]]` to mark the words set
in the accent colour.

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

The queue shows each applicant's video (uploaded file or embedded link) beside their
details. **Accept** saves the decision first, then emails the creator, in the language
they applied in, a personal join link (`/ugc/join/<token>`). **Reject** sends nothing.
Applicants from outside both campaigns get two accept buttons, one per campaign.

The join page shows the Terms of Participation for their campaign. The creator types
their name (a parent or guardian's too if they are under 18) and ticks the box; that
acceptance is recorded (`terms_version`, time, typed names, IP, browser) and only then is
the Discord invite shown. The admin card shows whether and when the terms were signed.

## Email

Sent through Resend's HTTP API. Set in Vercel (Production):

- `RESEND_API_KEY` — without it, Accept still works and the card says the email was not
  sent; **Send welcome email** retries once the key is set.
- `UGC_EMAIL_FROM` — optional, default `Memo AI <creators@memoai.eu>`. The domain must be
  verified in Resend. Replies go to info@memoai.eu.

## Terms of Participation

`src/lib/ugc/creator-terms-text.ts` holds the terms in all five languages (Slovenian
governs); `creator-terms.ts` fills in the pay and strips the other campaign's clauses.
**Bump `CREATOR_TERMS_VERSION` whenever a clause's meaning changes**, in every language
in the same commit; a creator whose page showed an older version is asked to reload.
Adapted from a third-party template for Memo AI, Nace Valenčič s.p., poslovno svetovanje.
They have not been reviewed by a lawyer.

## Database

Migration `0058_ugc_creator_applications.sql`: the `ugc_creator_applications` table
(service role only, RLS on, no policies) and the private `ugc-application-videos` bucket.
