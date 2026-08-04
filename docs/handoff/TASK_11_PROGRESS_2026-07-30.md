# Task 11 progress handoff

Date: 2026-07-30

This file records the Task 11 state at the end of this work session.

## Completed and verified

- Task 1 Android smoke gate is complete.
- `apps/mobile/scripts/smoke-android.sh` checks the synced build marker. It rejects an empty, non-HTTPS, local, emulator, or RFC1918 API base. It prints the accepted API base.
- The script checks a debug APK WebView through DevTools. It requires the exact start URL `https://localhost/merchant-login`. It saves DevTools JSON files in `apps/mobile/.artifacts/`.
- The script uses merchant-process logcat only. It uses different online and offline error rules. Expected offline network errors are notes, not failures.
- The good Pixel 7 emulator smoke run exited `0`.
- The broken proof moved `_next/static/chunks`, rebuilt the debug APK, and exited `1`. Capacitor reported that it could not open the missing assets.
- The restore used `build:mobile`, `cap sync android`, `assembleDebug`, and smoke. The restored smoke run exited `0`. The Pixel 7 now has a working debug APK.
- Task 2 is complete. `docs/MOBILE_BUILD.md` contains a verified-only manual device checklist.
- The Task 9 sale `cb0dd606-bbbf-47f6-b198-c3046fb50167` was not created by smoke testing. It is the prior authorized 8.00-credit sale.
- Playwright `1.62.0` and its local Chromium browser are installed.
- The mobile export now writes `.build-meta.json`. It reads only `NEXT_PUBLIC_API_BASE_URL` from `.env.local` when the process environment has no value. A process value wins. The same resolved value goes to Next and the marker.
- Focused unit tests for the marker resolver and isolated export directory pass: 11 tests.
- `apps/web/out-e2e/` is ignored. The isolated E2E export was built and contains its marker.
- The local fixture server and PNG/Y4M QR media files exist under `apps/web/e2e/fixtures/`.

## In progress

- Task 3 is in progress.
- `apps/web/scripts/build-mobile.mjs` supports `MOBILE_EXPORT_DIR`. The default remains `out`; the E2E command uses `out-e2e`.
- `apps/web/e2e/fixtures/server.mjs` has fixed local API responses and the required invalid-category Zod response shape.
- The final Task 3 check is not complete. Regenerate `apps/web/out` with `pnpm --filter @bantayog/web build:mobile`, then verify its marker uses HTTPS before any future `cap sync android`.

## Not started

- Task 4 browser tests and `playwright.config.ts` are not created yet.
- The positive login, cart, PIN, checkout, and completion browser flow is not verified.
- The negative browser regression for `items.0.category` is not verified.
- Task 5 full web and server tests, lint, type check, regression coverage review, and final report are not complete.

## Next session order

1. Finish Task 3: test the fixture server on `127.0.0.1:4173`, prove its occupied-port failure, and regenerate and check the release export marker.
2. Implement Task 4 test-first. Do not add a test-only production input. Use the local fixture server only.
3. Run Task 5 only after Task 4 passes.

## Safety constraints

- Do not create a sale or cash-out.
- Do not change `apps/web/.env.local`.
- Do not use ADB reverse or point the phone to a local API.
- Do not install MetaMask.
- Do not commit, push, reset, clean, stash, or delete user work.
- Do not use a production API in E2E.

## Important paths

- Worktree: `/tmp/bantayog-merchant-apk`
- Branch: `feat/merchant-apk`
- Plan: `docs/superpowers/plans/2026-07-30-merchant-smoke-and-e2e.md`
- Smoke artifacts: `apps/mobile/.artifacts/`
- E2E export: `apps/web/out-e2e/`
