#!/usr/bin/env node
// Drive only header search and write proof under evidence/ (not evidence/e2e/).
// On the seeded server, london returns 4 places. The full feature drive is drive-features.mjs.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const evidenceDir = path.join(root, ".cursor/skills/verify-halalfood/evidence");
const base = process.env.VERIFY_BASE_URL || "http://localhost:3000";
const query = "london";
const heading = `Halal places matching \u201c${query}\u201d`;

function chromePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const candidates = ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  return candidates.find((candidate) => existsSync(candidate));
}

await mkdir(evidenceDir, { recursive: true });
const executablePath = chromePath();
const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
let context;
try {
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: evidenceDir, size: { width: 1440, height: 1000 } },
  });
  const page = await context.newPage();
  const requests = [];
  page.on("request", (request) => {
    requests.push({ method: request.method(), url: request.url() });
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  const search = page.getByRole("searchbox", { name: "Search halal places or cities" });
  await search.fill(query);
  await page.screenshot({ path: path.join(evidenceDir, "search-filled.png") });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL(/\/search\?q=london(?:&|$)/);
  const resultHeading = page.getByRole("heading", { level: 1, name: heading });
  await resultHeading.waitFor();
  const headingText = (await resultHeading.innerText()).replace(/\s+/g, " ").trim();
  const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await page.screenshot({ path: path.join(evidenceDir, "search-results.png") });

  const apiResponse = await page.request.get(
    `${base}/api/places/search?q=${encodeURIComponent(query)}&limit=48`,
  );
  const apiStatus = apiResponse.status();
  const apiBody = await apiResponse.json();
  await writeFile(
    path.join(evidenceDir, "search-api.json"),
    JSON.stringify({ status: apiStatus, body: apiBody }, null, 2) + "\n",
  );

  const documentRequest = requests.find(
    (request) => request.method === "GET" && request.url.includes("/search?q=london"),
  );
  const posts = requests.filter((request) => {
    if (request.method === "GET" || request.method === "HEAD") return false;
    try {
      return new URL(request.url).origin === new URL(base).origin;
    } catch {
      return false;
    }
  });
  const google = requests.filter((request) =>
    /places\.googleapis\.com|maps\.googleapis\.com/i.test(request.url),
  );
  const empty = apiBody.total === 0;
  const emptyCopy = bodyText.includes("No places found yet");
  const placeLinks = await page.locator('a[href^="/place/"]').count();

  const problems = [];
  if (headingText !== heading) problems.push(`heading was ${JSON.stringify(headingText)}`);
  if (apiStatus !== 200) problems.push(`search API status ${apiStatus}`);
  if (typeof apiBody.total !== "number" || !Array.isArray(apiBody.places)) {
    problems.push("search API JSON missing total or places");
  }
  if (apiBody.places.length !== Math.min(apiBody.total, apiBody.places.length)) {
    problems.push("search API places length exceeds total");
  }
  if (empty && !emptyCopy) problems.push("API total is 0 but the page did not say No places found yet");
  if (!empty && placeLinks < 1) problems.push("API returned places but the page has no /place/ link");
  if (!documentRequest) problems.push("the browser never requested /search?q=london");
  if (posts.length) problems.push(`unexpected non-GET requests: ${posts.map((item) => item.method + " " + item.url).join(", ")}`);
  if (google.length) problems.push(`search contacted Google: ${google.map((item) => item.url).join(", ")}`);
  if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(" | ")}`);

  const transcript = [
    "feature: search",
    `base: ${base}`,
    "action: filled the header searchbox \"Search halal places or cities\" with london and clicked the Search button",
    `result url: ${page.url()}`,
    `heading: ${headingText}`,
    `visible summary: ${emptyCopy ? "No places found yet" : bodyText.includes("place") ? "results rendered" : "see screenshot"}`,
    `place links on page: ${placeLinks}`,
    `api: GET /api/places/search?q=london&limit=48 -> ${apiStatus} total=${apiBody.total} places=${apiBody.places?.length} limit=${apiBody.limit}`,
    `document request: ${documentRequest ? documentRequest.method + " " + documentRequest.url : "missing"}`,
    `non-GET requests to ${base} during the drive: ${posts.length}`,
    `google requests during the drive: ${google.length}`,
    "side effect: this path is a GET. The page query and the search API total are the same read of local D1. Nothing was written.",
    problems.length ? `problems:\n- ${problems.join("\n- ")}` : "problems: none",
  ].join("\n");
  await writeFile(path.join(evidenceDir, "search-transcript.txt"), transcript + "\n");

  const video = page.video();
  await page.close();
  await context.close();
  context = undefined;
  if (video) {
    const videoPath = await video.path();
    await rename(videoPath, path.join(evidenceDir, "search-drive.webm"));
  }
  if (problems.length) {
    console.error(transcript);
    process.exitCode = 1;
  } else {
    console.log(transcript);
  }
} finally {
  await context?.close();
  await browser.close();
}
