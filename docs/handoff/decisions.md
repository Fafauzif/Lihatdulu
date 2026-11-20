# Decisions

| Area | Current decision | Revisit when |
|---|---|---|
| Seller capture | Real rear-camera flow inside `/jual`, with automatic reconstruction after capture. | Physical camera and worker proof surfaces a capability or reliability constraint. |
| Demo processing | Owner approved a separate demo laptop as the first worker. Start with FFmpeg, sparse COLMAP, and a compatible Brush release. | A representative clip cannot produce a usable result on the actual machine. |
| Network and state | Serve the frontend and job API together at one HTTPS origin for judging. Use disk-backed scan folders and one worker as the default. | The demo needs multiple sellers or permanent cross-device access. |
| Product truth | Show actual scan provenance, source close-ups and manually measured dimensions. Keep authored Sora 3D motions and room fit. | A separately validated measurement or moving-part workflow is ready. |
| Marketplace UX | Try a white canvas with restrained green secondary/selection styling. Catalogue search, left filters, price and categories should be immediately recognizable. | Browser evidence on key widths or owner feedback favors a layout adjustment. |
| Scope | Keep Vite/JavaScript/Three.js and existing marketplace behaviors. Improve in tested slices. | The owner approves a different stack or changes a core product contract. |
| Capture guidance | Use clear filming instructions first. Show coverage only where real processing supplies evidence. | A measured coverage method proves helpful during recording. |

## Still open

- Phone model/browser, laptop OS and driver, available disk, actual clip quality and runtime.
- Whether the demo needs a pre-existing domain or a temporary HTTPS link is acceptable on the venue network. Current plan uses the latter.
- Whether the homepage should remain a distinct gateway once feedback on its first screen is collected. Keep the two entrances for the first pass.
- Exact style and final breakpoint after human review. The supplied pilot screens establish one testable direction.
