---
inclusion: manual
---

# Frontend Conventions (apps/web)

Next.js 16 App Router, React 19, Tailwind 4, no business logic. One deployment serves three
surfaces; `middleware.ts` decides which one by hostname.

## Routing & sandboxing

- Route groups: `(auth)` → `/login` (`(auth)/register/` is an empty placeholder), `(merchant)` →
  `/merchant-login`, `/dashboard`, `/dashboard/transactions`, `/cart`, `/cart/branded`,
  `/cart/non-branded`, `/checkout`, `/checkout/complete`; plus `admin/*` (`/admin`,
  `/admin/login`, `/admin/register`, `/admin/registry`, `/admin/merchants`,
  `/admin/beneficiaries`) and `balance/`.
- `middleware.ts`: merchant hostnames redirect `/` → `/merchant-login`; balance hostnames redirect
  `/` → `/balance`; everything else → `/login`. Off-surface routes return a plain 404 (skipped on
  localhost so all three work in dev). It then runs a Supabase SSR session check and guards
  `/admin/*` on `role === 'admin'`.
- `app/api/[...proxy]/route.ts` is an edge proxy to the API server: it forwards method, body
  (`duplex: 'half'`), and only the `authorization` / `content-type` headers. Add server logic to
  `apps/server`, not here.
- PWA: `app/sw.ts` (Serwist) precaches the build manifest with a `/~offline` document fallback.
  The plugin is disabled outside production builds, and dev runs with `--webpack` because Serwist
  does not support Turbopack.

## Data access

- Always call the API through `authFetch` (`lib/api.ts`). Token precedence: merchant localStorage
  token (with expiry check and silent refresh via `/api/auth/merchant-refresh`) → Supabase browser
  session. Merchant token wins so an admin session cannot leak into merchant-only endpoints.
- `clearMerchantToken()` also clears the cached PIN hash — use it for logout and forced expiry.
- TanStack Query for server state (see `hooks/use-merchant-profile.ts`), Zustand for local state:
  `stores/cart-store.ts` (cart items and totals), `stores/pin-store.ts` (PIN gate), plus
  `stores/auth-context.tsx`. `providers/pin-lock-provider.tsx` wraps the merchant surface.
- Types come from `@bantayog/schema` / `@bantayog/db`. Do not redeclare DTO shapes locally.

## UI conventions

- `components/ui/index.tsx` holds the shared primitives (single barrel file); feature components
  live under `components/admin/` and `components/merchant/`. `packages/ui` is an empty placeholder
  — do not start using it without a reason.
- Tailwind 4 via `@tailwindcss/postcss`; design tokens and globals in `app/globals.css`.
  Theme color `#0b6e6e`, Inter + Poppins from Google Fonts, viewport locked (`userScalable: false`).
- Forms: react-hook-form + `@hookform/resolvers` with the shared Zod schemas.
- Accessibility is a product requirement: `@axe-core/react` is a dependency, targets are
  large-tap, and merchant flows should stay usable one-handed on a low-end Android device.
- QR: `react-qr-code` to render passes, `html-to-image` to export them, `html5-qrcode` /
  `@zxing/browser` for scanning, with camera preview logic in `hooks/use-camera-preview.ts`.

## Client-side domain logic

`lib/domain/` (eligibility, nutrition-policy) and `lib/services/` (qr-token, pin, merchant,
beneficiary) mirror server logic for display and legacy Next-API paths. The server is
authoritative — if a rule changes, update `apps/server/src/domain` first and keep the client copy
in sync or delete it. `lib/env.ts` has dev-friendly fallbacks (random JWT/QR secrets, Hardhat
account #0) that must never be relied on in a deployed environment.

## Testing

`vitest.config.ts` only picks up `lib/**/*.test.ts` and `app/api/**/*.test.ts`, so keep logic
that needs coverage out of components. Path aliases must be added in both `tsconfig.json` and
`vitest.config.ts`.
