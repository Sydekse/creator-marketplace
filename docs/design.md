# Creator Marketplace — Design System

The visual reference for every screen in the product: the **landing page** is the
canonical expression of this theme, and the app (auth, admin, brand, creator)
runs on the same system. This document is the single source of truth for _why_
things look the way they do — the tokens, the rules, and the exceptions. If a
page disagrees with this document, the page is wrong.

The rollout shipped as **KAN-83 → KAN-91** (tokens → typography → primitives →
shared components → per-area passes → decommission). This document reads as a
description of the app as it is, not an aspiration.

---

## 1. The idea in one paragraph

The product is an editorial, monochrome workspace. It borrows the calm of a
printed magazine — serif display headlines, generous white space, hairline
rules between sections — and pairs it with the precision of a modern tool.
There is exactly **one accent color** (a low-saturation teal) and it is spent
like money: on the words that matter, the state that matters, and nothing else.
Everything else lives on the neutral scale, so the accent always pops and the
interface never shouts.

Two moods share one system:

| Mood          | Where                                          | Character                                     |
| ------------- | ---------------------------------------------- | --------------------------------------------- |
| **Editorial** | Landing page, page-level headers, empty states | Airy, serif-led, magazine rhythm              |
| **Working**   | Tables, ledgers, worklists, forms              | Dense, sans-led, tight but on the same tokens |

The difference between the two is _density_, never identity. Same fonts
(different roles), same colors, same radii, same borders.

---

## 2. Principles

These come first. Everything else in this document is a concrete instance of
them.

1. **One accent, spent sparingly.** The teal is reserved for emphasis phrases,
   section labels, active states, links, and focus. Primary buttons are ink.
   Status has its own tinted vocabulary (teal/amber/red) that never crosses
   into brand-accent territory.
2. **Low saturation, no extremes.** No pure black `#000`, no pure white `#FFF`.
   Use tinted variations (`neutral-900`, `neutral-50`) and low-saturation oklch
   colors. Halation (blurry fringing at pure black/white edges) is a bug.
3. **Text must be readable.** AA (4.5:1) is the floor for body text, AAA (7:1)
   the target. UI borders and icons need 3:1. No exceptions for "it's just a
   footnote".
4. **Everything is on the 4px grid.** Spacing, gaps, padding — multiples of 4.
   The only permitted fractional spacing is the optical nudge on the play
   triangle (`ml-0.5`).
5. **Radii nest concentrically.** `inner = outer − padding`. A 24px frame with
   12px padding contains 12px cards; a 12px card with 8px padding contains 4px
   blocks.
6. **One icon family, one weight.** Lucide, `strokeWidth={1.5}`, everywhere.
   Filled variants are allowed only to show an active state.
7. **Depth is earned, not default.** Hairlines carry structure; shadows are a
   soft ambient glow used only in light mode and only where a surface must
   float (nav pill, mockup frames).
8. **Motion is a whisper.** Smooth easings (`cubic-bezier(0.22, 1, 0.36, 1)`),
   short durations, and everything gated behind `prefers-reduced-motion`.
   Motion explains, it never entertains.
9. **Micro-interactions are mandatory on interactive things.** Hover lift,
   `active:scale-0.98`, focus rings, shine sweep on primary buttons. A dead
   control is a missed product.

---

## 3. Color

### 3.1 The neutral scale (the whole canvas)

The interface is built from the Tailwind neutral scale, which maps to these
tokens:

| Token         | Value     | Role                                          |
| ------------- | --------- | --------------------------------------------- |
| `neutral-50`  | `#fafafa` | Page paper, tinted surfaces                   |
| `neutral-100` | `#f5f5f5` | Cards on paper, subtle fills                  |
| `neutral-200` | `#e5e5e5` | Hairlines, dividers, borders                  |
| `neutral-300` | `#d4d4d4` | Disabled borders, placeholder dots            |
| `neutral-400` | `#a3a3a3` | Disabled text (dark contexts only)            |
| `neutral-500` | `#737373` | Small print, metadata, icons (4.6:1 on paper) |
| `neutral-600` | `#525252` | Body text on light (7.5:1, AAA)               |
| `neutral-700` | `#404040` | Strong body, row values                       |
| `neutral-800` | `#262626` | Button hover ink                              |
| `neutral-900` | `#171717` | Ink: headings, primary buttons, nav pill      |

