# Memo design system

The rules for changing Memo's UI. Read this before any visual change; the short
version lives in [AGENTS.md](/AGENTS.md) under "Design rules".

Everything here is a description of `src/app/redesign.css` as it stands, not an
aspiration. Where the code still disagrees with a rule, that is noted.

## Where the design lives

| Layer | File | Scope | Use for |
| --- | --- | --- | --- |
| **App (canonical)** | `src/app/redesign.css` | `.memo`, `.memo-portal` | Everything inside the product |
| Legacy | `src/app/globals.css` | `:root` | Landing, paywall. Do not extend. |
| Onboarding | `src/app/onboarding.css` | `.memo-onboarding-v2` | Onboarding flow only |
| Paywall | `src/app/globals.css` | `.memo-paywall-shell` | Paywall only |

**New UI goes in the `.memo` layer.** If you are editing anything else you are on
a legacy surface — check which token names are in scope before typing a colour.
`onboarding.css` deliberately redeclares the redesign's token *names* with its own
values (`--bg: #030303` rather than `#121214`, and so on); a value that looks
familiar there is not the same value.

## Tokens

Declared on `.memo, .memo-portal` (`src/app/redesign.css:397`). Dark is declared
in **two** blocks:

- `:root[data-theme="dark"] .memo, .memo-portal` — the explicit dark setting.
- inside `@media (prefers-color-scheme: dark)`, covering both
  `:root:not([data-theme])` and `:root[data-theme="system"]`.

**A new token that changes between appearances must be added to both**, or dark
breaks silently. A token that is the same in both (`--coral`, `--blue`,
`--btn-*`) is declared once, in the light block.

### Ground and ink

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#f1f1f5` | `#121214` | The page. Nothing sits directly on it except floating chrome. |
| `--surface` | `#ffffff` | `#1f1f22` | Cards, rows, sheets, floating pills. |
| `--sunken` | `#f1f1f5` | `#2a2a2f` | A panel recessed *inside* a card. Dark steps **up**, not down. |
| `--tile` | `rgba(0,0,0,.05)` | `rgba(255,255,255,.09)` | Icon tiles, ghost buttons, quiet fills. |
| `--field` | `rgba(0,0,0,.07)` | `rgba(255,255,255,.11)` | Inputs, search, segment tracks. |
| `--line` | `rgba(0,0,0,.09)` | `rgba(255,255,255,.14)` | Hairlines and every button border (via `--btn-border`). |
| `--track` | `#e6e6ea` | `#3a3a3e` | Switch and slider tracks. |
| `--text` | `#000000` | `#ffffff` | Titles, body, values. |
| `--muted` | `#8e8e95` | `#9a9aa2` | Metadata, second lines, placeholders. |
| `--muted-2` | `#c4c4cc` | `#6a6a72` | Chevrons and disabled labels **only**. Never body copy. |
| `--ink` | `#17171a` | `#ffffff` | Neutral-primary fill: toast, active rail icon, progress bar. |
| `--emoji-tile` | periwinkle 13% | periwinkle 20% | Circle behind a note's emoji (desktop; phone uses `--tile`). |

### Accents

| Token | Value | Use |
| --- | --- | --- |
| `--coral` | `linear-gradient(135deg,#ff6d68,#f45f5a)` | The primary action, and only that. **It is a gradient** — it cannot be a border or a text colour. |
| `--promo` | `#f45f5a` light / `#ff6d68` dark | Solid coral: switch-on, notification dot, discount copy. |
| `--upgrade-tint` / `-line` / `-ink` | periwinkle | Upgrade prompts. Deliberately quieter than coral. |
| `--blue` | `#0066cc` | One button only (create-folder ready). Do not add a second. |

`--danger` (`#ff3b30` / `#ff453a`) and `--danger-tint` are declared in all three
blocks — use them for anything destructive or failed. They are new, so the ~58
older declarations still type `#ff3b30` and `rgba(255, 59, 48, 0.12)` by hand and
never lighten in dark; convert those as you touch them, and do not invent a third
red.

### Five colour rules

1. Page → card → panel is `--bg` → `--surface` → `--sunken`. Never nest a surface
   in a surface with nothing between them.
2. **One primary per screen.** Coral is the action, ink is the confirm, periwinkle
   is the upsell. They never appear in the same row.
3. Hover marks an **edge**, not a lift:
   `box-shadow: var(--shadow), inset 0 0 0 1px var(--hover-ring)`. Cards never
   translate.
4. Focus goes on the field's **container** using `--focus-ring`, never the
   browser's outline.
