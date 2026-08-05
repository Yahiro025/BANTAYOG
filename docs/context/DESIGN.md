# DESIGN — BANTAYOG Design System

Written in ASD-STE100 Simplified Technical English.

This file is the single source of truth for visual decisions. The tokens below come from
`apps/web/app/globals.css`, `apps/web/app/layout.tsx` and `apps/web/components/ui/index.tsx`.
If you change a token, change it in `globals.css` first, then update this file.

**Purpose: stop generic AI output.** Do not invent a colour, a shadow, a radius or a font. Use a
token from this file. If no token fits, ask first.

## 1. Brand identity

"Bantayog" is the Filipino word for monument. The word also carries "bantay", which means to
guard. The brand shows a public, permanent record that guards a child's nutrition.

| Attribute | Decision |
| --- | --- |
| Voice | Plain, warm, direct. Short sentences. Tagalog-friendly copy on merchant and guardian screens |
| Tone | Civic and calm. Not corporate. Not playful |
| Never | No medical claims. No fear appeals. No crypto jargon on guardian or merchant screens |
| Words to prefer | "credits", "pass", "balance", "store" |
| Words to avoid | "wallet" (guardian screens), "token", "gas", "mint", "stablecoin" |
| Logo | `assets/logo.png` |
| Product name in UI | Uppercase "BANTAYOG" |

## 2. Theme

The product uses one light theme. There is no dark mode. Do not add one without a decision.

The canvas is warm peach. The primary action colour is deep teal. Coral is the call-to-action
colour. This gives a soft, non-clinical surface with a strong civic accent.

| Surface | Token | Value |
| --- | --- | --- |
| Page canvas | `--color-canvas` | `#FAC5B9` |
| Canvas, secondary | `--color-canvas-secondary` | `#fbe9e1` |
| Card | `--color-surface` | `#ffffff` |
| Card, muted | `--color-surface-muted` | `#faf5f2` |
| PWA theme colour | `viewport.themeColor` | `#0b6e6e` |

## 3. Colour tokens

Two token sets exist. Both are live. Read section 3.3 before you pick one.

### 3.1 Tailwind theme tokens (`@theme`, usable as utilities)

Tailwind 4 reads these and generates utilities, for example `bg-brand-coral`.

| Token | Value | Use |
| --- | --- | --- |
| `--color-brand-darkTeal` | `#004B49` | Titles, icons on light surfaces |
| `--color-brand-activeTeal` | `#017075` | Active tab, outline button, focus |
| `--color-brand-coral` | `#f48d79` | Primary call to action |
| `--color-brand-coralHover` | `#ffc0b4` | Call-to-action hover |
| `--color-brand-peachBg` | `#f6e5e2` | Section background |
| `--color-brand-peachLight` | `#ffe1d4` | Info block background |
| `--color-brand-sageBorder` | `#bdd5d6` | Input border, card border |
| `--color-brand-sageBg` | `#c8dadb` | Icon chip background |
| `--color-brand-mutedGray` | `#b4b4b4` | Disabled text |
| `--color-brand-canvasPeach` | `#ffc0b4` | Canvas variant |
| `--color-brand-cardCream` | `#FDF5F2` | Card variant |
| `--color-brand-teal` | `#004B49` | Alias of `darkTeal` |
| `--color-bg-canvas` | `#FAC5B9` | Registration canvas |
| `--color-bg-navbar` | `#FDEFEA` | Navigation bar |
| `--color-bg-card` | `#FFF9F8` | Form card |
| `--color-border-input` | `#F3B3A3` | Form input border |
| `--color-badge-status-bg` | `#B9CFCF` | Status badge |
| `--color-alert-bg` | `#FEECE8` | Alert background |
| `--color-alert-border` | `#FCA390` | Alert border |
| `--color-alert-text` | `#FF3B30` | Alert text |
| `--color-route-active-bg` | `#D9C6C1` | Active route chip |
| `--color-route-active-text` | `#E07A65` | Active route text |
| `--color-button-coral` | `#E07A65` | Modal confirm button |
| `--color-button-cancel-bg` | `#F5F5F5` | Modal cancel button |

### 3.2 CSS custom properties (`:root`, usable with `var()`)

