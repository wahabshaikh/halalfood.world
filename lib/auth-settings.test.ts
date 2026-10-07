import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { authSettings, DEVELOPMENT_AUTH_SECRET, originFromHost } from "./auth";

const KEYS = ["ENVIRONMENT", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "NODE_ENV"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function set(values: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const SECRET = "x".repeat(40);

test("production uses BETTER_AUTH_URL and its own secret", async () => {
  set({ ENVIRONMENT: "production", BETTER_AUTH_URL: "https://halalfood.world/", BETTER_AUTH_SECRET: SECRET });
  assert.deepEqual(await authSettings("https://halalfood.world"), { baseURL: "https://halalfood.world", secret: SECRET, secureCookies: true });
  // A production Version URL on workers.dev is still production.
  assert.equal((await authSettings("https://abc-halalfood-world.x.workers.dev")).baseURL, "https://halalfood.world");
});

test("production refuses to start without a secret, even from a workers.dev URL", async () => {
  set({ ENVIRONMENT: "production", BETTER_AUTH_URL: "https://halalfood.world", BETTER_AUTH_SECRET: undefined });
  await assert.rejects(authSettings("https://halalfood.world"), /BETTER_AUTH_SECRET is not configured/);
  await assert.rejects(authSettings("https://abc-halalfood-world.x.workers.dev"), /BETTER_AUTH_SECRET is not configured/);
  set({ BETTER_AUTH_SECRET: "short" });
  await assert.rejects(authSettings("https://halalfood.world"), /at least 32 characters/);
  set({ BETTER_AUTH_URL: undefined, BETTER_AUTH_SECRET: SECRET });
  await assert.rejects(authSettings(null), /BETTER_AUTH_URL is not configured/);
});

test("a Worker Preview signs in on its own origin with the development secret", async () => {
  set({ ENVIRONMENT: "preview", BETTER_AUTH_URL: "https://halalfood.world", BETTER_AUTH_SECRET: undefined });
  assert.deepEqual(await authSettings("https://my-branch-halalfood-world.x.workers.dev"), {
    baseURL: "https://my-branch-halalfood-world.x.workers.dev",
    secret: DEVELOPMENT_AUTH_SECRET,
    secureCookies: true,
  });
  set({ BETTER_AUTH_SECRET: SECRET });
  assert.equal((await authSettings("https://my-branch-halalfood-world.x.workers.dev")).secret, SECRET);
});

test("localhost needs no auth configuration and uses plain cookies", async () => {
  set({ ENVIRONMENT: "production", BETTER_AUTH_URL: undefined, BETTER_AUTH_SECRET: undefined, NODE_ENV: "production" });
  assert.deepEqual(await authSettings("http://127.0.0.1:5173"), { baseURL: "http://127.0.0.1:5173", secret: DEVELOPMENT_AUTH_SECRET, secureCookies: false });
});

test("origins from a Host header use http only for localhost", () => {
  assert.equal(originFromHost("127.0.0.1:5173"), "http://127.0.0.1:5173");
  assert.equal(originFromHost("localhost"), "http://localhost");
  assert.equal(originFromHost("halalfood.world"), "https://halalfood.world");
});