5. No scrollbars anywhere. `globals.css:267` hides them globally; content fades
   under floating chrome with a `mask-image` ramp instead.

## Type

System stack only —
`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif`.
No webfont for UI text. Tracking tightens as size grows; that negative tracking is
most of what makes Memo look like Memo.

| Size / weight / tracking | Use |
| --- | --- |
| `2rem / 800 / -0.045em` | Screen title (phone home) |
| `1.85rem / 800 / -0.04em` | Note title, section `h2` |
| `1.55rem / 800 / -0.035em` | Modal title |
| `1.3rem / 750 / -0.03em` | Question, sheet heading |
| `1.1rem / 600 / -0.02em` | Row title (desktop) |
| `1.08rem / 700 / -0.02em` | Settings / card-row title |
| `1.05rem / 750` | Button label |
| `0.92–0.95rem / 400` | Metadata, second line — always `--muted` |
| `0.78rem / 700 / +0.1em` | `.memo-eyebrow` — the only positive tracking |

Weights: 600 row titles · 650 quiet emphasis · 700 settings titles · 750 buttons
and tabs · 800 headings.

## Radius

Radius encodes size, not style: bigger box, rounder corner. Anything tappable that
is not a card is a pill (`999px`).

`12px` chips · `14px` inline error · `16px` text field · `18px` chat input, rail
item · `20px` note row, capture row · `22px` card, settings row, textarea ·
`26px` modal · `34px 34px 0 0` bottom sheet · `999px` every button, tile, badge.

A handful of one-off values survive from before the redesign (`3px`, `8px`, `9px`,
`10px`, `24px`, `28px`, `30px`). They are not part of the scale. Do not copy one
into new work, and do not add a tenth value.

## Spacing and heights

Gaps: `0.5rem` buttons in a row · `0.6rem` tabs and chips · `0.85rem` rows in a
list · `1.15rem` inside a row (tile → copy) · `1.6rem` section to section.

Heights: `2.6` segment · `2.7` chip / note action / small outline · `2.9` round
icon button (`--btn-round`) · `3.1` tab · `3.2` outline and solid button ·
`3.4` coral primary, search, dock · `3.6` field, modal CTA · `5.1` settings row ·
`5.4` note row.

Card padding: `0 1.5rem` fixed-height row · `1.2rem 1.6rem` wrapping card row ·
`1.5rem 1.6rem` content card · `2rem 2.1rem 2.1rem` modal.

## Elevation

- `--shadow` — every card and row. The default.
- `inset 0 0 0 1px var(--line), 0 8px 22px rgba(0,0,0,.16)` — floating chrome.
  The inset hairline is **required**: in dark, `--surface` barely separates from
  `--bg`.
- `0 30px 80px rgba(0,0,0,.24)` — modals. `--shadow-lg` is the upward variant for
  sheets.

A shadow inside a card reads as a smudge — use `--sunken` plus a `--line` border
instead.

## Motion

- `cubic-bezier(0.22, 1, 0.36, 1)` @ `180ms` — soft curve. Appearance, switches,
  small reveals.
- `cubic-bezier(0.2, 0.8, 0.2, 1)` @ `240ms` — standard. Screen and panel
  transitions.
- `cubic-bezier(0.32, 0.72, 0, 1)` @ `380–420ms` — **width changes only** (dock
  expanding, search opening).
- `0.16s ease` — hover and background feedback.

Entrances: `memo-fade-in` 0.18s (panels, screens), `memo-pop-in` 0.16–0.22s
(toasts, action rows, modals).

Never animate `height`, `top`, or shadow spread. `prefers-reduced-motion` is
already enforced globally in `globals.css:234` — never re-implement that check in
a component.

## Components — reuse before you write CSS

Buttons: `.memo-button-coral` (primary) · `.memo-button-solid` /
`.memo-primary-pill` (ink confirm) · `.memo-button-outline` + `.small` +
`.small.danger` (secondary) · `.memo-button-ghost` / `.memo-settings-signout`
(tile, no border) · `.memo-icon-button` (round, `--btn-round`).

