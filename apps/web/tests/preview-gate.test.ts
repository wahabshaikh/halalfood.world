import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../../../.github/workflows/preview.yml", import.meta.url), "utf8");

test("both preview resource jobs require explicit approval and non-draft PR", () => {
  for (const name of ["build", "deploy"]) {
    const job = workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [a-z]+:\n/)[0];
    assert.ok(job, name);
    const condition = job.split("    runs-on:")[0];
    assert.match(condition, /github\.event\.action != 'closed'/);
    assert.match(condition, /head\.repo\.full_name == github\.repository/);
    assert.match(condition, /draft == false/);
    assert.match(condition, /contains\(github\.event\.pull_request\.labels\.\*\.name, 'preview-approved'\)/);
  }
  assert.match(workflow, /- labeled/);
  assert.match(workflow, /- ready_for_review/);
  assert.match(workflow.split("\n  cleanup:\n")[1], /github\.event\.action == 'closed'/);
});