Tailwind does **not** generate utilities for these. Read them with
`text-[var(--color-primary-500)]`, as `components/ui/index.tsx` does.

| Group | Tokens |
| --- | --- |
| Primary (teal) | `--color-primary-50 #e0f2f1`, `100 #b2dfdb`, `200 #80cbc4`, `300 #4db6ac`, `400 #26a69a`, `500 #0b6e6e`, `600 #085b5b`, `700 #064949`, `800 #043737`, `900 #022525` |
| Secondary (coral red) | `--color-secondary-50 #fce4ec`, `100 #f8bbd0`, `200 #f48fb1`, `300 #f06292`, `400 #ef5350`, `500 #e85d5d`, `600 #d94a4a`, `700 #c43737`, `800 #ae2626`, `900 #981818` |
| Accent | `--color-accent #f4837c`, `--color-accent-hover #e96b63`, `--color-accent-light #fde8e6` |
| Text | `--color-text-primary #1a1a2e`, `--color-text-secondary #6b5e55`, `--color-text-muted #9e8e82` |
| Border | `--color-border-light #f0e8e3`, `--color-border #e0d6cf` |
| Semantic | `--color-success #2ecc71` on `--color-success-bg #e8fdf0`; `--color-warning #f39c12` on `--color-warning-bg #fef9e7`; `--color-error #e74c3c` on `--color-error-bg #fdecea` |

### 3.3 Rules for colour

1. Use a `brand-*` utility for a new element. Use `var(--color-*)` only to match an existing
   component in the same file.
2. Never write a raw hex value in a component. Two exceptions exist today in `globals.css`: the
   range slider (`#004B49`, `#e0e0e0`) and the badge `success` variant, which uses Tailwind
   `green-100/800/300`. Do not add a third.
3. `--color-brand-darkTeal` and `--color-brand-teal` hold the same value. Prefer `brand-darkTeal`.
4. The two teal families differ: `brand-darkTeal` is `#004B49`, `primary-500` is `#0b6e6e`. This
   is known drift. Do not "fix" it in an unrelated change.

### 3.4 Contrast

Ratios below are calculated with the WCAG 2.1 relative-luminance formula.

| Pair | Ratio | Verdict |
| --- | --- | --- |
| `#1a1a2e` text on `#ffffff` card | 17.06:1 | Pass AAA. This is the default body pair |
| `#004B49` on `#ffffff` | 9.99:1 | Pass AAA |
| `#004B49` on `#FAC5B9` canvas | 6.54:1 | Pass AA |
| `#0b6e6e` (`primary-500`) on `#ffffff` | 6.05:1 | Pass AA |
| `#017075` (`activeTeal`) on `#ffffff` | 5.87:1 | Pass AA |
| `#6b5e55` (`text-secondary`) on `#ffffff` | 6.25:1 | Pass AA |
| `#9e8e82` (`text-muted`) on `#ffffff` | 3.16:1 | **Fail for body text.** Large text only. Never for essential text |
| `#ffffff` on `#f48d79` (coral button) | 2.35:1 | **Fail.** Do not ship white text on coral |
| `#004B49` on `#f48d79` (coral button) | 4.25:1 | Pass for large text (3:1). Fails normal text (4.5:1) by a small amount |

Rules that follow from the table:

1. A coral button needs `brand-darkTeal` text at size `lg` (16 px, weight 600 or more). Treat it as
   large text.
2. For a primary action that needs normal-size text, use the `primary` variant. White on
   `primary-500` gives 6.05:1.
3. Body text needs 4.5:1. Large text (18.66 px bold, or 24 px) needs 3:1. Check any new pair before
   you ship it.

## 4. Typography

`layout.tsx` loads Inter and Poppins from Google Fonts. `globals.css` sets the body font stack to
`"Poppins", "Inter", "Segoe UI", system-ui, sans-serif`.

| Token | Value | Use |
| --- | --- | --- |
| `--font-body` | `"Poppins", sans-serif` | All body text and all UI |
| `--font-title` | `"Intro Rust", system-ui, sans-serif` | Marketing titles only |

**Warning about `--font-title`.** The `@font-face` rules for "Intro Rust" use `src: local(...)`
only. No font file ships with the app. The font renders only on a machine that has it installed.
Do not use `font-title` for text that a user must read. Use Poppins with weight 700 or 800.