Rules:

- **Body text on light paper is `neutral-600` or darker.** `neutral-500` is the
  floor for small print (footnotes, metadata, captions) — it passes AA at
  4.6:1. `neutral-400` never appears as text on a light background; it exists
  only on dark surfaces (nav pill, dark CTA panel) where it reads ~8:1.
- **Hairlines are `neutral-200`** (1px, full-width, `border-t`/`divide`).
  Never use a shadow where a hairline will do.
- **Dark surfaces** are `neutral-900` (never black); text on them is
  `neutral-50` (never white), body copy `neutral-400`, labels `neutral-300`.

### 3.2 The brand accent (the one color)

Low-saturation teal, the only hue allowed for emphasis in the marketing and
interface chrome:

| Token                  | Value                   | Used for                                                                                     |
| ---------------------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| `--color-brand`        | `oklch(0.44 0.11 185)`  | Emphasis phrases, section labels, links, active feature borders, focus rings, selection tint |
| `--color-brand-deep`   | `oklch(0.35 0.08 185)`  | Primary actions inside mockups, active nav item, play button                                 |
| `--color-brand-strong` | `oklch(0.32 0.07 185)`  | Sidebar active item text-on-teal                                                             |
| `--color-brand-tint`   | `oklch(0.93 0.045 185)` | Chip backgrounds                                                                             |
| `--color-brand-ink`    | `oklch(0.38 0.09 185)`  | Text on the brand tint                                                                       |

Usage rules:

- **Do** use the accent for: the emphasized word in a headline (`Creators
deliver.`), uppercase section labels, the active item's left border + title,
  links, focus rings, the selection tint, and in-mockup primary actions.
- **Don't** use it for: primary page buttons (those are ink), borders on
  non-active elements, backgrounds at scale, or anything you could also do in
  `neutral-*`. If you can't count the accent usages on one hand per screen,
  you're overspending.
- The accent reaches ~4.6–5.4:1 on paper at `oklch(0.44 …)` — acceptable for
  large/label text. The deep variant sits at ~6:1 with white text on it.

### 3.3 Status colors (semantic, separate from the accent)

Status is a closed vocabulary of tinted chips. These are _not_ the brand
accent and never interchangeable with it:

| State                           | Chip bg                 | Chip text              | Meaning                      |
| ------------------------------- | ----------------------- | ---------------------- | ---------------------------- |
| Good / active / verified / paid | `oklch(0.93 0.045 185)` | `oklch(0.38 0.09 185)` | Teal tint — positive         |
| Waiting / pending / in progress | `oklch(0.95 0.045 85)`  | `oklch(0.5 0.09 70)`   | Amber tint — awaiting action |
| Bad / rejected / failed         | `--destructive` surface | `--destructive` ink    | Red tint — needs attention   |

These map to the existing `--status-verified` / `--status-pending` tokens.
Neutral chips (`neutral-100` bg, `neutral-600` text) exist for states that are
neither good nor bad (e.g. "1 of 1 video").

---

## 4. Typography

### 4.1 Fonts

| Face           | Variable            | Role                                                            |
| -------------- | ------------------- | --------------------------------------------------------------- |
| **DM Sans**    | `--font-dm-sans`    | Everything inside the UI: body, buttons, labels, tables, forms  |
| **Noto Serif** | `--font-noto-serif` | Display face: page-level h1s, marketing headlines, big numerals |
| **DM Mono**    | `--font-dm-mono`    | Code, numbers that need monospacing                             |

The app's legacy `--font-heading` (Outfit) was retired in KAN-84 — page
headings use `--font-display` (Noto Serif), and everything else uses DM Sans.

### 4.2 Roles — serif vs sans

- **Serif (Noto Serif)** is for _headlines only_: the marketing hero, section
  h2s on the landing page, and **page-level h1s in the app**. Never inside
  cards, tables, buttons, or labels.
- **Sans (DM Sans)** is everything else: labels, body, values, buttons, form
  fields, captions.
