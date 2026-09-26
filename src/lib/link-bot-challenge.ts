/**
 * Recognises a bot-protection interstitial served in place of the page a learner linked.
 *
 * Scribd, and every site behind Cloudflare's or F5's bot screens, answers a server-side fetch with
 * a "prove you are a browser" page. We used to read that page as the learner's material: a Scribd
 * textbook link became a note source reading "Client Challenge... A required part of this site
 * couldn't load", which then failed as having nothing to teach (2026-09-19). The learner was told
 * their material had no content, when the truth is that the site would not let us in, and the fix
 * is theirs to make in a second: download the document or copy its text.
 *
 * Pure, so it is unit-tested against the markers seen in the wild.
 */

const CHALLENGE_TITLES = [
  /^client challenge$/i,
  /^just a moment\.{0,3}$/i,
  /^attention required!? \| cloudflare$/i,
  /^access denied$/i,
  /^please wait\.{0,3}$/i,
  /^ddos-guard$/i,
  /^security check$/i,
];

const CHALLENGE_MARKERS = [
  /\/cdn-cgi\/challenge-platform\//i,
  /\bcf[-_]chl[-_]/i,
  /\/_fs-ch-[\w-]+\//i,
  /\bchecking your browser before accessing\b/i,
  /\ba required part of this site couldn[’']t load\b/i,
  /\benable javascript and cookies to continue\b/i,
  /\bverify you are (?:a )?human\b/i,
  /captcha-delivery\.com/i,
];

export function looksLikeBotChallenge(params: {
  html: string;
  title?: string | null;
  headers?: Pick<Headers, "get"> | null;
}) {
  if (params.headers?.get("cf-mitigated")?.toLowerCase() === "challenge") {
    return true;
  }

  const title = params.title?.trim() ?? "";

  if (title && CHALLENGE_TITLES.some((pattern) => pattern.test(title))) {
    return true;
  }

  // Markers alone are enough only on a small page: a long article that merely embeds a
  // Cloudflare script is a real page we can read.
  return params.html.length < 60_000 && CHALLENGE_MARKERS.some((pattern) => pattern.test(params.html));
}
