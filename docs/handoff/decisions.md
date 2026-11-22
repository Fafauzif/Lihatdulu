# Decisions

| Area | Current decision | Revisit when |
|---|---|---|
| Seller capture | Real rear-camera flow inside `/jual`, with automatic reconstruction after capture. | Physical camera and worker proof surfaces a capability or reliability constraint. |
| Demo processing | Owner approved a separate demo laptop as the first worker. Start with FFmpeg, sparse COLMAP, and a compatible Brush release. | A representative clip cannot produce a usable result on the actual machine. |
| Network and state | Serve the frontend and job API together at one HTTPS origin for judging. Use disk-backed scan folders and one worker as the default. | The demo needs multiple sellers or permanent cross-device access. |
| Product truth | Show actual scan provenance, source close-ups and manually measured dimensions. Keep authored Sora 3D motions and room fit. | A separately validated measurement or moving-part workflow is ready. |
| Marketplace UX | White canvas with restrained green actions and selections platform-wide, from the pilot accent `#176044`. Catalogue search, left filters, price and categories should be immediately recognizable. | Browser evidence on key widths or owner feedback favors a layout adjustment. |
| Design system | Shared colour, type, spacing, radius and focus decisions live in `src/brand-tokens.css` and `src/stitch.css`; page-level eyebrow kickers are removed, informational labels stay. Desktop catalogue rail shows at ≥900 px with a sticky internal filter list. | A human review finds the rail cramped between 900 and 1,050 px, or the kicker rule conflicts with a future information need. |
| Scope | Keep Vite/JavaScript/Three.js and existing marketplace behaviors. Improve in tested slices. | The owner approves a different stack or changes a core product contract. |
| Capture guidance | Use clear filming instructions first. Show coverage only where real processing supplies evidence. | A measured coverage method proves helpful during recording. |
| Real scan runtime | One Node process serves the built site, SPA routes and `/api/scans`; one disk-backed worker runs FFmpeg → COLMAP → Brush → SPZ. Opaque UUID job IDs are the capability; no job list, no accounts. | A second worker or persistent ownership is needed for judging. |
| Real scan limits | 100 MB upload, 8–45 s clip (server accepts 7–50 s), 60 frames minimum, 60 MB / 2.5 M splat artifact cap, 10 finished jobs retained. | Real footage shows the limits are wrong for the chair. |
| Real scan truth | The preview is a separate `/pindai/:id` route with clip provenance, measured dimensions and frames extracted from the same clip. Scans do not become catalogue listings. | The owner wants scans listed in the catalogue. |
| Scan toolchain | Pin COLMAP 4.2.1 and Brush 0.3.0 locally under `var/tools` and resolve them with `SCAN_COLMAP` / `SCAN_BRUSH`; do not change the system PATH. | The demo laptop is reimaged or a second laptop is used. |
| Real chair capture | Rear camera at 1080p; one slow orbit, preferably 15–25 s, at two heights with overlapping views; 3 fps base extraction (retry to 5–8 fps only when a VFR clip misses the 60-frame floor); 4K source is unnecessary after the 1280 downscale; side light for dark furniture. | A physical phone/tunnel run or a reshoot shows different quality. |

| Subject framing | Keep the room-scale export and add an opt-in `SCAN_PROFILE=chair` profile: centre from the aligned camera optical axes, radius `clamp(0.9 x r90 of the opaque mass about its own median, 1.8, 2.7)`, 6000 training steps. Default scans stay unfiltered. | A take's mass cannot be measured (fewer than 3 usable cameras, near-parallel axes, damaged cloud), or a second take shows the sphere removing chair parts. |
| Profile training budget | The chair profile trains 6000 steps, not the 3000-step default: after the room is removed, 3000 leaves 1 711 splats and visible streaking. The longer run costs about 2.5 min more on the demo laptop. | A faster reconstruction path reaches the same density, or scans must return in under about 5 minutes. |
| Profile failure mode | A cleanup failure is never fatal: the job records `profile.applied:false` with the reason and exports the untouched cloud, so a take is never lost to the filter. | Provenance-free fallbacks are needed for a contract that requires the filtered result. |
## Still open

- Phone model/browser, laptop OS and driver, available disk, actual clip quality and runtime.
- Whether the demo needs a pre-existing domain or a temporary HTTPS link is acceptable on the venue network. Current plan uses the latter.
- Whether the homepage should remain a distinct gateway once feedback on its first screen is collected. Keep the two entrances for the first pass.
- Exact style and final breakpoint after human review. The supplied pilot screens establish one testable direction.
