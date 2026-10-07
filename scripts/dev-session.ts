/**
 * Signs a person in on a local or preview server and saves a Playwright storage state, so an
 * agent (or you) can look at signed-in pages without the email code round trip.
 *
 *   pnpm auth:session --email amina@example.com [--moderator] [--not-onboarded] [--age-days 0]
 *                     [--base http://127.0.0.1:5173] [--out .auth/amina.json]
 *
 * Then, for example:
 *   pnpm exec playwright screenshot --load-storage=.auth/amina.json http://127.0.0.1:5173/me shot.png
 *   curl -H "cookie: <printed cookie>" http://127.0.0.1:5173/api/me
 *
 * The endpoint only answers on localhost and Worker Preview hosts; production returns 404.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    moderator: { type: "boolean", default: false },
    "age-days": { type: "string" },
    "not-onboarded": { type: "boolean", default: false },
    base: { type: "string", default: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173" },
    out: { type: "string" },
  },
});

const email = values.email ?? "dev@example.com";
const base = new URL(values.base ?? "http://127.0.0.1:5173");
const out = values.out ?? `.auth/${email.replace(/[^a-z0-9._-]/gi, "_")}.json`;

const response = await fetch(new URL("/api/test/session", base), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email,
    name: values.name,
    moderator: values.moderator,
    ageDays: values["age-days"] === undefined ? undefined : Number(values["age-days"]),
    onboarded: !values["not-onboarded"],
  }),
});
if (!response.ok) {
  console.error(`Sign-in failed (${response.status}): ${await response.text()}`);
  if (response.status === 404) console.error("Is the dev server running, and is this a localhost or preview host?");
  process.exit(1);
}
const body = (await response.json()) as {
  user: { id: string; email: string; handle: string | null };
  cookie: { name: string; value: string; secure: boolean };
};
const storageState = {
  cookies: [
    {
      name: body.cookie.name,
      value: encodeURIComponent(body.cookie.value),
      domain: base.hostname,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
      httpOnly: true,
      secure: body.cookie.secure,
      sameSite: "Lax",
    },
  ],
  origins: [],
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(storageState, null, 2)}\n`);
console.log(`Signed in ${body.user.email} as @${body.user.handle ?? "(no profile)"} on ${base.origin}`);
console.log(`Storage state: ${out}`);
console.log(`Cookie: ${body.cookie.name}=${encodeURIComponent(body.cookie.value)}`);