| Role | Class | Size |
| --- | --- | --- |
| Page title | `text-xl md:text-2xl font-bold` | 20 px, 24 px on medium screens |
| Modal title | `text-xl font-bold` | 20 px |
| Section subtitle | `text-sm` | 14 px |
| Body | `text-sm` to `text-base` | 14 px to 16 px |
| Label | `text-sm font-semibold` | 14 px |
| Input text | `0.9375rem` (`.input-field`) | 15 px |
| Helper and error | `text-xs font-medium` | 12 px |
| Badge | `0.75rem font-semibold` (`.badge`) | 12 px |

Weights in use: 400, 500, 600, 700, 800. Use 600 for buttons and labels. Use 700 or 800 for
titles. Do not use 300 for UI text.

Line height: use the Tailwind default. `.badge` sets `1.4`. Body copy blocks use
`leading-relaxed`.

## 5. Spacing and layout

The project uses the Tailwind 4 default 0.25 rem scale. Keep to this set of steps:
`1.5 (6 px)`, `2 (8 px)`, `3 (12 px)`, `4 (16 px)`, `6 (24 px)`, `8 (32 px)`.

| Element | Rule |
| --- | --- |
| Card padding | `p-6 md:p-8` (24 px, 32 px). `Card` and `Modal` already apply this |
| Page container | `.page-container`: max width 1280 px, padding 1.5 rem, 1 rem below 640 px |
| Stack gap | `gap-3` or `gap-4` for form fields. `gap-1.5` for a label and its input |
| Icon chip | 40 px square (`w-10 h-10`), radius `rounded-xl` |
| Modal width | `max-w-md` |

### Radii

| CSS token | Value | Tailwind utility | Value |
| --- | --- | --- | --- |
| `--radius-sm` | 0.5 rem | `rounded-lg` | 0.5 rem |
| `--radius-md` | 0.75 rem | `rounded-xl` | 0.75 rem |
| `--radius-lg` | 1 rem | `rounded-2xl` | 1 rem |
| `--radius-xl` | 1.25 rem | — | — |
| `--radius-2xl` | 1.5 rem | `rounded-3xl` | 1.5 rem |
| `--radius-3xl` | 2 rem | — | — |

The names do not line up. `--radius-2xl` is 1.5 rem, but `rounded-2xl` is 1 rem. Cards get their
1.5 rem radius from the `.card` class, not from a utility. Rule: use `.card` for cards, use
`rounded-xl` for buttons and inputs, use `rounded-full` for pills. Do not mix a `--radius-*`
variable with a `rounded-*` utility on the same element.

### Shadows

| Token | Use |
| --- | --- |
| `--shadow-card` | Default card. Applied by `.card` |
| `--shadow-card-hover` | Card hover. Applied by `.card:hover` |
| `--shadow-button` | Coral button rest state |
| `--shadow-button-hover` | Coral button hover |

Buttons in `components/ui/index.tsx` use `shadow-md hover:shadow-lg` instead of the button
tokens. Keep to the component. Do not add a new shadow value.

## 6. Components

`apps/web/components/ui/index.tsx` is the only primitive barrel. `packages/ui` is empty. Do not
start a second component library.

| Component | API |
| --- | --- |
| `Button` | `variant`: `primary`, `secondary`, `coral`, `ghost`, `outline`. `size`: `sm`, `md`, `lg`. `loading`, `icon` |
| `Card` | `hoverable`, `glass`, `onClick`, `className`, `style` |
| `Input` | `label`, `error`, `icon`. Generates an `id` from the label |
| `Tabs` | `tabs`, `activeTab`, `onTabChange`. Has `role="tablist"` and `aria-selected` |
| `Badge` | `variant`: `success`, `warning`, `info`, `neutral`, `coral` |
| `Modal` | `open`, `onClose`, `title`. Has `role="dialog"`, `aria-modal`, a close button and a backdrop |
| `SectionHeading` | `title`, `subtitle` |
| `InfoBadge` | `title`, `description`, `icon` |

Feature components live in `components/admin/` and `components/merchant/`. A feature component
composes primitives. It does not restyle them with a raw hex value.

