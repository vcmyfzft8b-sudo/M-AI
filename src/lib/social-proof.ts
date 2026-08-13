/* User count for the landing hero.

   This is a maintained figure, not a live query. Registrations sit across
   several regional databases the web app does not read from, so a
   `select count(*)` here would undercount badly. The banner starts from the
   baseline below and ticks upward during each visit — per visitor, in their
   own browser, so it is not a shared counter that everyone watches move in
   lockstep. Nothing is written anywhere; the ticking is display only.

   Keep BASE honest: bump it when the real all-region total moves. */

export const USER_COUNT_BASE = 25_341;

/* Roughly how many sign-ups a minute the ticker implies. Increments land at
   random intervals averaging this rate, never on a fixed beat. */
export const USER_COUNT_PER_MINUTE = 15;

/* Slovenian counts take a different form per remainder, and the adjective has
   to follow the noun into each one:
   1 registriran uporabnik · 2 registrirana uporabnika ·
   3–4 registrirani uporabniki · everything else registriranih uporabnikov. */
export function registeredUsersLabel(count: number): string {
  const rest = count % 100;
  if (rest === 1) return "registriran uporabnik";
  if (rest === 2) return "registrirana uporabnika";
  if (rest === 3 || rest === 4) return "registrirani uporabniki";
  return "registriranih uporabnikov";
}

export function formatUserCount(count: number): string {
  return new Intl.NumberFormat("sl-SI").format(count);
}
