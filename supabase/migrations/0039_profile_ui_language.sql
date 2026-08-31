-- ---------------------------------------------------------------------------
-- The language the app is shown in, per account
-- ---------------------------------------------------------------------------
--
-- Memo now ships in Slovenian, English, Croatian, Bosnian and Serbian. Which
-- one a visitor gets is decided per request from the `memo-locale` cookie,
-- falling back to the country their IP resolves to and then to English.
--
-- A cookie is per-browser, so on its own it loses the choice the moment
-- somebody signs in on their phone as well as their laptop, or clears site
-- data. `ui_language` is the durable copy: it is written whenever the picker
-- is used, and read back at sign-in to re-seed the cookie on the new device.
--
--   null  — never chosen. Detection decides, every time. Every existing
--           account starts here, which is correct: they have been using a
--           Slovenian app and detection will keep giving them Slovenian in
--           Slovenia, without us having claimed they picked it.
--   text  — one of the five locale codes, checked below.
--
-- The check constraint is deliberate even though the application validates the
-- value as well (src/lib/i18n/locales.ts). The set changes about as often as we
-- enter a country, and a typo'd code here would render as untranslated keys
-- rather than as an error.

alter table public.profiles
  add column if not exists ui_language text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_ui_language_check'
  ) then
    alter table public.profiles
      add constraint profiles_ui_language_check
      check (ui_language is null or ui_language in ('sl', 'en', 'hr', 'bs', 'sr'));
  end if;
end
$$;
