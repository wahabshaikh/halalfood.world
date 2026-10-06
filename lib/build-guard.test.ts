import assert from "node:assert/strict";
import { test } from "vitest";
import { buildGuardFailure } from "./build-guard";

test("local and GitHub Actions builds are never stopped", () => {
  assert.equal(buildGuardFailure({}), null);
  assert.equal(buildGuardFailure({ CI: "true", npm_config_user_agent: "npm/10.9.8 node/v22" }), null);
});

test("Workers Builds started by pnpm carries on", () => {
  assert.equal(buildGuardFailure({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "feature", npm_config_user_agent: "pnpm/10.18.3 npm/? node/v22" }), null);
});

test("Workers Builds on the old npm settings stops before anything is uploaded", () => {
  const failure = buildGuardFailure({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "feature", npm_config_user_agent: "npm/10.9.8 node/v22.0.0" });
  assert.match(failure ?? "", /npm\/10\.9\.8/);
  assert.match(failure ?? "", /pnpm cf:preview/);
  assert.ok(buildGuardFailure({ WORKERS_CI: "1" }));
});
