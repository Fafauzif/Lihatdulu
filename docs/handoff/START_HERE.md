# Continue LihatDulu in DeepSeek Harness

> **Competition release (2026-11-23):** the integration branch is
> `release/competition-judge`. Read [kiri-release.md](kiri-release.md) first for
> what shipped, what was verified and the two remaining gates (an HTTPS scan
> host and one physical-phone run). The judge walkthrough is in the root README.

**Baseline** `main` at `1d70d75ccc29fbb6f62ef54e60e309e1ef6e0610` · [Fafauzif/LihatDulu-demo](https://github.com/Fafauzif/LihatDulu-demo) · app version 8.0.0.

Extract this full-project archive into an empty folder, then open that folder as your new repository. `package.json` is at the root. The Git commit above identifies the upstream source snapshot. Your fresh repository will have its own commit history. Start a fresh DeepSeek Harness session from the repo root so it discovers `.dsh/skills/`. See [the package manifest](overwrite-manifest.md) for the contents.

| Session | Do this | Completion evidence |
|---|---|---|
| 1. Baseline and marketplace triage | Read the current brief and marketplace workstream. Capture `/` and `/beli` on desktop, tablet and phone. Check the visual pilot and work through the priority tasks. | Actual routes, widths and tasks logged, including any discrepancy with the judging URL. |
| 2. KIRI live proof | Run the labelled mock flow, then one authorized KIRI job with a real clip using the scan workstream. | A real clip becomes a rotatable splat at `/pindai/:id`, with stage timings, KIRI serial and SPZ size. |
| 3. Camera capture | After the live proof, add the in-browser rear camera and reuse the same submit path. | A phone clip goes through KIRI and opens without moving files by hand; failure, reload and the Sora journey still work. |
| 4. Marketplace polish and bug fixes | Carry usable design changes into the site and work through the evidence-backed bugs. Prioritize catalogue discovery and the seller-to-buyer path. | Desktop/mobile screenshots, exercised purchase-rehearsal paths and meaningful regression results. |
| 5. Judging rehearsal | Run the story on the actual phone, laptop and network. | The fresh-scan process, a clearly labeled earlier scan ready to show, and the measured timing. |

Sessions 1 and 2 can proceed independently. Split marketplace changes and scan work into separate Git commits where practical.

## Local baseline

```sh
node scripts/lihatdulu-doctor.mjs
npm ci
npm run test:unit
npm run build
npm run test:browser
npm run dev
```

Vite 8 in the checked-in lockfile requires Node `^20.19.0 || >=22.12.0`. The production build writes `dist/`, which is tracked at this baseline. Decide whether to commit regenerated `dist/` from the actual deploy configuration. Windows Playwright may need `npx playwright install chromium`. See the [QA workstream](workstreams/qa.md) for report paths, filters and the existing prepared-camera assertion.

## First prompt to paste

> Read AGENTS.md, docs/handoff/context/CURRENT.md, and the decisions, session log and marketplace workstream under docs/handoff. Read the live code for / and /beli. Run the doctor and establish the baseline. Compare the tested white-and-green pilot in docs/handoff/design to the current routes at 1440, 1024, 768, 390 and 320 px, then implement the smallest coherent change that makes categories, price, location, and product results easy to find. Keep URL-backed filters and existing buyer/seller contracts. Use the relevant project skills without replacing the stack. Show screenshots and test real shopping tasks. Update the session log and leave the scan worker for its own session.

For the scan session, replace the marketplace paragraph with the [KIRI scan workstream](workstreams/scan.md). Keep the original V8 pack as a historical reference and follow the authority order in the current brief.

## Follow-up prompts for a fresh session

**KIRI live proof**

> Read AGENTS.md, the [KIRI scan page](kiri-scan.md) and the scan workstream. Run the labelled mock flow end-to-end first. Then, only with my key and explicit approval, submit one real chair clip to KIRI Engine. Record the serial, stage timings, SPZ size and viewer checks at 1440 and 390 px. Do not submit a second clip or spend another credit without asking.

**Camera capture**

> Read the live KIRI proof and the scan workstream. Add the in-browser rear camera to `/jual/pindai`, submit the recorded clip through the same server adapter, monitor the real status and open `/pindai/:id`. Keep the prepared Sora example usable. Prove it with a fresh phone recording, reload resume, failure and retake checks.

**Bug fix and UI follow-through**

> Read the marketplace and QA workstreams, then take the top reproduced issue in the session log. Write down the reproduction and observable success criteria. Fix the issue using existing code paths and verify both its normal and failure paths on the relevant widths. For design changes, compare screenshots with the same data. Record any unresolved issue with reproduction and evidence.
