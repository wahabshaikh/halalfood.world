import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["docs/**", "public/**", "dist/**", ".next/**", ".wrangler/**", "coverage/**", "migrations/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", fetch: "readonly" } },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Input sanitizers strip control characters on purpose (/[\u0000-\u001f]/).
      "no-control-regex": "off",
    },
  },
);