- The serif is used at medium weight (`font-medium`), tight tracking, generous
  leading. Italic serif emphasis is a marketing device only — in the app,
  emphasis is color (the brand accent) not italic.

### 4.3 Scale

| Level             | Face  | Size                                                                         | Notes                                   |
| ----------------- | ----- | ---------------------------------------------------------------------------- | --------------------------------------- |
| Page h1           | Serif | `text-3xl … sm:text-4xl` (app), `text-5xl … lg:text-[72px]` (marketing hero) | `leading-[1.08–1.12]`, `tracking-tight` |
| Section h2        | Serif | `text-3xl … lg:text-5xl`                                                     | Same rhythm as h1, smaller              |
| Card / row title  | Sans  | `text-sm`–`text-base`, semibold                                              | `neutral-900`                           |
| Body              | Sans  | `text-sm`–`text-lg`                                                          | `neutral-600`, `leading-relaxed`        |
| Label (uppercase) | Sans  | `text-[13px]`, `uppercase`, `tracking-[0.14em]`, semibold                    | Brand accent color                      |
| Small print       | Sans  | `text-xs`–`text-[11px]`                                                      | `neutral-500` floor                     |
| Caption / meta    | Sans  | `text-[10px]–[11px]`                                                         | Mockups, table cells                    |

---

## 5. Spacing

### 5.1 The 4px grid

All spacing is a multiple of 4: `1=4, 2=8, 3=12, 4=16, 6=24, 8=32, 12=48,
16=64, 20=80, 24=96, 28=112, 32=128`. Prefer the Tailwind scale names
(`gap-3`, `py-6`) over arbitrary values.

### 5.2 Density — the two modes

| Mode                 | Where                                        | Rhythm                                                                 |
| -------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| **Editorial (airy)** | Page openers, empty states, landing sections | `py-24 sm:py-32` sections, `gap-16` grids, `mt-16` after a page header |
| **Working (dense)**  | Tables, ledgers, worklists, forms, rows      | `py-2`/`py-3` rows, `gap-3` grids, `p-4` cards                         |

A page is editorial at the top (the `PageHeader`) and working below it. The
dense exceptions are deliberate: data must scan, so it stays tight. Everything
still uses the same 4px vocabulary.

---

## 6. Radii

Concentric nesting: `inner_radius = outer_radius − padding`.

| Token                        | Value     | Used for                              |
| ---------------------------- | --------- | ------------------------------------- |
| `rounded-full`               | pill      | Buttons, chips, nav pill, address bar |
| `rounded-[32px]`             | 32px      | The dark CTA panel                    |
| `rounded-[24px]`             | 24px      | App mockup frames, hero panel         |
| `rounded-2xl` / `rounded-xl` | 16 / 12px | Cards                                 |
| `rounded-lg`                 | 8px       | Buttons' inner blocks, small cards    |
| `rounded-md` / `rounded`     | 6 / 4px   | Checkboxes, tiny blocks               |
| `rounded-[4px]`              | 4px       | Logo mark corners, checkbox outline   |

Examples in the wild: a `rounded-[24px]` frame with `p-3` contains
`rounded-xl` (12px) cards; a 12px card with `p-2` contains `rounded-[4px]`
blocks. When in doubt, subtract the padding from the outer radius and use that.

---

## 7. Elevation & shadows

- **Structure comes from hairlines** (`neutral-200` borders), not shadows.
  Cards, rows, and sections separate with 1px rules.
- **Shadows exist in light mode only** (no dark mode is shipped) and only where
  a surface must float: the nav pill
  (`0 12px 32px rgba(23,23,23,0.18)`) and app frames
  (`0 24px 60px -28px rgba(23,23,23,0.25)`).
- Never stack shadows; a floating surface has exactly one.

---

## 8. Motion

