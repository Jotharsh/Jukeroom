// Makes the PNG icons from icons/source.svg and icons/source-maskable.svg, using a headless Chrome.
// node scripts/make-icons.mjs   (needs puppeteer-core installed somewhere resolvable, and CHROME set to a Chrome/Chromium binary)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE ?? 'puppeteer-core');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const jobs = [
  ['icons/source.svg', 'icons/icon-512.png', 512], ['icons/source.svg', 'icons/icon-192.png', 192],
  ['icons/source.svg', 'icons/favicon-32.png', 32], ['icons/source-maskable.svg', 'icons/icon-maskable-512.png', 512],
  ['icons/source-maskable.svg', 'icons/apple-touch-icon.png', 180],        // iOS rounds the corners itself, so it wants a full square
];
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
for (const [src, out, size] of jobs) {
  await page.setViewport({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${fs.readFileSync(src, 'utf8')}`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', out);
}
await browser.close();
