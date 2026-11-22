# Acceptance and comparison protocol

Assess the result at the same viewport size and camera in each A/B pair. Save the actual images, not just data attributes or screenshot bytes. Use Golden to tune, Repeat to verify after values are frozen, and the 10.03-second take to see whether changes help poor footage. Use extra takes to check whether apparent gains generalize across the available chair evidence.

## Visual quality gate

| Check | Pass condition |
|---|---|
| Initial desktop and phone-width view | The whole chair is immediately recognizable and upright. It is centered, comfortably framed, and clearly separated from unrelated room fragments. |
| Three inspection views | Front or three-quarter, side, and rear views show consistent chair geometry. The reviewer can identify the seat, backrest, arm supports, and base or wheels where visible in the corresponding evidence. |
| Detail retention | The change preserves visible edges and materials, especially the thin frame and mesh. Visible holes, duplicate parts, haze, or foreground streaks do not hide the features needed to judge the chair. |
| Orbit and recovery | A drag changes the viewing angle around the subject. Zoom and reset keep the subject recoverable. Rotation is checked on a desktop viewport and a touch-emulated narrow viewport. Resize and route re-entry behave predictably. |
| Before and after | The reference stills and camera-matched baseline are available beside the candidate. Differences are reviewed in the actual frames. The reviewer can name concrete defects that improved and any tradeoffs. |
| Confirmation | Golden and the reserved Repeat both clear the floor with the same frozen config. Give the stress case its own demonstrated verdict. |

A passing visual result shows more than a deposit of pixels near the center. Grade each check `pass`, `partial`, `fail`, or `not observed`, with an image or video link and one sentence of evidence. Independently review finalists where possible. A headless screenshot gate or a high registration rate is evidence of execution. Treat a visual pass as an additional decision.

Use fixed views for diagnosis and fair comparison. If source camera extrinsics can be recovered, use an approximate source camera view in addition to a novel orbit. Pixels from mismatched cameras are unsuitable for numeric image comparisons. Report crop or projective alignment if making a matched image comparison. Raw occupancy, opacity distributions and counts can flag anomalies for review. Avoid promoting a result solely because those numbers moved.

## Technical and run gates

- Keep existing frame, registration, result-size, and artifact validity checks. Open the actual SPZ in the intended SparkJS viewer.
- Record tool and profile versions, input and output hashes, frame sizes, stage times, output MiB, and time to the first usable view in the tested setup. State whether upload, queue, network or software rendering was involved.
- Verify an unchanged project baseline and applicable code changes with `npm run test:unit`, `npm run build`, `npm run test:browser`, and `node scripts/verify-scan.mjs`. The checkout previously passed 26 marketplace and 15 simulated scan checks. The Linux baseline had 196/197 unit tests with one Windows path assumption. Establish the actual result on the Helios.
- Verify that normal scan behavior remains available, the earlier prepared Sora flow stays separate, and the candidate can be selected explicitly using a documented opt-in. Preserve previous job compatibility. A replay, fixture, and live scan must have distinct provenance.
- Treat phone viewport emulation, local file replay, the physical phone camera, and a phone viewing a real result over HTTPS as different checks. Leave any unobserved physical behavior clearly pending.
- Deliver a demonstrated visual winner only if it passes the visual gate. Otherwise keep the strongest observed pair for a follow-up and record what still fails.

## Timing after the quality gate

Track capture-to-preview delay and worker-stage latency separately. Attribute any speed improvement to the tested modification. Check that comparisons have the same source, hardware, load, and output quality floor. Keep exact numbers and avoid multiplier claims unsupported by measured runs.
