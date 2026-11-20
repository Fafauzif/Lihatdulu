# Triage and verification

1. Record branch/commit, route, width, zoom, device, expected and observed behavior. Start with `/`, `/beli`, Sora product/gallery/model, saved/compare, and the seller entry. Check the live judging URL separately if supplied.
2. Take one screenshot before editing and after. Follow underlying state from the route to validation/selectors then persistence or render. Prefer the smallest change and add focused coverage when existing checks miss the defect.
3. Run `npm run test:unit` and `npm run build`. Run the relevant production-bundle checks with `npm run test:browser` and optionally `npm run test:production` for retained model assets/deep routes. The existing V8 harness targets the built bundle and intentionally denies device media on prepared paths. Add separate browser tests for the new capture route and retain the original denial checks on prepared examples. Software WebGL and emulated viewports do not certify physical phones.
4. Use `QA_OUTPUT` to put artifacts outside the repo and `QA_ONLY` for a selected regex of named V8 checks. Examples are `ET01|ET02|ET03|ET04` for shopping/filtering, and the layout/responsive entries near the end of `scripts/verify-v8.mjs`. Read the generated report to confirm the requested checks ran. On PowerShell, set process environment with `$env:QA_OUTPUT = "$env:TEMP/lihatdulu-qa"` and analogous syntax for `QA_ONLY`. Remove a previous selection before a full run.
5. Exercise the altered flow and a sibling path, with deep-link refresh and relevant failure recovery. Test keyboard focus, visible control labels, active-filter updates and narrow widths. Record the exact number of checks and any outstanding test surface.

## Triage queue

| Priority | Candidate | What to verify |
|---|---|---|
| P0 | Shopping entry and filter visibility | Compare the homepage and catalogue at user's width; check category, min/max price, location and the Apply affordance without coaching. |
| P1 | Filter shortcuts may lose existing refinements | Reproduce with a query, category and nondefault sort, then click the price or 3D shortcut and inspect resulting URL. |
| P1 | Layout at breakpoint and zoom | Check 1024, 900, 899, 768, 390 and 320 px. Confirm no clipped text, compare tray overlap or trapped scroll. |
| P1 | Fresh scan lifecycle | Start after local reconstruction proof. Verify permissions, transfer, retries, output identity and prepared-flow isolation. |

Use the session log to distinguish reproduced defects from observations and hypotheses.
