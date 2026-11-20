# Marketplace discovery and design

**Goal** — Someone landing on LihatDulu can tell it is a place to shop for secondhand furniture, pick a category, set a price cap, and compare results without coaching.

## What exists now

- `src/main.js` owns the `/` gateway and `/beli` shell, search, category bar, filters, sorting, applied chips and cards. `src/discovery.js` owns available facets, categories, URL state and filter predicates. `src/discovery-views.js` and `src/discovery-views.css` own the shared desktop/mobile form and validation. `src/stitch.css` controls the layout and breakpoints. `src/brand-tokens.css` holds palette aliases and focus, error and success tokens.
- A 218 px desktop rail exists, and the `max-width: 1050px` CSS hides it in favor of a Filter button. Categories already include Tempat duduk, Meja and Penyimpanan with derived counts. Child categories such as Kursi, Sofa, Bangku and Lemari exist in the filters. Reproduce the owner's entry route, actual deployed build, viewport width and zoom before treating a perceived missing feature as an implementation gap.
- URL state is the source of truth and the form is a draft. Preserve OR within one multi-select group, AND between groups, whole-Rupiah validation, stable sorting, removable chips, scoped reset, cancel and back/forward restoration. Quick-filter controls should preserve unrelated criteria when their label promises refinement. Inspect the existing `model=1` and price shortcut links for URL replacement when testing that behavior.

## Design direction

- White page, neutral image wells and charcoal type. Use green for selection, focus-adjacent accents and primary marketplace actions. Start from the [tested pilot](../design/README.md). Keep product imagery prominent. Avoid gradients, giant slogans and promotional clutter in the buying path.
- On desktop, prioritize search, category navigation, then the filter rail and results together. Price Min/Max in Rp, category, and location should be apparent; put conditions, material, dimensions and 3D where they can be found. Keep Apply visible while browsing the filter list. If using collapsible groups, open active/invalid groups and test keyboard focus.
- On mobile, put visible category choices and a labeled **Filter** near **Urutkan** above results. Show active filters outside the drawer. Keep item photos and price in view early. Ensure the filter sheet can apply edits with a short viewport or on-screen keyboard.
- Market cards should lead with photo, price, item name and location. Preserve condition/size access, seller provenance, save, compare and real media capabilities. Maintain image aspect ratio and legibility at 320 px. Use only matching item imagery from the repo or a real new scan.
- On `/`, inspect whether the primary browse action and meaningful categories/items appear early enough. Keep `/jual` discoverable. Treat real scanning as a seller capability and 3D inspection as a buyer feature.

## Real references

| Source | Pattern to study |
|---|---|
| [Chairish Furniture](https://www.chairish.com/collection/furniture) | How a multi-seller furniture assortment gives category and furniture-specific characteristics a clear position. |
| [Carousell Indonesia — meja kursi](https://id.carousell.com/toys-collectibles/furnitur/meja-kursi/q-660/) | Local resale language, price and condition cues in a results flow. |
| [IKEA Indonesia — kursi makan](https://www.ikea.co.id/in/produk/kursi-makan) | How a furniture category reads on a light canvas with clear product imagery. This is a retail reference. |
| [Baymard — filter UI](https://baymard.com/blog/ecommerce-filter-ui) and [applied-filter overview](https://baymard.com/research-articles/how-to-design-applied-filters) | Left rail for wide space, discoverable mobile filters, and visible removable applied criteria. |

Use these for behavior and hierarchy. Keep LihatDulu's own components, brand and data. Review the actual site state before taking visual cues from it.

## Acceptance tasks

| Task | Observable result |
|---|---|
| From home, find seating and narrow to a budget of Rp1.500.000 | Real category and price constraints remain visible; count and cards agree. |
| Refine by city, sort by price, remove only the city chip | Remaining category, price and sort survive, including browser back/forward and reload. |
| Try invalid Min/Max on desktop and mobile | Draft receives a visible error and focus. Results and URL stay intact. Cancel discards the draft. |
| Visit `/beli` at 1440, 1024, 900, 899, 768, 430, 390 and 320 px | Right control is obvious at the breakpoint. Product grid reflows, labels fit, no horizontal overflow or unreachable Apply. |
| Open a card, inspect condition, go back, and save or compare | Correct item media, preserved discovery context and working existing actions. |
| Ask two people to find a chair within a budget on phone and desktop if testers are available | Record first click, any confusion and whether the task was completed without hints. Label browser tests separately from human feedback. |
