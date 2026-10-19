import { expect, test, type APIRequestContext } from "@playwright/test";
import { newUser, SEED_PLACE_ID } from "./support/helpers";

async function rpc(request: APIRequestContext, method: string, params = {}, key?: string) {
  const response = await request.post("/api/mcp/member", {
    headers: { accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    data: { jsonrpc: "2.0", id: 1, method, params },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(data ? data.slice(6) : text).result;
}

async function call(request: APIRequestContext, name: string, args = {}, key?: string) {
  const result = await rpc(request, "tools/call", { name, arguments: args }, key);
  return JSON.parse(result.content[0].text);
}

test("member MCP requires a key even with a website session, then shares the member vouch flow", async ({ browser }) => {
  const member = await newUser(browser, "member-mcp", { ageDays: 30, onboarded: true });
  const request = member.context.request;
  try {
    expect((await rpc(request, "tools/list")).tools.map((tool: { name: string }) => tool.name).sort()).toEqual(["get_place", "search_places"]);
    expect((await call(request, "verify_place", { place_id: SEED_PLACE_ID })).error).toBe("unauthorized");
    const created = await request.post("/api/me/keys", { data: { name: "MCP test", scopes: ["read", "write"] } });
    expect(created.status()).toBe(201);
    const { key } = await created.json();
    const identity = await call(request, "whoami", {}, key);
    expect(identity.user_id).toBe(member.user.id);
    expect(identity.limits_remaining.vouches).toBe(20);
    const vouch = await call(request, "verify_place", { place_id: SEED_PLACE_ID, note: "Local MCP test" }, key);
    expect(vouch.status).toBe("accepted");
    expect(vouch.points).toBe(3);
    expect(vouch.limits_remaining.vouches).toBe(19);
    const rating = await call(request, "rate_place", { place_id: SEED_PLACE_ID, rating: "loved" }, key);
    expect(rating.points).toBe(0);
    expect(rating.rating).toBe("loved");
    const history = await call(request, "my_contributions", {}, key);
    expect(history.contributions.map((row: { kind: string }) => row.kind).sort()).toEqual(["rating", "vouch"]);
    expect(history.contributions.every((row: { channel: string }) => row.channel === "mcp")).toBe(true);
  } finally {
    await member.context.close();
  }
});

test("connect explains member tools and links to keys without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  expect((await page.goto("/connect"))?.status()).toBe(200);
  await expect(page.getByRole("link", { name: "Create a member key" })).toHaveAttribute("href", "/me/keys");
  await expect(page.getByText("Contribute with your member key", { exact: true })).toBeVisible();
  await expect(page.getByText(/Place and video submissions through AI are not available yet/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
});
