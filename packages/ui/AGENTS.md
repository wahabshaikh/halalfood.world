# @halalfood/ui

shadcn/ui components (radix-nova style, Hugeicons) and the Tailwind theme for
the web app. Read the root `AGENTS.md` first.

## Rules

- Add components with the shadcn CLI from this folder so they land in
  `src/components` with the right aliases:

  ```sh
  cd packages/ui && npx shadcn@latest add <component>
  ```

  Check the generated file for `lucide-react` imports and switch them to
  Hugeicons if the CLI did not.
- Treat files in `src/components` as vendored shadcn code: prefer composing
  them in `apps/web/src/components` over editing them. If you must change one,
  keep the change small and say why in a comment.
- Theme tokens (colours, radius, fonts) live only in
  `src/styles/globals.css`, with light and dark values. Status tones use
  `success`, `warning`, `info` and `destructive`; the brand colour is
  `primary`. Do not change existing token values without being asked: they are
  the brand.
- This package is web-only (it renders DOM). Shared logic that a mobile app
  would also need belongs in `@halalfood/core`.
- `npm run typecheck -w @halalfood/ui` is the only check here.
