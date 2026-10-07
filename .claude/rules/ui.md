---
paths:
  - "app/**/*.tsx"
  - "components/**"
  - "app/globals.css"
---

# Pages and components

- The design reference is `design/social-community.html` and the screens in `docs/spec/simplified-community-spec.md`.
  The `design/` folder is a snapshot, not code to import.
- `components/ui/` are shadcn/ui primitives (radix-nova style): theme them through the tokens in `app/globals.css`,
  don't fork their logic. Add new ones with `pnpm dlx shadcn@latest add <component>`. Product building blocks
  go in `components/hf/` (kebab-case file, named export). There is no hand-written stylesheet.
- Icons come from Hugeicons: `HugeiconsIcon` from `@hugeicons/react` with an icon from `@hugeicons/core-free-icons`.
- Server components by default; add `"use client"` only for interactivity. Read data on the server through
  `lib/`; client components call `/api` routes.
- Status copy matters: "Not checked yet" never means "not halal", and a listing is never a certification.
- Accessibility: labelled inputs, real buttons/links, visible focus, 44px touch targets on mobile. Phone first,
  then check the desktop layout (≥ 768 px has its own top bar and grids).
- Sheets set `?sheet=` so the back button closes them.
- Analytics: DataFast pageviews through `lib/analytics.ts`. If you add goals, names are `snake_case` and
  append-only, and props never contain emails, names or exact coordinates.
- MapLibre is heavy: keep it on `/map` and lazy, off the critical path of place pages.