Selection: `.memo-tab` / `.memo-tab.active` (16% `--tab-tint` fill +
`inset 0 0 0 1.5px`) · `.memo-segment` · `.memo-chip` (12px radius — the one
control that isn't a pill) · `.memo-switch` · `.memo-pill-count`.

Status: `.memo-note-badge` · `.memo-note-action` (+ `.danger`) ·
`.memo-inline-error` · `.memo-toast`.

Rows: `.memo-note-row` (5.4rem) · `.memo-settings-row` (5.1rem) ·
`.memo-card-row` (wraps, holds a control) · `.memo-capture-row` (sunken, inside a
modal) · `.memo-install-cta` (the one bordered banner).

Inputs: `.memo-search` and `.memo-chat-input` are `--field`, no border ·
`.memo-field` is `--surface` + `--line` border · `.memo-test-input` is
`--surface` + `--shadow`, no border.

Chrome: `.memo-folder-chip` · `.memo-dock-pill` · `.memo-rail-item` ·
`.memo-empty`.

Icons: `<Msym name="…" />` from `src/components/msym.tsx` — Material Symbols
Rounded. **Every name must also be added to `MATERIAL_SYMBOL_NAMES` in
`src/app/layout.tsx:31`**, which becomes the font's `icon_names` subset; a name
that is missing renders as literal text. Filled glyphs for solid affordances
(play, close, check), outlined for navigation and tools. Emoji
(`<Emoji symbol="…" />`) do the content iconography; Material Symbols are for
chrome only.

## Layout — one breakpoint, 1100px

There is no tablet layout and no intermediate state.

**Desktop (`min-width: 1100px`)** — `.memo-grid` at
`width: min(78%, 100% - 3rem)`, centred, `gap 1.25rem`, `padding-top 2rem`.
Columns `240px minmax(0,1fr)`; with chat open a third at `minmax(18rem,25rem)`.
The note screen is the exception: `4.5% / 1fr / 36.8%`, `gap 1.5%`. Reading
measure is capped at `max-width: 68rem`. The page scrolls; rail and chat columns
are `align-self: stretch` so sticky children have travel.

**Phone (`max-width: 1099px`)** — desktop chrome is switched off entirely
(`.memo-header`, `.memo-rail`, `.memo-chat-slot`, `.memo-homebar-wrap` →
`display: none`). `.memo-screen` is a fixed frame at
`inset: var(--memo-safe-top) 0 var(--memo-kb) 0`; `.memo-screen-scroll` is the one
scroller inside it; the shell is `100dvh / overflow: hidden`. Content fades under
floating chrome with
`mask-image: linear-gradient(to bottom, transparent 0, transparent 2.1rem, #000 3.9rem)`
and `padding-top: 4rem` — reuse those exact stops. Rows get **bigger**, not
smaller: taller tiles, heavier titles, wrapping text, swipe actions.

1100px is the only structural breakpoint. Three narrow-phone queries also exist
(`640px`, and a `479/480px` pair) for text that will not fit on a small handset.
They tune what is already there; do not build a layout inside one, and do not add
a fourth width.

Safe areas come from `--memo-safe-top` / `--memo-safe-bottom`, the keyboard from
`--memo-kb`. Never use raw `env(safe-area-inset-*)` in a component.

z-index ladder: folder chip 50 · search / dock 60 · phone home bar 80 · route
skeleton 90 · portalled sheets 105+ · toast 140 · nav progress 2000.

## Known inconsistencies

Real, and worth knowing before you copy a pattern out of the stylesheet:

1. **Destructive red is only half tokenised.** `--danger` / `--danger-tint` now
   exist and the auth screens use them, but ~58 older declarations still type the
   literal and stay light-mode red in dark.
2. **Coral has no solid token.** `--coral` is a gradient, so `#ff6d68` and
   `#f45f5a` are retyped by hand wherever coral must be a border or text colour.
3. **Three parallel token vocabularies** for the same concepts: `globals.css`
   (`--label`, `--separator`, `--surface-solid`, `--tint`), `redesign.css`
   (`--text`, `--line`, `--surface`), and `onboarding.css`, which reuses the
   redesign's names with different values.
4. **Nine button classes, four heights**, with overlapping roles:
   `.memo-button-solid` (3.2rem) and `.memo-primary-pill` (3rem) are the same ink
   button twice; `.memo-button-coral` and `.memo-sheet-coral` are the same
   primary twice; `.memo-create-folder.ready` is a third primary in `--blue`; and
   `.memo-subscribe-cta` uses an amber gradient that appears nowhere else,
   despite `--upgrade-*` existing to be the upgrade accent.
5. **Both dark blocks are written out longhand**, so they can drift. The
   `--upgrade-*` lines in the media block are already mis-indented. Values match
   today — keep them matching.
6. **Both stylesheets are flat and ~16k lines**, so a component's rules sit far
   from the media queries that override them. That is how
   `.memo-settings-signout` ended up styled only inside a phone-width query and
   rendered as a bare browser button between 480px and 1099px.

Fix them one at a time, with a commit each — every one is a wide find-and-replace
and a mistake is much easier to spot alone.
