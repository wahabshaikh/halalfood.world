import assert from "node:assert/strict";
import { test } from "vitest";
import { isNonProductionHost, linkBase } from "./environment";

test("localhost is non-production whatever the deployment says", () => {
  assert.equal(isNonProductionHost("localhost", "production"), true);
  assert.equal(isNonProductionHost("127.0.0.1", undefined), true);
});

test("a workers.dev host is non-production only on a preview deployment", () => {
  assert.equal(isNonProductionHost("my-branch-halalfood-world.example.workers.dev", "preview"), true);
  assert.equal(isNonProductionHost("abc123-halalfood-world.example.workers.dev", "production"), false);
  assert.equal(isNonProductionHost("halalfood-world.example.workers.dev", undefined), false);
  assert.equal(isNonProductionHost("halalfood-world.example.workers.dev", ""), false);
});

test("the production domain is never non-production", () => {
  assert.equal(isNonProductionHost("halalfood.world", "preview"), false);
  assert.equal(isNonProductionHost("www.halalfood.world", "preview"), false);
});

test("links point at the request origin outside production", () => {
  assert.equal(linkBase("http://127.0.0.1:5173/login", "https://halalfood.world", "production"), "http://127.0.0.1:5173");
  assert.equal(linkBase("https://b-halalfood-world.x.workers.dev/a", "https://halalfood.world", "preview"), "https://b-halalfood-world.x.workers.dev");
  assert.equal(linkBase("https://halalfood.world/a", "https://halalfood.world/", "production"), "https://halalfood.world");
  assert.equal(linkBase("https://v1-halalfood-world.x.workers.dev/a", undefined, "production"), "https://halalfood.world");
});
