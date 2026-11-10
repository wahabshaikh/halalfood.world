import { expect, test } from "@playwright/test";
import { SEED_PLACE_ID } from "./support/helpers";

const PAGES = ["/", `/place/${SEED_PLACE_ID}`, "/claim", `/claim/${SEED_PLACE_ID}`];

/** Collect CSP violations, including ones fired while the document is parsed. */
async function open(page: import("@playwright/test").Page, path: string) {
  const violations: string[] = [];
  await page.addInitScript(() => {
    const list: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = list;
    document.addEventListener("securitypolicyviolation", (event) => {
      list.push(`${event.violatedDirective} ${event.blockedURI} ${event.sample}`);
    });
  });
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("Content Security Policy") || text.includes("Refused to")) violations.push(text);
  });
  const response = await page.goto(path, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const fromPage = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  return { response, violations: [...violations, ...fromPage] };
}

test("home, a restaurant and claim send a nonce CSP with no violations", async ({ page }) => {
  for (const path of PAGES) {
    const { response, violations } = await open(page, path);
    expect(response?.status(), path).toBe(200);
    const policy = response?.headers()["content-security-policy"] ?? "";
    const scriptSrc = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src ")) ?? "";
    expect(policy, path).toContain("'strict-dynamic'");
    expect(scriptSrc, path).toContain("'nonce-");
    expect(scriptSrc, path).not.toContain("'unsafe-inline'");
    // Dev Vite needs 'unsafe-eval'. Production builds (CI and E2E_BUILD=1) must not send it.
    if (process.env.CI || process.env.E2E_BUILD === "1") expect(scriptSrc, path).not.toContain("'unsafe-eval'");
    expect(policy, path).toContain("https://whop.com");
    expect(policy, path).toContain("https://datafa.st");
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1] ?? "";
    expect(nonce.length, path).toBeGreaterThan(8);
    const scripts = await page.locator("script").evaluateAll((nodes) =>
      nodes.map((node) => ({
        src: node.getAttribute("src"),
        type: node.getAttribute("type"),
        nonce: node.nonce || node.getAttribute("nonce"),
      })),
    );
    for (const script of scripts) {
      expect(script.nonce, `${path} ${script.src ?? script.type ?? "inline"}`).toBe(nonce);
    }
    expect(violations, path).toEqual([]);
  }
});
