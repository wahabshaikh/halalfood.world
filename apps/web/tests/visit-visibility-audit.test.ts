/**
 * Every query over place_visits or place_check_ins must say which audience it
 * serves. Public numbers (profile counts, place check-in counts, leaderboard,
 * meta descriptions, stats) go through `visibleVisit()` from src/lib/visits.ts,
 * so an unshared check-in or a visit to an unlisted place can never move them
 * (QA AC-08b and the unlisted-place finding on 78c86c6). A query that is only
 * ever about the viewer's own visits, or that is gated by `canViewVisit`, says
 * so with a `visit-visibility:` comment right above it.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test("every visit query applies the visibility rule or names its audience", () => {
  const offenders: string[] = [];
  let checked = 0;
  for (const file of [...sources(join(ROOT, "src")), ...sources(join(ROOT, "app"))]) {
    if (file.endsWith(join("db", "schema.ts"))) continue;
    const text = readFileSync(file, "utf8");
    const pattern = /\b(?:FROM|JOIN)\s+(place_visits|place_check_ins)\b/g;
    for (const match of text.matchAll(pattern)) {
      checked += 1;
      const start = text.lastIndexOf("`", match.index);
      const end = text.indexOf("`", match.index);
      const query = text.slice(start, end);
      const before = text.slice(Math.max(0, start - 600), start);
      const ruled = /visibleVisit\(|listedVisitPlace\(/.test(query);
      const named = /visit-visibility: (owner-only|gated|role-only|audience)/.test(before + query);
      if (!ruled && !named) {
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push(`${relative(ROOT, file)}:${line} ${match[0]}`);
      }
    }
  }
  assert.ok(checked > 10, "the scan found the visit queries");
  assert.deepEqual(offenders, [], "these visit queries need visibleVisit() or a visit-visibility note");
});

test("COUNTs over visits in public code go through the rule", () => {
  const offenders: string[] = [];
  for (const file of [...sources(join(ROOT, "src")), ...sources(join(ROOT, "app"))]) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/COUNT\((?:DISTINCT\s+)?[^)]*\)[\s\S]{0,200}?FROM\s+place_visits\b/g)) {
      const start = text.lastIndexOf("`", match.index);
      const end = text.indexOf("`", match.index);
      const query = text.slice(start, end);
      const before = text.slice(Math.max(0, start - 600), start);
      if (!/visibleVisit\(/.test(query) && !/visit-visibility: (owner-only|role-only|audience)/.test(before))
        offenders.push(`${relative(ROOT, file)}:${text.slice(0, match.index).split("\n").length}`);
    }
  }
  assert.deepEqual(offenders, []);
});
