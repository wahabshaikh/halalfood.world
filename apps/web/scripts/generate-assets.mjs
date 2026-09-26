/**
 * Renders the PNG brand assets in `public/` from `public/icon.svg` and an
 * inline Open Graph card, using the Chromium that Playwright drives.
 *
 *   node scripts/generate-assets.mjs
 *
 * The outputs are committed so the build needs no image toolchain.
 * Set PLAYWRIGHT_CHROMIUM_PATH if Chromium is not in Playwright's default
 * location.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const icon = readFileSync(path.join(PUBLIC, "icon.svg"), "utf8");

const ogCard = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,700;6..12,900&display=swap" rel="stylesheet">
<style>
  body{margin:0;width:1200px;height:630px;font-family:'Nunito Sans',sans-serif;background:#FBF7F2;display:flex;align-items:center;overflow:hidden}
  .copy{padding:0 0 0 80px;width:640px;display:flex;flex-direction:column;gap:28px}
  .logo{display:flex;align-items:center;gap:14px;font-size:40px;font-weight:900;letter-spacing:-.03em;color:#E4572E}
  .logo span span{color:#6A6A6A;font-weight:700}
  .logo svg{width:72px;height:72px}
  h1{margin:0;font-size:64px;line-height:1.02;letter-spacing:-.03em;color:#222}
  p{margin:0;font-size:26px;color:#6A6A6A}
  .tiles{position:absolute;right:-40px;top:40px;display:grid;grid-template-columns:repeat(2,230px);gap:18px;transform:rotate(-6deg)}
  .tile{height:250px;border-radius:28px;display:flex;align-items:center;justify-content:center}
  .tile svg{width:90px}
  .badge{position:absolute;right:250px;bottom:70px;background:#fff;border-radius:999px;padding:14px 22px;font-size:22px;font-weight:900;box-shadow:0 8px 24px rgba(0,0,0,.14)}
</style></head><body>
<div class="copy">
  <div class="logo">${icon.replace('width="64" height="64"', "")}<span>halalfood<span>.world</span></span></div>
  <h1>Halal food you’ll love, checked by people like you.</h1>
  <p>Halal checks with a name and a date on each one.</p>
</div>
<div class="tiles">
  ${["#E7B48A", "#D7956A", "#F0D5B6", "#C98457"].map((tint) => `<div class="tile" style="background:${tint}"><svg viewBox="0 0 48 48" fill="none" stroke="#8A5533" stroke-width="1.6"><ellipse cx="24" cy="30" rx="18" ry="6"/><path d="M8 29c1-9 7.5-15 16-15s15 6 16 15"/><path d="M24 10v4M18 20c1.5-1.5 3.5-2.5 6-2.5"/></svg></div>`).join("")}
</div>
<div class="badge">Community favourite</div>
</body></html>`;

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  // Sandboxed environments reach Google Fonts through an HTTPS proxy.
  proxy: proxy ? { server: proxy } : undefined,
});
const context = await browser.newContext({ ignoreHTTPSErrors: Boolean(proxy) });
try {
  for (const [file, size] of [
    ["favicon-32.png", 32],
    ["apple-touch-icon.png", 180],
    ["icon-512.png", 512],
  ]) {
    const page = await context.newPage();
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0">${icon.replace('width="64" height="64"', `width="${size}" height="${size}"`)}</body>`,
    );
    await page.screenshot({ path: path.join(PUBLIC, file), omitBackground: true });
    await page.close();
  }
  const og = await context.newPage();
  await og.setViewportSize({ width: 1200, height: 630 });
  await og.setContent(ogCard, { waitUntil: "networkidle" });
  await og.screenshot({ path: path.join(PUBLIC, "og.png") });
  await og.close();
} finally {
  await browser.close();
}
