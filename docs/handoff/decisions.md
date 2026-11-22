# Decisions

| Area | Current decision | Revisit when |
|---|---|---|
| Seller capture | Upload-only for now: choose an existing MP4 inside `/jual`, preview and confirm before sending. The in-browser camera comes after one real clip passes end-to-end. | A live KIRI result opens cleanly in the viewer and the phone capture can reuse the same submit path. |
| Scan provider | KIRI Engine cloud (3DGS video job, automatic object masking) behind a server-side adapter. The local FFmpeg → COLMAP → Brush worker is retired from the active tree. | KIRI reliability, cost, retention or result quality fails the live test. |
| Scan credentials | `KIRI_API_KEY` is server-only, read from the environment or a local git-ignored `.env`, never sent to the browser, written to a job record or logged. | The deployment needs a managed secret store or per-user keys. |
| Network and state | One same-origin Node process serves the built site, SPA routes and `/api/kiri`; job records and artifacts live under the git-ignored `var/kiri`. | The demo needs multiple workers or permanent cross-device access. |
| Product truth | Label scan provenance honestly; mock results say they are local, live results name KIRI Engine and keep the serial. Keep authored Sora 3D motions and room fit separate. | A separately validated measurement or moving-part workflow is ready. |
| Marketplace UX | White canvas with restrained green actions and selections platform-wide, from the pilot accent `#176044`. Catalogue search, left filters, price and categories should be immediately recognizable. | Browser evidence on key widths or owner feedback favors a layout adjustment. |
| Design system | Shared colour, type, spacing, radius and focus decisions live in `src/brand-tokens.css` and `src/stitch.css`; page-level eyebrow kickers are removed, informational labels stay. Desktop catalogue rail shows at ≥900 px with a sticky internal filter list. | A human review finds the rail cramped between 900 and 1,050 px, or the kicker rule conflicts with a future information need. |
| Scope | Keep Vite/JavaScript/Three.js and existing marketplace behaviors. Improve in tested slices. | The owner approves a different stack or changes a core product contract. |
| Capture guidance | Use clear filming instructions first. Show coverage only where real processing supplies evidence. | A measured coverage method proves helpful during recording. |
| Scan runtime | A KIRI serial is stored against an opaque LihatDulu UUID; polling backs off, and the result ZIP is downloaded, validated and converted server-side. Opaque IDs are the capability; no job list, no accounts. | A second worker or persistent ownership is needed. |
| Scan limits | MP4 up to 200 MB, 3 minutes, 1920×1080; KIRI serial and artifact retained for the KIRI 3-day window; 60 MB / 2.5 M splat artifact cap; 50 terminal jobs kept. | Real footage shows the limits are wrong for a chair. |
| Scan dedupe | SHA-256 of the uploaded bytes; a ready or active job is reused and never resubmitted. Failed or expired jobs are not reused; retry is only an explicit user action and never re-submits. | The same clip must produce two different results or a second retry path is needed. |
| Scan toolchain | The only external process is the pinned `@playcanvas/splat-transform` converter in `node_modules`; no COLMAP, Brush, CUDA, FFmpeg or PATH changes. `docs/handoff/scan-toolchain.md` is historical. | KIRI changes its PLY layout or the converter pin is upgraded. |
| Scan truth | The preview is `/pindai/:id`, with provider, serial (truncated), splat count and timings. Scans do not become catalogue listings. | The owner wants scans listed in the catalogue. |

## Still open

- One authorized live KIRI run: does a real clip open as a usable chair, how long does it take, and how large is the SPZ? Nothing has been submitted yet.
- KIRI credit budget, serial retention and whether the demo needs a pre-existing domain or a temporary HTTPS link.
- Whether the in-browser camera is needed for judging or an upload-only flow is enough.
- Whether the homepage should remain a distinct gateway once feedback on its first screen is collected. Keep the two entrances for the first pass.
- Exact style and final breakpoint after human review. The supplied pilot screens establish one testable direction.
