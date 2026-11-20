import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { testBrowserPath } from './test-browser.js';

// Visual evidence for the white-and-green redesign. Runs against a dev or
// preview server (QA_BASE) and writes screenshots outside the release tree.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.QA_OUTPUT || path.resolve(root, '../../qa-redesign');
const base = process.env.QA_BASE || 'http://127.0.0.1:5177';
const only = process.env.QA_ONLY ? new RegExp(process.env.QA_ONLY, 'i') : null;
const fullPage = process.env.QA_FULL_PAGE !== '0';

const widths = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 768 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 568 },
];

const routes = [
  { name: 'home', route: '/' },
  { name: 'catalogue', route: '/beli' },
  { name: 'catalogue-filtered', route: '/beli?category=seat&max=1500000' },
  { name: 'product-photos', route: '/barang/sora?tab=photos' },
  { name: 'product-model', route: '/barang/sora?tab=model' },
  { name: 'product-room', route: '/barang/tala?tab=room' },
  { name: 'product-condition', route: '/barang/sora?tab=condition' },
  { name: 'product-no-model', route: '/barang/awan' },
  { name: 'saved', route: '/tersimpan' },
  { name: 'saved-summary', route: '/ringkasan/sora' },
  { name: 'compare', route: '/bandingkan' },
  { name: 'cart', route: '/keranjang' },
  { name: 'checkout', route: '/tinjau-pesanan' },
  { name: 'checkout-alias', route: '/checkout' },
  { name: 'photo-search', route: '/cari-dari-foto' },
  { name: 'store', route: '/toko/sora' },
  { name: 'about', route: '/tentang' },
  { name: 'seller-workspace', route: '/jual' },
  { name: 'seller-drafts', route: '/barang-saya' },
  { name: 'seller-create', route: '/buat' },
  { name: 'seller-capture', route: '/jual/sora/rekam' },
  { name: 'seller-review', route: '/jual/sora/tinjau' },
  { name: 'buyer-preview', route: '/barang/sora?preview=1&tab=photos' },
  { name: 'missing', route: '/halaman-tidak-ada' },
];

const seed = () => {
  localStorage.setItem('lihatdulu:compare:v1', JSON.stringify(['sora', 'arca', 'batu']));
  localStorage.setItem(
    'lihatdulu:marketplace:v1',
    JSON.stringify({
      schema: 1,
      cart: ['sora', 'arca'],
      drafts: {},
      collections: [],
      checkout: { delivery: 'delivery', payment: 'bank' },
    }),
  );
  localStorage.setItem('lihatdulu:favourites:v2', JSON.stringify(['sora', 'tala']));
  localStorage.setItem('lihatdulu:reminders:v1', JSON.stringify(['lino']));
};

await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: await testBrowserPath(),
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const report = { base, started: new Date().toISOString(), shots: [], layouts: [], pageErrors: [], consoleErrors: [] };

try {
  for (const size of widths) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
    await context.addInitScript(seed);
    const page = await context.newPage();
    page.on('pageerror', (error) => report.pageErrors.push({ route: page.url(), message: error.message }));
    page.on('console', (message) => {
      if (message.type() === 'error') report.consoleErrors.push({ route: page.url(), message: message.text() });
    });
    for (const entry of routes) {
      if (only && !only.test(entry.name)) continue;
      await page.goto(base + entry.route, { waitUntil: 'networkidle' });
      await page.locator('#main').waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.images].map((image) => {
            image.loading = 'eager';
            return image.decode().catch(() => {});
          }),
        );
        for (const video of document.querySelectorAll('video')) video.pause?.();
      });
      await page.waitForTimeout(150);
      const facts = await page.evaluate(() => {
        const visible = (element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const scroller = (element) => {
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (/(auto|scroll)/.test(getComputedStyle(parent).overflowX)) return true;
          }
          return false;
        };
        const clipped = [...document.querySelectorAll('#main a,#main button,#main input,#main select,#main textarea')]
          .filter(visible)
          .map((element) => ({
            label: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 50),
            left: Math.round(element.getBoundingClientRect().left),
            right: Math.round(element.getBoundingClientRect().right),
            allowedScroll: scroller(element),
          }))
          .filter((item) => (item.left < -1 || item.right > innerWidth + 1) && !item.allowedScroll);
        return {
          viewport: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          clipped,
          heading: document.querySelector('#main h1')?.textContent.trim() || '',
        };
      });
      const file = path.join(output, `${size.name}-${entry.name}.png`);
      await page.screenshot({ path: file, fullPage });
      report.shots.push({ size: size.name, route: entry.route, file });
      report.layouts.push({ size: size.name, route: entry.route, ...facts });
      console.log(size.name, entry.route, facts.overflow ? 'OVERFLOW ' + facts.scrollWidth : 'ok', facts.clipped.length ? 'clipped:' + facts.clipped.length : '');
    }
    await context.close();
  }
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log('screenshots:', report.shots.length, 'output:', output);
if (report.layouts.some((layout) => layout.overflow)) process.exitCode = 1;
