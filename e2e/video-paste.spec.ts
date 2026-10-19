import { test, expect } from "@playwright/test";
import { newUser } from "./support/helpers";

// Provider reads are mocked in lib/videos.test.ts. These browser mocks exercise the place picker
// and review controls without sending requests to YouTube or depending on an API key.
test("YouTube paste lets a member search, pick places and submit for review", async ({ browser }) => {
  const { context, page } = await newUser(browser, "video-paste");
  const id = "11111111-2222-4333-8444-555555555555";
  await page.route("**/api/videos", (route) => route.fulfill({ json: {
    id, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", status: "fetched",
    meta: { title: "Halal food tour", authorName: "Foodie", thumbnailUrl: null },
    creator: { handle: "foodie", name: "Foodie", avatarUrl: null }, suggestions: [],
  } }));
  await page.route("**/api/search?q=*", (route) => route.fulfill({ json: { places: [{ id, name: "Noor Grill", area: "Bandra", status: "unchecked" }] } }));
  await page.route(`**/api/videos/${id}/places`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ placeIds: [id] });
    await route.fulfill({ status: 201, json: { status: "needs_review", published: [], points: 0 } });
  });
  await page.goto("/add/video", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Video link" }).fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByText("Which places are in it?")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search for a place" }).fill("Noor");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: /Noor Grill/ }).click();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByRole("button", { name: "Verify this place" }).click();
  await expect(page.getByRole("heading", { name: "Sent for review" })).toBeVisible();
  await context.close();
});

test("admin exposes an empty video review queue", async ({ browser }) => {
  const { context, page } = await newUser(browser, "video-mod", { moderator: true });
  await page.goto("/admin", { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Videos", exact: true }).click();
  await expect(page.getByText("No videos waiting for review.")).toBeVisible();
  await context.close();
});

test("video mutation endpoints require sign-in", async ({ request }) => {
  const response = await request.post("/api/videos", { data: { url: "https://youtu.be/dQw4w9WgXcQ" } });
  expect(response.status()).toBe(401);
  const review = await request.post("/api/admin/videos/11111111-2222-4333-8444-555555555555", { data: { decision: "approve", userId: "x" } });
  expect(review.status()).toBe(401);
});
