/**
 * How often each part of the dashboard goes and gets fresh numbers.
 *
 * The cadences are set per source rather than globally, because what "current"
 * costs varies enormously:
 *
 * - Supabase reads are ours and cheap, so creator and user panels are never
 *   cached; they are as live as the page load.
 * - Stripe and Vercel are paginated third-party calls taking seconds. They are
 *   cached, and the page refreshes on that same beat so a left-open dashboard
 *   stays current without hammering either API.
 * - "Online now" is only useful if it is actually now, so it is never cached
 *   and is polled on its own faster interval.
 * - TikTok is billed per post scraped, so it stays on the daily cron. Refreshing
 *   the page must never trigger a scrape.
 */

/** Stripe and Vercel reads, and the page's own refresh beat. */
export const DASHBOARD_REFRESH_SECONDS = 15 * 60;

/** The live visitor count, which is worthless if it is stale. */
export const ONLINE_REFRESH_SECONDS = 60;
