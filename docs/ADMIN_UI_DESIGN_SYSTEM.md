---
name: bantayog-admin-ui
description: >
  Design system and UI/UX guide for the BANTAYOG LGU Admin Portal.
  Use this skill whenever building, modifying, or adding new tabs, sections,
  pages, modals, or components inside the /admin/* surface. Covers the exact
  color tokens, typography, spacing, component anatomy, layout grid, animation
  classes, and page composition rules extracted from the live codebase so every
  new screen matches the existing look without manual re-discovery.
---

# BANTAYOG Admin Portal Design System

This skill defines the visual language for the **LGU Admin Portal** (`/admin/*`).
Every new page, tab, section, modal, or component inside the admin surface MUST
follow these rules. Do not invent new tokens, colors, or layout patterns unless
explicitly asked.

---

## 1. Color Palette

All colors are defined as CSS custom properties in `apps/web/app/globals.css`
and as Tailwind v4 theme tokens under `@theme {}`. Use the Tailwind class names,
not raw hex values.

### 1.1 Brand Colors (Tailwind classes)

| Token (Tailwind class) | Hex | Usage |
|---|---|---|
| `brand-darkTeal` | `#004B49` | Primary text, headings, icons, modal headers |
| `brand-activeTeal` | `#017075` | Active tab fills, primary buttons, links |
| `brand-coral` | `#f48d79` | CTA buttons, tier-1 badges, accent highlights |
| `brand-coralHover` | `#ffc0b4` | Coral hover state |
| `brand-peachBg` | `#f6e5e2` | Light background tints inside cards |
| `brand-peachLight` | `#ffe1d4` | InfoBadge backgrounds |
| `brand-sageBorder` | `#bdd5d6` | Borders, dividers, input outlines |
| `brand-sageBg` | `#c8dadb` | Sage-tinted backgrounds, icon containers |
| `brand-mutedGray` | `#b4b4b4` | Disabled/muted elements |
| `brand-cardCream` | `#FDF5F2` | Warm card backgrounds |

### 1.2 Page-Level Tokens

| Token (CSS var) | Tailwind class | Hex | Usage |
|---|---|---|---|
| `--color-canvas` | `bg-canvas` custom | `#FAC5B9` | Full-page background (peach canvas) |
| `--color-bg-navbar` | `bg-bg-navbar` | `#FDEFEA` | Header navbar, footer background |
| `--color-bg-card` | `bg-bg-card` | `#FFF9F8` | Card/panel backgrounds |
| `--color-border-input` | `border-border-input` | `#F3B3A3` | Form input borders |

### 1.3 Semantic Colors (CSS vars)

| Purpose | Variable | Hex |
|---|---|---|
| Success | `--color-success` | `#2ecc71` |
| Success bg | `--color-success-bg` | `#e8fdf0` |
| Warning | `--color-warning` | `#f39c12` |
| Warning bg | `--color-warning-bg` | `#fef9e7` |
| Error | `--color-error` | `#e74c3c` |
| Error bg | `--color-error-bg` | `#fdecea` |

### 1.4 Button-Specific Tokens

| Token | Hex | Usage |
|---|---|---|
| `button-coral` | `#E07A65` | Primary action buttons in modals |
| `button-cancel-bg` | `#F5F5F5` | Cancel/secondary button backgrounds |

---

## 2. Typography

### 2.1 Font Stack

- **Display/Titles:** `"Intro Rust"` (self-hosted, `--font-title`). Used sparingly for logo wordmarks only.
- **Body/UI:** `"Poppins"` (Google Fonts, `--font-body`). Used for everything else: headings, labels, body text, buttons.
- **Fallback:** `"Inter", "Segoe UI", system-ui, -apple-system, sans-serif`

### 2.2 Type Scale (Admin Pages)

| Element | Classes | Example |
|---|---|---|
| Page heading | `text-xl md:text-2xl font-bold text-brand-darkTeal` | "Beneficiary Registry" |
| Section heading | `text-lg font-bold text-brand-darkTeal` | "Registration Form" |
| Card title | `text-sm font-bold text-brand-darkTeal leading-tight` | "LGU Registry and Intervention Portal" |
| Subtitle/caption | `text-xs text-brand-darkTeal/55 mt-0.5 leading-tight` | District name |
| Micro label | `text-[10px] font-bold uppercase tracking-widest text-brand-darkTeal/40` | "ONE-TIME ALLOCATION" |
| University subtitle | `text-[9px] font-semibold uppercase tracking-[0.08em] text-brand-darkTeal/50` | Header subtext |
| Body text | `text-sm text-brand-darkTeal/70 leading-relaxed` | Modal body paragraphs |
| Badge text | `text-[10px] or text-[11px] font-bold or font-semibold` | Status pills |
| Large number | `text-3xl or text-4xl font-black text-brand-darkTeal` | Credit balances, metrics |
| Footer | `text-[11px] font-semibold uppercase tracking-wider text-brand-darkTeal/40` | Copyright line |

### 2.3 Text Color Opacity Pattern

Use fractional opacity on `text-brand-darkTeal` for hierarchy:
- **Primary:** `text-brand-darkTeal` (100%)
- **Secondary:** `text-brand-darkTeal/70`
- **Muted:** `text-brand-darkTeal/55` or `/50`
- **Ghost:** `text-brand-darkTeal/40`

---

## 3. Layout

### 3.1 Page Structure

Every admin page follows this exact structure:

```
AdminLayout (min-h-screen, bg: --color-canvas peach)
  AdminHeaderNav (sticky top, bg: bg-navbar, h-72px)
  main (flex-1, max-w-[1280px] mx-auto px-6 py-6)
    StatusBar (first child, always present)
    {page content}
  footer (bg: bg-navbar, border-t, copyright)
```

### 3.2 Content Container

- Max width: `max-w-[1280px]`
- Horizontal padding: `px-6` (desktop), `px-4` (mobile via `.page-container`)
- Vertical padding: `py-6`

### 3.3 Grid Patterns

| Pattern | Classes | Used In |
|---|---|---|
| Side-by-side forms | `grid grid-cols-1 lg:grid-cols-2 gap-5` | Registration page |
| Metric cards row | `grid grid-cols-2 md:grid-cols-4 gap-4` | Beneficiaries dashboard |
| Content stack | `space-y-5` | All pages (StatusBar + content) |
| Full-width table | Single column, full width of container | Beneficiary/Merchant lists |

### 3.4 Spacing Scale

- Section gaps: `gap-5` or `space-y-5` (20px)
- Card internal padding: `px-6 py-4` (compact), `p-6 md:p-8` (standard Card)
- Modal padding: `px-8 pt-7 pb-6` (header), `px-8 pt-6 pb-7` (body)
- Form field spacing: `space-y-4` between fields
- Button gap: `gap-3` between action buttons

---

## 4. Components

### 4.1 Existing Component Library

All reusable components live in two locations. Always check these before
building inline:

**Shared UI Primitives** (`components/ui/index.tsx`):
- `Button` (variants: primary, secondary, coral, ghost, outline; sizes: sm, md, lg)
- `Card` (standard + glass variant, optional hoverable)
- `Input` (with label, error, icon support)
- `Tabs` (pill-style tab switcher, teal active fill)
- `Badge` (variants: success, warning, info, neutral, coral)
- `Modal` (overlay dialog with backdrop blur)
- `SectionHeading` (title + subtitle)
- `InfoBadge` (icon + title + description block)

**Admin-Specific Components** (`components/admin/`):
- `AdminHeaderNav` (top navigation bar)
- `StatusBar` (portal title + database status pill)
- `BeneficiaryRegistrationForm` (left-side form card)
- `MerchantRegistrationForm` (right-side form card)
- `AddCreditsModal` (dark teal header + white body)
- `AdminPasswordModal` (password re-verification)
- `QrPassModal` (Nutri-Pass print preview)
- `TransactionsModal` (transaction detail overlay)
- `MerchantVerifiedToast` (success notification)
- `ORModal` (official receipt view)

### 4.2 Card Anatomy

Standard admin card:

```
bg-bg-card/80 backdrop-blur-sm rounded-2xl
border border-border-input/30
px-6 py-4 (compact) or p-6 md:p-8 (full)
shadow-sm
```

Or use the `.card` CSS class (from globals.css):
```
background: var(--color-surface) (#ffffff)
border-radius: var(--radius-2xl) (1.5rem)
box-shadow: var(--shadow-card)
border: 1px solid var(--color-border-light)
transition: box-shadow 0.3s, transform 0.3s
hover: var(--shadow-card-hover)
```

### 4.3 Modal Anatomy (Two-Part)

For important actions, use the two-part modal pattern (dark header + white body):

```
Outer: fixed inset-0 z-50, backdrop bg-black/30 backdrop-blur-sm
Container: w-full max-w-[420px] animate-scale-in

Header (dark teal):
  rounded-t-[1.75rem] bg-brand-darkTeal px-8 pt-7 pb-6
  Title: text-white font-black text-3xl
  Subtitle: text-white/50 text-[10px] font-bold uppercase tracking-widest

Body (white):
  rounded-b-[1.75rem] bg-white px-8 pt-6 pb-7 space-y-5
  Content area
  Primary button: w-full rounded-full bg-button-coral text-white font-bold text-sm py-3.5
  Cancel button: w-full rounded-full bg-button-cancel-bg text-button-coral font-bold text-sm py-3.5
```

### 4.4 Simple Modal (Confirmation Dialogs)

For simple confirmations (sign out, delete, etc.):

```
Outer: fixed inset-0 z-50, backdrop rgba(3,62,57,0.25)
Container: bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6 animate-slide-up

Icon+Title row: flex items-center gap-3 mb-2
  Icon container: w-10 h-10 rounded-xl bg-brand-coral/10 text-brand-coral
  Title: text-lg font-bold text-brand-darkTeal

Body: text-sm text-brand-darkTeal/70 leading-relaxed mb-6 ml-[52px]

Actions: flex items-center gap-3 justify-end
  Cancel: px-5 py-2.5 rounded-full text-xs font-bold text-brand-darkTeal/70
  Confirm: px-5 py-2.5 rounded-full text-xs font-bold text-white bg-brand-coral
```

### 4.5 StatusBar (Required on Every Page)

Must be the first child inside every admin page's content area:

```tsx
<StatusBar />
```

Renders: building icon + "LGU Registry and Intervention Portal" + district
subtext + "Database Online" pill.

### 4.6 Button Patterns

| Context | Style |
|---|---|
| Primary CTA | `bg-brand-coral text-white rounded-full font-bold text-sm py-3.5` |
| Secondary/Cancel | `bg-button-cancel-bg text-button-coral rounded-full font-bold` |
| Nav link (active) | `bg-route-active-bg text-route-active-text rounded-full text-[11px] font-bold` |
| Nav link (inactive) | `text-brand-darkTeal/70 hover:text-brand-darkTeal rounded-full text-[11px] font-bold` |
| Icon button | `w-9 h-9 rounded-full text-brand-darkTeal/60 hover:bg-brand-sageBg/40` |
| Table action | `text-brand-activeTeal text-xs font-semibold hover:underline` |

### 4.7 Badge / Status Pill Patterns

| Status | Style |
|---|---|
| ELIGIBLE / APPROVED | `bg-green-100 text-green-800 border border-green-300` |
| PENDING | `bg-yellow-50 text-yellow-700 border border-yellow-300` |
| SUSPENDED / INELIGIBLE | `bg-red-50 text-red-700 border border-red-200` |
| Tier 1 Critical | `bg-brand-coral/10 border-brand-coral/40 text-brand-coral` |
| Tier 2 Standard | `bg-green-50 border-green-300 text-green-700` |
| Database Online | `bg-badge-status-bg border-brand-sageBorder/50 text-brand-darkTeal` |
| Generic info | `bg-brand-sageBg/30 text-brand-activeTeal border border-brand-sageBorder` |

Shape: always `rounded-full`, `text-[10px] or text-xs`, `font-bold or font-semibold`,
`px-3 py-1.5` or `px-5 py-2.5`.

### 4.8 Input Fields

Use the `.input-field` CSS class or the `<Input>` component from `components/ui`:

```
width: 100%
padding: 0.75rem 1rem
border: 1.5px solid var(--color-brand-sageBorder) (#bdd5d6)
border-radius: var(--radius-lg) (1rem)
font-size: 0.9375rem (15px)
font-family: Poppins

Focus: border-color var(--color-primary-400), box-shadow 0 0 0 3px rgba(1,112,117,0.1)
Error: border-color var(--color-error), box-shadow 0 0 0 3px rgba(231,76,60,0.1)
```

### 4.9 Form Card Pattern

Registration-style form cards:

```
bg-bg-card rounded-3xl border border-border-input/30
p-6 md:p-8 space-y-4

Section header: flex items-center gap-3
  Icon: w-10 h-10 rounded-xl bg-brand-sageBg text-brand-darkTeal
  Title: font-bold text-brand-darkTeal text-sm
  Subtitle: text-brand-darkTeal/55 text-xs

Fields: space-y-4
  Label: text-xs font-semibold text-brand-darkTeal/70 uppercase tracking-wider
  Input: .input-field (see 4.8)

Submit button: w-full rounded-full bg-brand-coral text-white font-bold py-3.5
```

### 4.10 Alert / Warning Banner

```
bg-alert-bg border border-alert-border rounded-xl px-4 py-3
text-xs text-alert-text font-semibold
```

Or for inline errors:
```
bg-red-50 border border-red-200 rounded-xl px-4 py-3
text-xs text-red-700 font-semibold
```

---

## 5. Animations

Use the pre-defined animation classes from `globals.css`:

| Class | Effect | Duration | Usage |
|---|---|---|---|
| `animate-fade-in` | Fade in + slide up 8px | 0.4s ease-out | Page entry, section reveal |
| `animate-slide-up` | Fade in + slide up 24px | 0.5s ease-out | Modal body entry |
| `animate-scale-in` | Fade in + scale from 0.95 | 0.3s ease-out | Modal card entry |
| `animate-slide-in-right` | Fade in + slide from right 16px | 0.3s ease-out | Toast entry |
| `animate-pulse-soft` | Soft opacity pulse | 2s infinite | Loading states |
| `stagger-children` | Sequential fadeIn on children | 0.05s increments | Lists, metric cards |

### 5.1 Transition Defaults

All interactive elements: `transition-all duration-200`

---

## 6. Icons

- **Do NOT use an icon library.** All icons are inline SVGs.
- Standard icon size: `width="18" height="18"` or `width="20" height="20"`
- Stroke style: `stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"`
- Icon containers: `w-10 h-10 rounded-xl bg-brand-sageBg flex items-center justify-center text-brand-darkTeal`
- For coral-tinted icons: `bg-brand-coral/10 text-brand-coral`

---

## 7. Data Tables

Tables in the admin portal use TanStack Table 8 with this visual pattern:

```
Container: bg-bg-card rounded-2xl border border-border-input/30 overflow-hidden

Header row:
  bg-brand-sageBg/20
  text-[10px] font-bold uppercase tracking-wider text-brand-darkTeal/50
  px-4 py-3

Body rows:
  border-b border-border-input/20
  px-4 py-3.5
  hover:bg-brand-peachBg/20 transition-colors

Cell text: text-sm text-brand-darkTeal (primary), text-brand-darkTeal/60 (secondary)

Pagination: flex items-center justify-between px-4 py-3
  Page indicator: text-xs text-brand-darkTeal/50
  Buttons: rounded-lg border border-brand-sageBorder px-3 py-1.5 text-xs
```

---

## 8. Shadows

| Token | Value | Usage |
|---|---|---|
| `--shadow-card` | `0 4px 24px rgba(11,110,110,0.08), 0 1px 4px rgba(0,0,0,0.04)` | Cards at rest |
| `--shadow-card-hover` | `0 8px 40px rgba(11,110,110,0.12), 0 2px 8px rgba(0,0,0,0.06)` | Card hover state |
| `shadow-sm` | Tailwind default | StatusBar, subtle elevation |
| `shadow-xl` | Tailwind default | Confirmation modals |

---

## 9. Border Radii

| Token | Value | Usage |
|---|---|---|
| `rounded-full` | 9999px | Buttons, badges, nav pills |
| `rounded-3xl` | 2rem | Form cards, large containers |
| `rounded-2xl` | 1.5rem | Standard cards, StatusBar, tables |
| `rounded-xl` | 1.25rem | Icon containers, alert boxes, input focus |
| `rounded-lg` | 1rem | Input fields |
| `rounded-t-[1.75rem]` / `rounded-b-[1.75rem]` | 1.75rem | Two-part modal header/body |

---

## 10. Page Composition Checklist

When building any new admin page or tab:

1. **File location:** `apps/web/app/admin/{page-name}/page.tsx`
2. **Directive:** Add `"use client";` at the top.
3. **Wrap content** in `<div className="space-y-5 animate-fade-in">`.
4. **StatusBar first:** Always render `<StatusBar />` as the first child.
5. **Use existing components:** Check `components/ui/` and `components/admin/` before building new ones.
6. **Color tokens:** Use only tokens from Section 1. Never hardcode hex.
7. **Typography:** Follow Section 2 scale. Default body font is Poppins.
8. **Icons:** Inline SVGs only, matching Section 6 stroke style.
9. **Animations:** Use pre-defined classes from Section 5.
10. **Modals:** Use two-part (dark header + white body) for important actions, simple dialog for confirmations.
11. **Forms:** Follow the form card pattern from Section 4.9.
12. **Tables:** Follow Section 7 pattern with TanStack Table.
13. **Accessibility:** All interactive elements need `cursor-pointer`, all modals need `role="dialog" aria-modal="true"`, all icon buttons need `aria-label`.

---

## 11. File Reference Map

| Concern | File |
|---|---|
| Global tokens + animations | `apps/web/app/globals.css` |
| Admin layout + auth guard | `apps/web/app/admin/layout.tsx` |
| Header navigation bar | `apps/web/components/admin/header-nav.tsx` |
| StatusBar component | `apps/web/components/admin/status-bar.tsx` |
| UI primitive library | `apps/web/components/ui/index.tsx` |
| Registration page | `apps/web/app/admin/register/page.tsx` |
| Beneficiaries page | `apps/web/app/admin/beneficiaries/page.tsx` |
| Merchants page | `apps/web/app/admin/merchants/page.tsx` |
| Registration form (beneficiary) | `apps/web/components/admin/beneficiary-registration-form.tsx` |
| Registration form (merchant) | `apps/web/components/admin/merchant-registration-form.tsx` |
| Credits modal | `apps/web/components/admin/add-credits-modal.tsx` |
| Password modal | `apps/web/components/admin/admin-password-modal.tsx` |
| QR pass modal | `apps/web/components/admin/qr-pass-modal.tsx` |
| Transactions modal | `apps/web/components/admin/transactions-modal.tsx` |
