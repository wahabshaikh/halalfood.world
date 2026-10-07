/**
 * Every query over checks must say which audience it serves. Notes, names and
 * friend lines go through `visibleAuthor()` from lib/checks-repository.ts,
 * so a private or blocking author is never exposed. Any other query says why
 * it is safe with a `check-visibility:` comment right above it:
 *   status     — feeds the halal facts; authors never leave the function
 *   owner-only — only ever about the signed-in user's own checks
 *   aggregate  — anonymous counts or matches, no author exposed
 *   audience   — limited to people the viewer follows
 *   gated      — the query applies visibleAuthor()
 *   moderator  — only reachable by moderators acting on a report
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "vitest";

const ROOT = join(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test("every check query applies the visibility rule or names its audience", () => {
  const offenders: string[] = [];
  let checked = 0;
  for (const file of [...sources(join(ROOT, "lib")), ...sources(join(ROOT, "components")), ...sources(join(ROOT, "app"))]) {
    if (file.endsWith(join("db", "schema.ts"))) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\b(?:FROM|JOIN)\s+checks\b/g)) {
      checked += 1;
      const start = text.lastIndexOf("`", match.index);
      const end = text.indexOf("`", match.index);
      const query = text.slice(start, end);
      const before = text.slice(Math.max(0, start - 300), start);
      const ruled = /visibleAuthor\(/.test(query);
      const named = /check-visibility: (status|owner-only|aggregate|audience|gated|moderator)/.test(before);
      if (!ruled && !named) {
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push(`${relative(ROOT, file)}:${line} ${match[0]}`);
      }
    }
  }
  assert.ok(checked > 5, "the scan found the check queries");
  assert.deepEqual(offenders, [], "these check queries need visibleAuthor() or a check-visibility note");
});
