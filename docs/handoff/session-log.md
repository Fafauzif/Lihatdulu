# Session log

## 2026-11-20 · Real scan workflow implemented, hardware proof pending

- Branch `feat/real-furniture-scan` from `main`. Plan: [2026-11-20-real-furniture-scan](../superpowers/plans/2026-11-20-real-furniture-scan.md). Tasks 2–12 implemented; Task 1 is partially done (tools unpacked and exact CLI recorded); Task 13 still needs a physical chair and phone.
- Added `server/scan-*.mjs` (job store, metadata, API, tool runner, FFmpeg→COLMAP→Brush→SPZ pipeline, provenance, fake pipeline), `vite.config.js` (dev `/api` proxy), two lazy routes (`/jual/pindai`, `/pindai/:id`), SparkJS viewer, seller entry, and `scripts/verify-scan.mjs`.
- Commands/results: `npm run test:unit` 182 pass / 0 fail; `node scripts/verify-scan.mjs` 15/15; `node scripts/verify-v8.mjs` 26/26 against the production bundle. Known-dataset smoke: prepared Sora clip registered 2/54 frames and failed honestly; public South Building sample trained Brush (122 158 splats, 2.2 MB SPZ) and loaded in the in-site viewer.
- Toolchain evidence: [scan-toolchain.md](scan-toolchain.md). Tools live under git-ignored `var/tools`; set `SCAN_COLMAP` to `var/tools/colmap/bin/colmap.exe` and `SCAN_BRUSH` to `var/tools/brush/brush_app.exe` (the binary is `brush_app.exe`, not `brush`). `cloudflared` is not installed yet.
- Evidence outside the repo: `C:\Users\fauzi\OneDrive\Documents\qa-scan` (scan e2e report/screenshots) and `qa-v8`. `dist/` was restored after verification; run `npm run build` before `npm run scan:serve`.
- Next unfinished step: record one 30–45 s rear-camera clip of a real chair, finish the Task 1 registration/timing/go-no-go numbers, then run Task 13 on the phone over a tunnel.

## 2026-11-20 · Platform-wide white-and-green redesign

- Branch `main`, baseline `ed42282` (the catalogue-only pilot). Goal: carry the white-and-green direction from `/beli` across every route without changing URLs, filtering, saved/cart/offer state, prices, checkout eligibility, media provenance or viewer behavior.
- Before: only `/beli` used the white pilot; home, product, saved, compare, cart, checkout, photo search, store, about, seller, capture and review still had the `#F6FBF1` page canvas and sage surfaces. `#toast` was also unstyled because `src/style.css` is an unimported legacy sheet (left in place for source continuity; do not revive the import).
- Foundations: rewrote `src/brand-tokens.css` (white surface, neutral media wells, charcoal ink, green `#176044` actions/selected states, warning/danger/focus kept distinct, dark stage tokens), then remapped legacy aliases so older rules inherit the same system. Updated header/nav/footer, buttons, chips, cards, forms, dialogs, empty/loading/error states and mobile navigation in `src/stitch.css`.
- Screens: rebuilt the home first screen around search, category chips and real listings (`src/main.js`); refined product identity, tabs, gallery and sticky purchase panel (`src/product-views.js/.css`); unified saved tabs, notices, cart and summary panels (`src/buyer-views.js/.css`, `src/stitch.css`); clarified seller current step and primary next action, plus camera/capture chrome tokens (`src/seller.css`, `src/camera-search.css`, `src/inspection.css`, `src/video-capture.css`). Removed page-level eyebrow kickers on home, compare, about, saved, cart, snapshot, product and photo-search; kept informational labels such as condition notes and seller steps. Desktop catalogue rail now begins at 900 px (was 1,050 px), sticky at 96 px, with the mobile filter sheet below that.
- Commands and results: `npm run test:unit` 127 pass / 0 fail. `npm run build` succeeds (existing >500 kB GLTFLoader warning). `node scripts/verify-v8.mjs` 26 pass / 0 fail against the production bundle. `node scripts/capture-redesign.mjs` captured 96 route/viewport shots (24 routes × 1440, 1024, 390, 320, including the condition inspection tab, /checkout, /barang-saya and /buat) with 0 horizontal overflow, 0 clipped controls, 0 page/console errors. `node scripts/audit-redesign.mjs` confirms every audited route now renders a `#ffffff` body with `#1b2420` headings; keyboard tabs show the 3 px `#2F5BD0` focus ring, and the existing dialog checks cover the mobile filter sheet and offer composer last fields plus return focus.
- Regression found and fixed during verification: a new `body { min-width: 280px }` broke the existing 390 px / 200% zoom layout check. A clean baseline worktree confirmed `ed42282` passed; removing the rule restored fluid reflow. Keep the 200% zoom case in the browser suite.
- Evidence outside the repo: `C:/Users/fauzi/qa-redesign/before` and `/after` (PNG pairs plus `report.json` and `audit.json`), `C:/Users/fauzi/qa-v8-final/report.json`, `C:/Users/fauzi/qa-v8-baseline/report.json`. New QA scripts are `scripts/capture-redesign.mjs` and `scripts/audit-redesign.mjs`.
- Deployment issue: `npm run build` replaces the tracked prerendered `dist/` route HTML and asset hashes (`dist/barang/*/index.html`, `dist/beli/index.html`, `dist/cari-dari-foto/index.html`, `dist/jual/index.html`). Those files were restored with `git checkout -- dist` and the new build assets were moved to `C:/Users/fauzi/qa-redesign/dist-build-assets`. The release pipeline must regenerate route HTML after building instead of trusting the committed bundle.
- Next unfinished step: human review of the before/after pairs at 1440, 1024, 390 and 320, then decide whether to commit the redesign together with the QA scripts and how the prerendered `dist` output should be produced. Live furniture scanning remains in its own workstream.

## 2026-11-20 · Handoff preparation

- Baseline `1d70d75ccc29fbb6f62ef54e60e309e1ef6e0610`. Baseline install and production build passed with Node 24.22.3. 127 unit tests passed and the selected existing browser run passed three checks covering the gateway, catalogue and filter draft behavior. The build warned about an existing large optional GLTFLoader chunk.
- The existing desktop rail is visible at 1,440 px and source hides it at ≤1,050 px. The full baseline screenshot shows price below the complete category group and Apply below the entire rail. Treat the owner's report as a discoverability issue to investigate at their width and entry route.
- Tested a white-and-green catalogue direction in a separate checkout. The pilot passed 127 unit tests, a production build and eight focused Chromium viewport cases. The original and pilot both successfully apply and remove a Rp1.500.000 cap at those widths. The broader browser run was still in progress at packaging. See the design folder for evidence, scope and reproduction data.
- Real camera capture, laptop processing and in-site display from fresh physical footage are pending. The first scan needs a real phone clip and the Helios.
- Next session starts with catalogue triage or the scan proof, using the respective workstream.

## Template

- Date, branch, commit and goal
- Behavior before, changes made and affected paths
- Commands, viewports/devices and outcomes, with evidence paths
- Decisions or limits that affect the next session
- Next unfinished step