**Open defect in the `coral` variant.** `Button` renders `bg-brand-coral text-white`. That pair is
2.35:1 and fails WCAG for every text size. The fix is `text-brand-darkTeal` at size `lg`, or the
`primary` variant. Do not copy the current classes into a new component.

### Touch targets

Approximate rendered heights, from padding plus line height:

| Size | Height | Use |
| --- | --- | --- |
| `lg` | about 52 px | **Merchant and guardian flows.** Scan, add to cart, PIN keys, checkout |
| `md` | about 40 px | Admin desktop tables and toolbars |
| `sm` | about 28 px | Inline, non-essential actions only. Never on a merchant primary path |

The minimum target for a hand-held path is 44 px. Only `lg` passes. Use `lg` on the merchant
surface.

## 7. Animation

All keyframes live in `globals.css`. Use the class. Do not write a new keyframe for a one-off.

| Class | Keyframe | Duration and easing |
| --- | --- | --- |
| `.animate-fade-in` | `fadeIn` (opacity, 8 px rise) | 0.4 s ease-out |
| `.animate-slide-up` | `slideUp` (opacity, 24 px rise) | 0.5 s ease-out |
| `.animate-slide-in-right` | `slideInRight` (opacity, 16 px) | 0.3 s ease-out |
| `.animate-scale-in` | `scaleIn` (0.95 to 1) | 0.3 s ease-out |
| `.animate-pulse-soft` | `pulse-soft` (opacity 1 to 0.7) | 2 s ease-in-out, infinite |
| `.stagger-children` | `fadeIn` per child | 0.05 s step, 8 children maximum |
| `.scanner-animation-bar` | `scan` (top 0 % to `calc(100% - 6px)`, opacity fades in at 10 % and out after 90 %) | 2 s cubic-bezier(0.4, 0, 0.2, 1), infinite |

Transitions in components: `transition-all duration-200 ease-out` for buttons, `0.2s` for input
border and shadow, `0.3s` for card shadow and transform. Buttons press with
`active:scale-[0.98]`. Hoverable cards lift with `hover:-translate-y-1`.

Rules:

1. Entry animation only. Do not animate an exit.
2. One animated element per view change. Do not stack `slide-up` inside `fade-in`.
3. Never animate a number that represents money. Show the final value.
4. `shimmer` keyframes exist with no class. Either add `.animate-shimmer` or delete the keyframes.
5. **Reduced motion is missing.** `globals.css` has no `prefers-reduced-motion` block. Add this
   block before you add another animation:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 8. Accessibility

Accessibility is a product requirement, not a preference. The users have low literacy, low-end
Android devices and bright outdoor light.

| Item | State |
| --- | --- |
| Focus ring | Present. `*:focus-visible` gives a 2 px `--color-primary-400` outline with 2 px offset. Never remove it |
| `axe-core` | `@axe-core/react` is a dependency of `apps/web` |
| Semantic roles | `Modal`, `Tabs` and clickable `Card` set roles and ARIA attributes |
| Keyboard | Clickable `Card` handles Enter and Space. Every new interactive element must do the same |
| Labels | Use the `Input` `label` prop. It links the label to the input with `htmlFor` |
| Icon-only button | Needs `aria-label`. The `Modal` close button is the example |
| Zoom | **Fails.** `layout.tsx` sets `maximumScale: 1` and `userScalable: false`. This breaks WCAG 1.4.4. It is deliberate, to stop double-tap zoom on the scanner. Do not copy this pattern to a new page. Removing it is a valid fix |
| Colour alone | Never use colour alone for eligibility. Pair a colour with a word or an icon |
| Language | `<html lang="en">`. Set `lang="fil"` on a Tagalog block |

## 9. Checklist before you ship a screen

1. Every colour is a token from section 3.
2. Text contrast passes 4.5:1, or 3:1 for large text.
3. Every primary action on a merchant or guardian screen is at least 44 px tall.
4. Every input has a visible label.
5. Keyboard focus is visible and follows the reading order.
6. One entry animation. No exit animation. No animated money.
7. No new shadow, radius, font or keyframe.
8. Money reads as PHP with 2 decimals.
9. The screen still reads at 320 px width.
