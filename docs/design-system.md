# Memo design system — rules for changing the UI

Read this before any UI change. The short version is the "Design rules" block at
the bottom, which is also pasted into `AGENTS.md` so every agent session picks it
up without being told to.

The browsable version of this document (with live specimens in both appearances)
is the `Memo Design System.dc.html` artifact.

---

## Where the design lives

| Layer | File | Scope | Use for |
| --- | --- | --- | --- |
| **App (canonical)** | `src/app/redesign.css` | `.memo`, `.memo-portal` | Everything inside the product |
| Legacy | `src/app/globals.css` | `:root` | Auth, landing, paywall. Do not extend. |
| Onboarding | `src/app/onboarding.css` | `.memo-onboarding-v2` | Onboarding flow only |
| Paywall | `src/app/globals.css` | `.memo-paywall-shell` | Paywall only |

**New UI goes in the `.memo` layer.** If you are editing anything else, you are in
a legacy surface — check which token names are in scope before typing a colour.

## Tokens

Declared on `.memo, .memo-portal`. Dark is re-declared in **three** places:
`[data-theme="dark"]`, `[data-theme="system"]`, and the bare
`prefers-color-scheme: dark` block. **A new token must be added to all three** or
dark mode breaks silently.

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
| `--coral` | `linear-gradient(135deg,#ff6d68,#f45f5a)` | The primary action, and only that. **It is a gradient** — cannot be a border or text colour. |
| `--promo` | `#f45f5a` / `#ff6d68` | Solid coral: switch-on, notification dot, discount copy. |
| `--upgrade-tint/-line/-ink` | periwinkle | Upgrade prompts. Deliberately quieter than coral. |
| `--blue` | `#0066cc` | One button only (create-folder ready). Do not add a second. |

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
5. No scrollbars anywhere. `globals.css` hides them globally; content fades under
   floating chrome with a `mask-image` ramp.

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

A shadow inside a card reads as a smudge — use `--sunken` + a `--line` border
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
already enforced globally in `globals.css` — never re-implement that check.

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
Rounded. **Every name must also be added to the `icon_names` subset in
`src/app/layout.tsx`**, or the ligature renders as literal text. Filled glyphs for
solid affordances (play, close, check), outlined for navigation and tools.
Emoji (`<Emoji symbol="…" />`) do the content iconography; Material Symbols are
for chrome only.

## Layout — one breakpoint, 1100px

There is no tablet layout and no intermediate state.

**Desktop (`min-width: 1100px`)** — `.memo-grid` at
`width: min(78%, 100% - 3rem)`, centred, `gap 1.25rem`, `padding-top 2rem`.
Columns `240px minmax(0,1fr)`; with chat open a third at
`minmax(18rem,25rem)`. The note screen is the exception: `4.5% / 1fr / 36.8%`,
`gap 1.5%`. Reading measure capped at `max-width: 68rem`. The page scrolls; rail
and chat columns are `align-self: stretch` so sticky children have travel.

**Phone (`max-width: 1099px`)** — desktop chrome is switched off entirely
(`.memo-header`, `.memo-rail`, `.memo-chat-slot`, `.memo-homebar-wrap` →
`display:none`). `.memo-screen` is a fixed frame at
`inset: var(--memo-safe-top) 0 var(--memo-kb) 0`; `.memo-screen-scroll` is the one
scroller inside it; the shell is `100dvh / overflow:hidden`. Content fades under
floating chrome with
`mask-image: linear-gradient(to bottom, transparent 0, transparent 2.1rem, #000 3.9rem)`
and `padding-top: 4rem` — reuse those exact stops. Rows get **bigger**, not
smaller: taller tiles, heavier titles, wrapping text, swipe actions.

Safe areas come from `--memo-safe-top` / `--memo-safe-bottom`, keyboard from
`--memo-kb`. Never use raw `env(safe-area-inset-*)` in a component.

z-index ladder: folder chip 50 · search / dock 60 · phone home bar 80 · route
skeleton 90 · portalled sheets 105+ · toast 140 · nav progress 2000.

---

## Design rules (paste this block into AGENTS.md / CLAUDE.md)

```md
## Design rules

Read `docs/design-system.md` before any UI change. In short:

- New UI goes in the `.memo` layer (`src/app/redesign.css`). `globals.css` is
  legacy — do not extend it.
- Never type a raw colour. Use a token. If a token is missing, add it to the
  `.memo` block AND all three dark blocks (`[data-theme="dark"]`,
  `[data-theme="system"]`, bare `prefers-color-scheme`).
- Reuse an existing `.memo-*` component before writing CSS. New classes are
  `.memo-*` and live in `redesign.css`, not in a component file.
- One primary action per screen, and it is coral. Ink confirms; periwinkle upsells.
- Hover marks an edge (`inset 0 0 0 1px var(--hover-ring)`), never a lift. Focus
  goes on the container via `--focus-ring`.
- Snap to the existing scales: radius 12/14/16/18/20/22/26/999, the nine type
  sizes, the listed control heights. Do not introduce new values.
- One breakpoint: 1100px. Build the phone layout first; desktop is the rail
  wrapped around it. One scroller per screen, never `scrollIntoView`, never a
  visible scrollbar.
- Every user-facing string comes from the i18n catalogue. No literal copy in a
  component — there are coverage tests.
- New Material Symbols names must be added to `icon_names` in
  `src/app/layout.tsx`.
- `prefers-reduced-motion` is handled globally. Do not re-implement it.
```
