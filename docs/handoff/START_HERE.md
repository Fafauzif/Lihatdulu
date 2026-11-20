# Continue LihatDulu in DeepSeek Harness

**Baseline** `main` at `1d70d75ccc29fbb6f62ef54e60e309e1ef6e0610` · [Fafauzif/LihatDulu-demo](https://github.com/Fafauzif/LihatDulu-demo) · app version 8.0.0.

Extract this full-project archive into an empty folder, then open that folder as your new repository. `package.json` is at the root. The Git commit above identifies the upstream source snapshot. Your fresh repository will have its own commit history. Start a fresh DeepSeek Harness session from the repo root so it discovers `.dsh/skills/`. See [the package manifest](overwrite-manifest.md) for the contents.

| Session | Do this | Completion evidence |
|---|---|---|
| 1. Baseline and marketplace triage | Read the current brief and marketplace workstream. Capture `/` and `/beli` on desktop, tablet and phone. Check the visual pilot and work through the priority tasks. | Actual routes, widths and tasks logged, including any discrepancy with the judging URL. |
| 2. Reconstruction proof | Run the setup checker on the Helios and reconstruct one real furniture clip using the scan workstream. | Source clip and a rotatable splat from that clip alongside stage timings, compatibility and coverage observations. |
| 3. Live web capture | Connect the website camera to the laptop worker, then open the new result inside LihatDulu. | A new phone scan works without moving files by hand. Verify retake, failure and the prepared Sora journey. |
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

For the scan session, replace the marketplace paragraph with the [scan proof milestone](workstreams/scan.md). Keep the original V8 pack as a historical reference and follow the authority order in the current brief.

## Follow-up prompts for a fresh session

**Reconstruction proof**

> Read AGENTS.md and the scan workstream. Run the setup checker on my Helios, confirm native tool versions, and build a repeatable single-clip workflow. Start with footage of one real chair or stool when available. Save the camera registration count, stage timings and viewer checks. Stop before app integration only if I need to provide a real clip, hardware access or a model-quality decision.

**Live capture**

> Read the latest scan proof and the scan workstream. In LihatDulu, allow a seller to record with the rear camera, submit automatically to the laptop's single worker, monitor the real status and view the artifact from that specific job. Keep the prepared Sora example usable. Prove this with a fresh physical camera recording when hardware access is available. Record recovery checks and the exact URL/setup used.

**Bug fix and UI follow-through**

> Read the marketplace and QA workstreams, then take the top reproduced issue in the session log. Write down the reproduction and observable success criteria. Fix the issue using existing code paths and verify both its normal and failure paths on the relevant widths. For design changes, compare screenshots with the same data. Record any unresolved issue with reproduction and evidence.
