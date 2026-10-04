#!/usr/bin/env node
// Drive explore, search, cities, map, and community on the seeded dev server.
// Writes proof under evidence/e2e/. Does not overwrite the earlier search proof
// in evidence/ or call Google or production D1.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const evidenceDir = path.join(root, ".cursor/skills/verify-halalfood/evidence/e2e");
const base = process.env.VERIFY_BASE_URL || "http://localhost:3000";
const dishoomId = "10000000-0000-4000-8000-000000000001";
const dishoomAddress = "Fixture snapshot, 5 Stable Street, London";
const searchHeading = "Halal places matching \u201clondon\u201d";

function chromePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const candidates = ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  return candidates.find((candidate) => existsSync(candidate));
}

function sameOriginNonGet(requests) {
  return requests.filter((request) => {
    if (request.method === "GET" || request.method === "HEAD") return false;
    try {
      return new URL(request.url).origin === new URL(base).origin;
    } catch {
      return false;
    }
  });
}

function googleRequests(requests) {
  return requests.filter((request) =>
    /places\.googleapis\.com|maps\.googleapis\.com/i.test(request.url),
  );
}

await mkdir(evidenceDir, { recursive: true });
const lines = [];
const problems = [];
const requests = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
let context;
try {
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: evidenceDir, size: { width: 1440, height: 1000 } },
  });
  const page = await context.newPage();
  page.on("request", (request) => {
    requests.push({ method: request.method(), url: request.url() });
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));

  async function bodyText() {
    return (await page.locator("body").innerText()).replace(/\s+/g, " ");
  }

  lines.push("feature: explore");
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  const hero = page.getByRole("heading", { level: 1 });
  await hero.waitFor();
  const heroText = (await hero.innerText()).replace(/\s+/g, " ").trim();
  const londonRow = page.getByRole("region", { name: "Top rated in London" });
  await londonRow.waitFor();
  await page.screenshot({ path: path.join(evidenceDir, "explore.png") });
  if (
    heroText !== "Halal food you\u2019ll love" &&
    heroText !== "Halal food, wherever you go" &&
    !heroText.startsWith("Halal food near ")
  ) {
    problems.push(`unexpected explore heading ${JSON.stringify(heroText)}`);
  }
  await londonRow.getByRole("link", { name: "Dishoom King's Cross", exact: true }).click();
  await page.waitForURL(new RegExp(`/place/${dishoomId}$`));
  await page.getByText(dishoomAddress).first().waitFor();
  await page.screenshot({ path: path.join(evidenceDir, "explore-place.png") });
  const directory = await page.request.get(
    `${base}/api/places?bbox=-180,-90,180,90&limit=1`,
  );
  const directoryBody = await directory.json();
  await writeFile(
    path.join(evidenceDir, "explore-api.json"),
    JSON.stringify(
      {
        placeUrl: page.url(),
        fixtureAddress: dishoomAddress,
        viewport: { status: directory.status(), body: directoryBody },
      },
      null,
      2,
    ) + "\n",
  );
  lines.push(`heading: ${heroText}`);
  lines.push(
    "action: opened /, saw Top rated in London, and opened the Dishoom King's Cross tile",
  );
  lines.push(`result url: ${page.url()}`);
  lines.push(`visible address: ${dishoomAddress}`);
  lines.push(
    `side effect: GET /api/places?bbox=-180,-90,180,90&limit=1 -> ${directory.status()} total=${directoryBody.total}`,
  );
  if (directoryBody.total !== 9) problems.push(`explore directory total ${directoryBody.total}, expected 9`);

  lines.push("", "feature: search");
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  const search = page.getByRole("searchbox", { name: "Search halal places or cities" });
  await search.fill("london");
  await page.screenshot({ path: path.join(evidenceDir, "search-filled.png") });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL(/\/search\?q=london(?:&|$)/);
  const resultHeading = page.getByRole("heading", { level: 1, name: searchHeading });
  await resultHeading.waitFor();
  const searchBody = await bodyText();
  const placeLinks = await page.locator('a[href^="/place/"]').count();
  await page.screenshot({ path: path.join(evidenceDir, "search-results.png") });
  const searchResponse = await page.request.get(
    `${base}/api/places/search?q=london&limit=48`,
  );
  const searchJson = await searchResponse.json();
  await writeFile(
    path.join(evidenceDir, "search-api.json"),
    JSON.stringify({ status: searchResponse.status(), body: searchJson }, null, 2) + "\n",
  );
  const firstName = searchJson.places?.[0]?.name;
  lines.push(
    'action: filled "Search halal places or cities" with london and clicked Search',
  );
  lines.push(`result url: ${page.url()}`);
  lines.push(`heading: ${(await resultHeading.innerText()).replace(/\s+/g, " ").trim()}`);
  lines.push(`visible summary: ${searchBody.includes("4 places") ? "4 places" : "count line missing"}`);
  lines.push(`place links on page: ${placeLinks}`);
  lines.push(
    `side effect: GET /api/places/search?q=london&limit=48 -> ${searchResponse.status()} total=${searchJson.total} first=${firstName} limit=${searchJson.limit}`,
  );
  if (searchResponse.status() !== 200) problems.push(`search API status ${searchResponse.status()}`);
  if (searchJson.total !== 4) problems.push(`search total ${searchJson.total}, expected 4`);
  if (firstName !== "Dishoom King's Cross") problems.push(`search first place ${firstName}`);
  if (searchJson.limit !== 40) problems.push(`search limit ${searchJson.limit}, expected 40`);
  if (!searchBody.includes("4 places")) problems.push("search page did not say 4 places");
  if (placeLinks < 4) problems.push(`search page has ${placeLinks} place links, expected at least 4`);
  const documentRequest = requests.find(
    (request) => request.method === "GET" && request.url.includes("/search?q=london"),
  );
  if (!documentRequest) problems.push("the browser never requested /search?q=london");

  lines.push("", "feature: cities");
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.locator("footer").getByRole("link", { name: "Cities", exact: true }).click();
  await page.waitForURL(/\/cities$/);
  await page.getByRole("heading", { level: 1, name: "Halal food by city" }).waitFor();
  const citiesBody = await bodyText();
  await page.screenshot({ path: path.join(evidenceDir, "cities.png") });
  if (!citiesBody.includes("3 cities and counting")) {
    problems.push("cities page did not say 3 cities and counting");
  }
  await page.locator('a[href="/city/london"]').click();
  await page.waitForURL(/\/city\/london$/);
  const cityHeading = page.getByRole("heading", { level: 1, name: "4 halal restaurants in London" });
  await cityHeading.waitFor();
  const cityPlaceLinks = await page.locator('a[href^="/place/"]').count();
  await page.screenshot({ path: path.join(evidenceDir, "city-london.png") });
  const cityResponse = await page.request.get(`${base}/api/cities/london`);
  const cityJson = await cityResponse.json();
  await writeFile(
    path.join(evidenceDir, "cities-api.json"),
    JSON.stringify({ status: cityResponse.status(), body: cityJson }, null, 2) + "\n",
  );
  lines.push("action: opened Cities from the footer, then opened the London card");
  lines.push(`result url: ${page.url()}`);
  lines.push(`heading: ${(await cityHeading.innerText()).replace(/\s+/g, " ").trim()}`);
  lines.push(`place links on city page: ${cityPlaceLinks}`);
  lines.push(
    `side effect: GET /api/cities/london -> ${cityResponse.status()} city_slug=${cityJson.city_slug} place_count=${cityJson.place_count}`,
  );
  if (cityResponse.status() !== 200) problems.push(`cities API status ${cityResponse.status()}`);
  if (cityJson.city_slug !== "london" || cityJson.place_count !== 4) {
    problems.push(`cities API was ${cityJson.city_slug} count ${cityJson.place_count}`);
  }
  if (cityPlaceLinks < 4) problems.push(`london city page has ${cityPlaceLinks} place links`);

  lines.push("", "feature: map");
  let mapJson = null;
  const mapResponsePromise = page.waitForResponse(async (response) => {
    const url = response.url();
    if (!url.includes("/api/discover?") || !url.includes("bbox=") || response.status() !== 200) return false;
    try {
      const body = await response.json();
      if (typeof body.total === "number" && body.total > 0) {
        mapJson = body;
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }, { timeout: 45000 });
  await page.goto(base + "/map", { waitUntil: "domcontentloaded" });
  const mapResponse = await mapResponsePromise;
  const expectedHeading = mapJson.total === 1
    ? "1 place in this area"
    : `${Number(mapJson.total).toLocaleString("en-US")} places in this area`;
  const mapHeading = page.getByRole("region", { name: "Places in this area" }).getByRole("heading", {
    level: 1,
    name: expectedHeading,
  });
  await mapHeading.waitFor({ timeout: 45000 });
  const mapHeadingText = (await mapHeading.innerText()).replace(/\s+/g, " ").trim();
  const mapNames = Array.isArray(mapJson.places) ? mapJson.places.map((place) => place.name) : [];
  const mapTarget = Array.isArray(mapJson.places) ? mapJson.places[0] : null;
  if (!mapTarget?.name || !mapTarget?.id) problems.push("map viewport returned no place to select");
  await page.screenshot({ path: path.join(evidenceDir, "map.png") });
  if (mapTarget?.name) {
    // The marker can sit under the sticky header, so a coordinate click hits the
    // header instead of the button. Call the button's own click listener.
    await page.getByRole("button", { name: mapTarget.name, exact: true }).evaluate((element) => {
      element.click();
    });
    await page.getByRole("region", { name: "Selected place" }).waitFor();
    await page.waitForURL((url) => {
      const parsed = new URL(url);
      return parsed.pathname === "/map" && parsed.searchParams.get("place") === mapTarget.id;
    });
  }
  await page.screenshot({ path: path.join(evidenceDir, "map-selected.png") });
  await writeFile(
    path.join(evidenceDir, "map-api.json"),
    JSON.stringify(
      {
        status: mapResponse.status(),
        url: mapResponse.url(),
        total: mapJson.total,
        names: mapNames,
      },
      null,
      2,
    ) + "\n",
  );
  lines.push(
    `action: opened /map and clicked the ${mapTarget?.name ?? "missing"} marker`,
  );
  lines.push(`result url: ${page.url()}`);
  lines.push(`heading: ${mapHeadingText}`);
  lines.push(
    `side effect: GET ${mapResponse.url().replace(base, "")} -> ${mapResponse.status()} total=${mapJson.total} names=${mapNames.join(", ")}`,
  );
  lines.push(`selected place url: ${page.url()}`);
  if (!mapNames.length) problems.push("map viewport places: none");
  if (mapJson.total < 1) problems.push(`map total ${mapJson.total}`);
  if (mapHeadingText !== `${Number(mapJson.total).toLocaleString("en-US")} places in this area` &&
      !(mapJson.total === 1 && mapHeadingText === "1 place in this area")) {
    problems.push(`map heading ${mapHeadingText} did not match total ${mapJson.total}`);
  }

  lines.push("", "feature: community");
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.getByRole("navigation", { name: "Explore" }).getByRole("link", { name: "Community" }).click();
  await page.waitForURL(/\/leaderboard$/);
  await page.getByRole("heading", { level: 1, name: "Community" }).waitFor();
  await page.getByRole("heading", { name: "Top helpers" }).waitFor();
  await page.getByText("Amina Rahman").first().waitFor();
  const communityBody = await bodyText();
  await page.screenshot({ path: path.join(evidenceDir, "community.png") });
  const boardResponse = await page.request.get(`${base}/api/leaderboard`);
  const boardJson = await boardResponse.json();
  await writeFile(
    path.join(evidenceDir, "leaderboard-api.json"),
    JSON.stringify({ status: boardResponse.status(), body: boardJson }, null, 2) + "\n",
  );
  const top = boardJson.contributors?.[0];
  const second = boardJson.contributors?.[1];
  lines.push("action: clicked Community in the Explore navigation");
  lines.push(`result url: ${page.url()}`);
  lines.push(
    `visible: ${communityBody.includes("Amina Rahman") && communityBody.includes("34 pts") ? "Amina Rahman, 34 pts" : "leaderboard copy missing"}`,
  );
  lines.push(
    `side effect: GET /api/leaderboard -> ${boardResponse.status()} first=${top?.displayName} score=${top?.score} second=${second?.displayName} score=${second?.score}`,
  );
  if (boardResponse.status() !== 200) problems.push(`leaderboard status ${boardResponse.status()}`);
  if (top?.displayName !== "Amina Rahman" || top?.score !== 34) {
    problems.push(`leaderboard first is ${top?.displayName} ${top?.score}`);
  }
  if (second?.displayName !== "Yusuf Ali" || second?.score !== 15) {
    problems.push(`leaderboard second is ${second?.displayName} ${second?.score}`);
  }
  if (!communityBody.includes("34 pts")) problems.push("community page did not show 34 pts");
  if (communityBody.includes("@verify.halalfood.local")) {
    problems.push("community page exposed a fixture email address");
  }

  const posts = sameOriginNonGet(requests);
  const google = googleRequests(requests);
  if (posts.length) {
    problems.push(`unexpected non-GET requests: ${posts.map((item) => item.method + " " + item.url).join(", ")}`);
  }
  if (google.length) {
    problems.push(`drive contacted Google: ${google.map((item) => item.url).join(", ")}`);
  }
  lines.push(
    "",
    `non-GET requests to ${base} during the drive: ${posts.length}`,
    `google places or maps requests during the drive: ${google.length}`,
    "not called: production D1, places.googleapis.com, maps.googleapis.com, Resend, Turnstile, OAuth",
    problems.length ? `problems:\n- ${problems.join("\n- ")}` : "problems: none",
  );

  const transcript = lines.join("\n");
  await writeFile(path.join(evidenceDir, "features-transcript.txt"), transcript + "\n");
  const video = page.video();
  await page.close();
  await context.close();
  context = undefined;
  if (video) {
    await rename(await video.path(), path.join(evidenceDir, "features-drive.webm"));
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
