import { test, expect } from "@playwright/test";
import { newUser, SEED_PLACE_ID } from "./support/helpers";

for (const action of ["Dismiss", "Uphold"]) {
  test(`moderators can ${action.toLowerCase()} a velocity flag with a reason`, async ({ browser }) => {
    test.setTimeout(90_000);
    const network = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.1`;
    const member = await newUser(browser, "flag-member");
    const moderator = await newUser(browser, "flag-mod", { moderator: true });
    try {
      for (let index = 0; index < 6; index++) {
        const response = await member.context.request.post(`/api/places/${SEED_PLACE_ID}/vouch`, { data: {}, headers: { "cf-connecting-ip": network } });
        expect(response.status(), await response.text()).toBe(201);
        // The ordinary vouch endpoint enforces a one-second write cooldown.
        if (index < 5) await new Promise((resolve) => setTimeout(resolve, 1050));
      }
      await moderator.page.goto("/admin");
      await moderator.page.waitForLoadState("networkidle");
      const flagsTab = moderator.page.getByRole("tab", { name: /^Flags/ });
      await expect(async () => {
        await flagsTab.click();
        await expect(flagsTab).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
      }).toPass();
      const flag = moderator.page.getByRole("article").filter({ hasText: `@${member.user.handle}` });
      await expect(flag.getByRole("heading", { name: "More than 5 vouches in 10 minutes" })).toBeVisible();
      await expect(flag.getByRole("listitem")).toHaveCount(6);
      await expect(flag.getByRole("button", { name: action, exact: true })).toBeDisabled();
      await flag.getByLabel("Reason").fill("Reviewed the member's visits");
      const response = moderator.page.waitForResponse((response) => response.url().includes("/api/admin/flags/") && response.request().method() === "POST");
      await flag.getByRole("button", { name: action, exact: true }).click();
      expect((await response).status()).toBe(200);
      await expect(flag).toHaveCount(0);
      await moderator.page.reload();
      await moderator.page.waitForLoadState("networkidle");
      await moderator.page.getByRole("tab", { name: /^Flags/ }).click();
      await expect(moderator.page.getByRole("article").filter({ hasText: `@${member.user.handle}` })).toHaveCount(0);
    } finally {
      await member.context.close();
      await moderator.context.close();
    }
  });
}
