// A link that sits behind a sign-in is the most common way a link import fails for a
// student: campus material lives in Moodle, Canvas or a Microsoft 365 tenant, and the
// URL they copy out of the address bar is only readable while their own browser session
// is attached. Our fetcher carries no cookies, so the site bounces it to a login form and
// we end up summarising that form instead of the material.
//
// The login page then fails extraction for an incidental reason — `stripNoisyHtml` drops
// `<form>`, and a login page is almost entirely form — so the learner used to be told
// "this page does not contain enough readable text", which points at the wrong thing and
// leaves retry as the only offered action even though retry can never succeed.
//
// These helpers recognise the sign-in wall so the failure can say what actually happened.
// They only ever change the wording of a failure: the caller consults them after a fetch
// has already failed or come back too thin, never to decide whether to keep reading.

export const LINK_LOGIN_WALL_CODE = "link_requires_login";

export const LINK_LOGIN_WALL_MESSAGE =
  "Za ogled te povezave je potrebna prijava, zato je nismo mogli prebrati. " +
  "Odpri jo v brskalniku, kjer si prijavljen, shrani gradivo kot datoteko (npr. PDF) in ga naloži sem.";

// Matched against whole path segments, never as substrings, so an article at
// /blog/login-security is not mistaken for a login form.
const LOGIN_PATH_SEGMENTS = new Set([
  "adfs",
  "auth",
  "authenticate",
  "authorize",
  "cas",
  "idp",
  "login",
  "logon",
  "oauth",
  "oauth2",
  "openid",
  "saml",
  "saml2",
  "signin",
  "sign-in",
  "sign_in",
  "sso",
]);

// Some stacks put the whole thing in a file name rather than a directory.
const LOGIN_FILE_NAMES = new Set([
  "login.aspx",
  "login.jsp",
  "login.php",
  "signin.aspx",
  "signin.php",
  "wp-login.php",
]);

// Landing on one of these hosts means an identity provider took over, whatever the path
// looks like. Matched on the host itself or as a parent domain.
const IDENTITY_PROVIDER_HOSTS = [
  "aai.arnes.si",
  "accounts.google.com",
  "auth0.com",
  "duosecurity.com",
  "login.live.com",
  "login.microsoftonline.com",
  "okta.com",
  "onelogin.com",
  "sts.windows.net",
];

function isIdentityProviderHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");

  return IDENTITY_PROVIDER_HOSTS.some(
    (host) => normalized === host || normalized.endsWith(`.${host}`),
  );
}

/**
 * True when a URL is a sign-in endpoint rather than readable material — either because an
 * identity provider owns the host, or because the path is a recognisable login route.
 */
export function isLoginWallUrl(value: string | URL) {
  let url: URL;

  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }

  if (isIdentityProviderHost(url.hostname)) {
    return true;
  }

  const segments = url.pathname
    .toLowerCase()
    .split("/")
    .filter((segment) => segment.length > 0);

  if (segments.some((segment) => LOGIN_PATH_SEGMENTS.has(segment))) {
    return true;
  }

  return segments.length > 0 && LOGIN_FILE_NAMES.has(segments[segments.length - 1]);
}

/**
 * True when a fetched page is itself a sign-in form. A password field is the signal:
 * nothing else on the readable web asks for one, so this stays specific even though the
 * markup around it varies wildly between Moodle, Canvas and a bare corporate portal.
 */
export function looksLikeLoginPage(html: string) {
  if (typeof html !== "string" || html.length === 0) {
    return false;
  }

  return /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(html);
}
