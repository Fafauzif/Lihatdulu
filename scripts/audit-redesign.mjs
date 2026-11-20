import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { testBrowserPath } from './test-browser.js';

// Reports the computed visual system of each route: page canvas, heading and
// body type, button/card/chip/dialog surfaces. Read-only evidence for reviews.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.env.QA_OUTPUT || path.resolve(root, '../../qa-redesign');
const base = process.env.QA_BASE || 'http://127.0.0.1:5177';

const routes = [
  ['/', 'home'],
  ['/beli', 'catalogue'],
  ['/barang/sora?tab=photos', 'product'],
  ['/barang/sora?tab=model', 'product-model'],
  ['/tersimpan', 'saved'],
  ['/bandingkan', 'compare'],
  ['/keranjang', 'cart'],
  ['/tinjau-pesanan', 'checkout'],
  ['/cari-dari-foto', 'photo-search'],
  ['/toko/sora', 'store'],
  ['/tentang', 'about'],
  ['/jual', 'seller'],
  ['/jual/sora/rekam', 'capture'],
  ['/jual/sora/tinjau', 'review'],
  ['/halaman-tidak-ada', 'missing'],
];

const seed = () => {
  localStorage.setItem('lihatdulu:compare:v1', JSON.stringify(['sora', 'arca', 'batu']));
  localStorage.setItem(
    'lihatdulu:marketplace:v1',
    JSON.stringify({ schema: 1, cart: ['sora', 'arca'], drafts: {}, collections: [], checkout: { delivery: 'delivery', payment: 'bank' } }),
  );
  localStorage.setItem('lihatdulu:favourites:v2', JSON.stringify(['sora', 'tala']));
};

const probe = () => {
  const seen = new Map();
  const describe = (element) => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      w: Math.round(box.width),
      h: Math.round(box.height),
      display: style.display,
      bg: style.backgroundColor,
      color: style.color,
      border: style.borderTopWidth === '0px' ? 'none' : `${style.borderTopWidth} ${style.borderTopColor}`,
      radius: style.borderTopLeftRadius,
      font: `${style.fontSize}/${style.fontWeight}`,
      pad: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
    };
  };
  const pick = (selector) => describe(document.querySelector(selector));
  const colours = [...document.querySelectorAll('#main *,header *,footer *')].slice(0, 4000);
  for (const element of colours) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || !element.getClientRects().length) continue;
    for (const key of ['backgroundColor', 'color', 'borderTopColor']) {
      const value = style[key];
      if (!value || value === 'rgba(0, 0, 0, 0)') continue;
      seen.set(value, (seen.get(value) || 0) + 1);
    }
  }
  return {
    body: describe(document.body),
    main: pick('#main'),
    header: pick('.site-header'),
    headerInner: pick('.header-inner'),
    brand: pick('.brand'),
    search: pick('.header-search input'),
    roleLink: pick('.role-switch a'),
    roleSelected: pick('.role-switch a.selected'),
    h1: pick('#main h1'),
    h2: pick('#main h2'),
    card: pick('.product-card'),
    cardMedia: pick('.card-media'),
    cardTitle: pick('.product-card h3'),
    cardPrice: pick('.card-asking-price,.card-price strong'),
    button: pick('#main .button'),
    buttonSecondary: pick('#main .button.secondary'),
    chip: pick('#main .chip'),
    chipSelected: pick('#main .chip.selected'),
    input: pick('#main input'),
    footer: pick('.site-footer'),
    bottomNav: pick('.bottom-nav'),
    colours: [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18),
    sections: [...document.querySelectorAll('#main > section,#main > div')].map((element) => ({
      cls: element.className.toString().slice(0, 80),
      h: Math.round(element.getBoundingClientRect().height),
      bg: getComputedStyle(element).backgroundColor,
    })),
  };
};

await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: await testBrowserPath(), headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(seed);
const page = await context.newPage();
const report = {};
try {
  for (const [route, name] of routes) {
    await page.goto(base + route, { waitUntil: 'networkidle' });
    await page.locator('#main').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const before = report[name];
    report[name] = { route, desktop: await page.evaluate(probe) };
    if (before) report[name] = before;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    report[name].phone = await page.evaluate(probe);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
} finally {
  await browser.close();
}
await fs.writeFile(path.join(output, 'audit.json'), JSON.stringify(report, null, 2));
console.log('audit:', path.join(output, 'audit.json'));
