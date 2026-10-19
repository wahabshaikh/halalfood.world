import { test } from "vitest";
import assert from "node:assert/strict";
import { createMemberKey, hashKey, listMemberKeys, parseKeyFields, revokeMemberKey, verifyMemberKey } from "./member-keys";
import { DAY, addUser, createTestDatabase } from "@/lib/testing/sqlite-d1";

function world() {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "amal");
  addUser(sqlite, "bilal", "bilal", Date.now() - 6 * DAY);
  return { sqlite, db };
}

const fields = { name: "Claude", scopes: ["read", "write"] as ("read" | "write")[] };

test("key fields need a name and only read or write scopes; write includes read", () => {
  assert.deepEqual(parseKeyFields({ name: "  Claude  " }), { ok: true, fields: { name: "Claude", scopes: ["read", "write"] } });
  assert.deepEqual(parseKeyFields({ name: "Cursor", scopes: ["write"] }), { ok: true, fields: { name: "Cursor", scopes: ["read", "write"] } });
  assert.deepEqual(parseKeyFields({ name: "Cursor", scopes: ["read"] }), { ok: true, fields: { name: "Cursor", scopes: ["read"] } });
  assert.equal(parseKeyFields({ name: "" }).ok, false);
  assert.equal(parseKeyFields({ name: "x".repeat(41) }).ok, false);
  assert.equal(parseKeyFields({ name: "Claude", scopes: ["admin"] }).ok, false);
  assert.equal(parseKeyFields({ name: "Claude", scopes: "read" }).ok, false);
  assert.equal(parseKeyFields([]).ok, false);
});

test("accounts younger than 7 days can't make keys", async () => {
  const { db } = world();
  assert.deepEqual(await createMemberKey("bilal", fields, db), {
    ok: false,
    status: 403,
    error: "API keys open up once your account is 7 days old.",
  });
  assert.equal((await createMemberKey("bilal", fields, db, Date.now() + DAY + 1000)).ok, true);
  assert.equal((await createMemberKey("nobody", fields, db)).ok, false);
});

test("a key is shown once and stored only as its SHA-256 and first 8 characters", async () => {
  const { sqlite, db } = world();
  const made = await createMemberKey("amal", fields, db);
  assert.ok(made.ok);
  assert.match(made.key, /^hfw_[A-Za-z0-9_-]{43}$/);
  assert.equal(made.record.prefix, made.key.slice(0, 8));
  const row = sqlite.prepare(`SELECT * FROM member_api_keys WHERE id = ?`).get(made.record.id) as Record<string, unknown>;
  assert.equal(row.key_hash, await hashKey(made.key));
  assert.match(String(row.key_hash), /^[0-9a-f]{64}$/);
  assert.ok(!Object.values(row).includes(made.key), "the plain key is never stored");
  const listed = await listMemberKeys("amal", db);
  assert.deepEqual(listed, [made.record]);
  assert.ok(!JSON.stringify(listed).includes(String(row.key_hash)), "the list never carries the hash");
  assert.deepEqual(await listMemberKeys("bilal", db), []);
});

test("at most 3 active keys; revoking one frees a slot", async () => {
  const { db } = world();
  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const made = await createMemberKey("amal", fields, db);
    assert.ok(made.ok);
    ids.push(made.record.id);
  }
  const fourth = await createMemberKey("amal", fields, db);
  assert.equal(fourth.ok, false);
  assert.equal(!fourth.ok && fourth.status, 409);
  assert.equal(await revokeMemberKey("bilal", ids[0], db), false, "only the owner can revoke");
  assert.equal(await revokeMemberKey("amal", ids[0], db), true);
  assert.equal(await revokeMemberKey("amal", ids[0], db), false, "already revoked");
  assert.equal((await listMemberKeys("amal", db)).length, 2);
  assert.equal((await createMemberKey("amal", fields, db)).ok, true);
});

test("verify returns the account and scopes, marks the key used, and ignores revoked or malformed keys", async () => {
  const { db } = world();
  const made = await createMemberKey("amal", { name: "Reader", scopes: ["read"] }, db);
  assert.ok(made.ok);
  assert.deepEqual(await verifyMemberKey(`Bearer ${made.key}`, db, 1234), { userId: "amal", keyId: made.record.id, scopes: ["read"] });
  assert.equal((await listMemberKeys("amal", db))[0].lastUsedAt, 1234);
  assert.equal((await verifyMemberKey(made.key, db))?.userId, "amal", "a bare key works too");
  const tampered = made.key.slice(0, -1) + (made.key.endsWith("A") ? "B" : "A");
  assert.equal(await verifyMemberKey(`Bearer ${tampered}`, db), null);
  assert.equal(await verifyMemberKey("Bearer hfw_short", db), null);
  assert.equal(await verifyMemberKey(null, db), null);
  assert.equal(await verifyMemberKey("", db), null);
  await revokeMemberKey("amal", made.record.id, db);
  assert.equal(await verifyMemberKey(`Bearer ${made.key}`, db), null);
});
