import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { clearLocalAccountState } from "../src/lib/sign-out";

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

test("sign-out clears this app's drafts and flags, nothing else", () => {
  const session = memoryStorage({
    "halalfood:check-in-draft:p1": "{}",
    "halalfood:add-place-draft": "{}",
    "halalfood:onboarding-draft:v1": "{}",
    "other-site": "keep",
  });
  const local = memoryStorage({
    "halalfood:was-signed-in": "1",
    "halalfood:pending-save": "p1",
    theme: "dark",
  });
  assert.equal(clearLocalAccountState([session, local]), 5);
  assert.equal(session.length, 1);
  assert.equal(session.getItem("other-site"), "keep");
  assert.equal(local.length, 1);
  assert.equal(local.getItem("theme"), "dark");
});

test("Sign out is in the user menu and on Settings, and ends the server session first", () => {
  const root = join(import.meta.dirname, "..");
  const menu = readFileSync(join(root, "src/components/account-menu.tsx"), "utf8");
  const settings = readFileSync(join(root, "app/settings/settings-view.tsx"), "utf8");
  const lib = readFileSync(join(root, "src/lib/sign-out.ts"), "utf8");
  assert.match(menu, /<SignOutMenuItem \/>/);
  assert.match(settings, /<SignOutButton \/>/);
  const server = lib.indexOf("authClient.signOut()");
  assert.ok(server > 0, "POST /api/auth/sign-out through Better Auth");
  assert.ok(lib.indexOf("clearLocalAccountState();", server) > server, "local state is cleared after");
  assert.ok(lib.indexOf('navigate("/")', server) > server, "then home");
});
