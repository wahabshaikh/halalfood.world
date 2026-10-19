import { test, expect } from "vitest";
import { parseFlagReview } from "./contribution-flags";

test("flag reviews validate both outcomes and require a bounded reason", () => {
  for (const body of [null, false, {}, { action: "approve", reason: "okay" }, { action: "dismiss" }, { action: "uphold", reason: " " }, { action: "uphold", reason: "x".repeat(301) }])
    expect(parseFlagReview(body).ok).toBe(false);
  for (const action of ["dismiss", "uphold"])
    expect(parseFlagReview({ action, reason: " Reviewed " })).toEqual({ ok: true, value: { action, reason: "Reviewed" } });
});
