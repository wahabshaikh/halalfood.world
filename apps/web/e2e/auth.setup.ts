import { test as setup } from "@playwright/test";
import { signIn, testEmail, USER_STATE } from "./support/auth";

// One signed-in user shared by specs that `test.use({ storageState: USER_STATE })`.
// Specs that need their own user call `signIn(page.request)` instead.
setup("sign in the shared test user", async ({ page }) => {
  await signIn(page.request, testEmail("shared"));
  await page.context().storageState({ path: USER_STATE });
});
