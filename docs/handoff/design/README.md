# White-and-green catalogue pilot

**Tested on a separate checkout of V8.** Here are two versions of the same `/beli` page, using the same product data and browser window.

| Width | Baseline | White and green |
|---|---|---|
| 1440 px | [Baseline desktop](baseline-1440.png) | [Pilot desktop](pilot-1440.png) |
| 1024 px | [Baseline compact desktop](baseline-1024.png) | [Pilot compact desktop](pilot-1024.png) |
| 390 px | [Baseline mobile](baseline-390.png) | [Pilot mobile](pilot-390.png) · [Filter sheet](pilot-filter-390.png) |
| 320 px | [Baseline narrow](baseline-320.png) | [Pilot narrow](pilot-320.png) |

The original rail starts at 1,051 px; Apply originally starts roughly 2,135 px down the page in the 1,440 × 900 fixture. The pilot restores the left rail at 900 px, puts price first, constrains the scrollable filter list and keeps Apply and Cancel visible in the tested first viewport. At phone widths, category chips wrap and price/3D options are available inside the labeled Filter sheet. The green accent `#176044` has about 7.5:1 contrast on white. The palette is scoped to the catalogue route, including its site chrome.

The screenshots show a design hypothesis with browser evidence. Follow up on mobile density, discoverability of the scrollable filter groups, location prominence, and whether home behaves like a shopping entrance. Inspect accessibility and actual behavior independently of the screenshots.

## Try the pilot on a disposable branch

From the repo root after extraction:

```sh
git apply --check docs/handoff/design/white-green-catalogue.patch
git apply docs/handoff/design/white-green-catalogue.patch
npm run build
node docs/handoff/design/check-marketplace-study.mjs
npm run dev
```

Open `/beli`. The patch covers `src/main.js`, `src/discovery-views.js` and `src/stitch.css`. Review the changes and rework into the existing CSS owners if you adopt the direction. A failed patch check means the checkout diverged. Port the relevant ideas with a source diff.

The Playwright script checks eight desktop-to-phone viewport cases for the right filter control, a visible product, page overflow, applying an Rp1.500.000 cap and removing the filter. For the baseline, build the original checkout and run the script with `--baseline`. The [baseline](baseline-checks.json) and [pilot](pilot-checks.json) results are saved here. These checks use headless Chromium, so repeat the final experience on a physical phone and ask people to try the marketplace tasks in the [workstream](../workstreams/marketplace.md).
