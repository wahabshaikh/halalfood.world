import { test as base, expect } from "@playwright/test";

/**
 * Playwright's `test`, plus a check that fails any test whose page threw an
 * uncaught error. Import `test` and `expect` from here in every spec.
 */
export const test = base.extend<{ failOnPageErrors: void }>({
  failOnPageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use();
      expect(errors, "uncaught errors in the page").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