- **Easing:** `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out, decelerating) for
  entrances and transitions; durations 300–700ms depending on distance.
- **Reveals:** opacity + a small translate (`translate-y-6 → 0`), staggered
  80–120ms between siblings, driven by the `Reveal` component. Never clip or
  blur to hide content; hidden content is `opacity-0` at most, and every reveal
  has a no-JS / reduced-motion path to visible.
- **Micro-interactions:**
  - Buttons: hover `-translate-y-0.5` (+ `bg-neutral-100` on light ink
    buttons), `active:scale-[0.98]`.
  - Primary buttons carry the shine sweep (`.btn-shine`, gradient translate on
    hover).
  - Nav links draw an underline (`.nav-underline`, `scaleX(0 → 1)`).
  - FAQ disclosures rotate their chevron `180deg` on open.
  - Cards lift on hover: `hover:-translate-y-0.5` + border shift.
- **Reduced motion:** every animation is inside
  `@media (prefers-reduced-motion: no-preference)`. Users who opt out see the
  static layout immediately (CSS handles reveals via
  `@media (prefers-reduced-motion: reduce)` and `@media (scripting: none)`).

---

## 9. Iconography

- **Family:** Lucide only. **Weight:** `strokeWidth={1.5}` everywhere.
  **Sizes:** `h-3/h-3.5/h-4` inline, `h-5/h-6` in nav and empty states.
- No filled/duotone/outline mixing. A filled icon is permitted _only_ to show
  the active nav item, and only as a variant of the same glyph.
- Icons are `aria-hidden` when decorative; interactive icons get labels.

---

## 10. Components

### 10.1 Nav — the pill (landing) and the header (app)

- **Landing:** a floating dark `neutral-900/95` capsule, `rounded-full`, the
  two-squares mark + wordmark on the left, anchor links centered, white
  "Get started" pill on the right. One soft shadow. Links brighten
  `neutral-400 → neutral-50` on hover with the underline draw.
- **App:** a sticky `bg-background` bar with a 1px bottom hairline, `h-14`,
  wordmark left, role nav center, user menu right. Same type scale; the active
  nav item carries the brand accent (text or a small underline), never a filled
  background at scale.

### 10.2 Buttons

| Variant           | Recipe                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Primary           | `bg-neutral-900 text-neutral-50`, pill, `btn-shine`, hover `-translate-y-0.5 bg-neutral-800`, `active:scale-0.98` |
| Ghost/outline     | hairline `border-neutral-300`, `text-neutral-700`, hover border darkens + text to `neutral-900`                   |
| On dark           | `bg-neutral-50 text-neutral-900`, hover `bg-neutral-100` (never `bg-white`)                                       |
| In-mockup primary | `bg-brand-deep` (teal), white text — _only inside product mockups_                                                |

Every button has a `focus-visible` ring (`outline-2 outline-offset-2`, neutral
or brand).

### 10.3 Chips / status

A single shared `Chip` component: `rounded-full px-2 py-1 text-[11px]
font-medium`, tone variants = teal (good), amber (waiting), red (bad), gray
(neutral), dark (ink-on-light). Text on tint sits at ~5:1. The landing page
mockups and the app use the _same_ component after KAN-86.

### 10.4 Cards

`bg-white` (on paper) or `bg-neutral-100` (on white sections), 1px
`neutral-200` hairline, `rounded-2xl`/`rounded-xl`, optional soft ambient
shadow only when floating. Inside a card, divide rows with `divide-neutral-200`
hairlines. Card headers: sans `text-xs`/`text-sm` semibold `neutral-900` with
the value or chip right-aligned.

### 10.5 Page header (app)

Every app page opens with the same rhythm (the `PageHeader` component from
KAN-86):

```
LABEL (uppercase, 13px, tracking-[0.14em], brand accent)
Page title (serif, text-3xl–4xl, neutral-900)
One-line description (sans, neutral-600, max-w ~52ch)
[hairline under — neutral-200]
```

The hero/landing sections use the same structure at marketing scale.

### 10.6 Mockup frames (CSS-built product screenshots)

`rounded-[24px]`, 1px hairline, soft ambient shadow, window chrome bar
(`neutral-50`, three desaturated traffic-light dots — red/amber/green, address
pill with the teal dot), then a `neutral-50` canvas holding the "app" at
screenshot density. These are the landing page's product showcase and stay
monochrome + accent exactly like the app is meant to look.

---

## 11. Layout patterns

- **Hairline section rules:** sections separate with full-width
  `border-t border-neutral-200`; within a section, vertical rules divide the
  band (e.g. the four value props).
- **Section rhythm (landing):** label → serif h2 (+ emphasized phrase in the
  accent) on the left, right-aligned description; content below at `mt-16`.
- **The value band:** four equal columns divided by hairlines, icon + title +
  short line.
- **Footer:** multi-column hairline footer, links `neutral-500` on paper,
  copyright in small print.
- **Content width:** landing `max-w-6xl`/`max-w-5xl`; app `max-w-7xl` with the
  PageHeader centered at `max-w-2xl`–`3xl` where the page is a single column.

---

## 12. Accessibility

- **Contrast:** body ≥ 4.5:1 (target 7:1), small print ≥ 4.5:1, UI borders and
  icons ≥ 3:1, accent labels ≥ 4.5:1. Checked per change, not at the end.
- **Focus:** every interactive element has a visible
  `focus-visible` ring. Never remove default focus styles.
- **Motion:** all animation gated behind `prefers-reduced-motion`; content is
  never permanently hidden by a reveal (CSS fallbacks for `scripting: none`
  and reduced motion).
- **Structure:** headings are real `h1`/`h2` (one `h1` per page), the FAQ uses
  native `<details>`, links are `<a>` even when they look like buttons.
- **Halation:** no pure black/white text-on-background pairs anywhere.

---

## 13. Do / Don't — the checklist

**Do**

- Count the accent usages per screen; if more than a handful, cut.
- Use hairline `neutral-200` dividers for structure.
- Use serif for page headlines, sans for everything else.
- Keep tables, ledgers, and worklists dense.
- Give every interactive element a hover state, an active scale, and a focus
  ring.
- Gate every animation behind reduced-motion.
- Reach for `neutral-600` body, `neutral-500` small print, `neutral-200`
  hairlines.

**Don't**

- Introduce a second accent, a saturated color, or a pure black/white.
- Use `bg-white`/`text-white` where `neutral-50` works (hover states included).
- Put `neutral-400` text on a light background.
- Stack shadows or use shadows in place of borders.
- Use italics in the app to emphasize (use the accent instead).
- Ship an icon that isn't Lucide at `strokeWidth={1.5}`.
- Use a spacing value outside the 4px grid (the play-triangle nudge is the one
  exception).
- Let a new page bypass the PageHeader, the Chip, or the shared tokens — if the
  tokens don't cover it, that's a ticket, not a one-off class.

---

## 14. Token map (globals.css → landing page → app)

| Design concept | globals.css token             | Landing page                     | App (after rollout)                   |
| -------------- | ----------------------------- | -------------------------------- | ------------------------------------- |
| Ink            | `--primary` (`neutral-900`)   | Buttons, headlines, nav pill     | Buttons, page titles, header          |
| Paper          | `--background` (`neutral-50`) | Page bg                          | Page bg                               |
| Hairline       | `--border` (`neutral-200`)    | Dividers, frames                 | Cards, tables, dividers               |
| Brand accent   | `--color-brand`               | Emphasis, labels, active borders | Links, focus, active nav, page labels |
| Serif display  | `--font-display`              | Headlines                        | Page h1s                              |
| Sans body      | `--font-sans`                 | Body                             | Everything else                       |
| Status good    | `--status-verified`           | Mockup chips                     | Real status chips                     |
| Status waiting | `--status-pending`            | Mockup chips                     | Real status chips                     |
| Radius         | `--radius` scale              | 4/8/12/16/24/32/pill             | Same scale                            |

The landing page and the app share the brand tokens from KAN-83 — no hardcoded
accent utilities remain (KAN-91).

---

## 15. Status of the rollout

| Ticket    | Phase                                                  | Status |
| --------- | ------------------------------------------------------ | ------ |
| KAN-83    | Tokens: brand accent, radius, hairline; drop dark mode | Done   |
| KAN-84    | Typography + spacing system                            | Done   |
| KAN-85    | Restyle shadcn primitives via tokens                   | Done   |
| KAN-86    | Shared components: PageHeader, Chip, empty/error       | Done   |
| KAN-87–90 | Per-area passes: auth, admin, brand, creator           | Done   |
| KAN-91    | Decommission + regression sweep                        | Done   |

The landing page (`app/page.tsx`) remains the reference implementation: when
in doubt, open it and copy the pattern.
